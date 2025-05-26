
'use server';

import type { NextRequest } from 'next/server';
import type { ValidationIssue } from '@/types';

// Helper to create ValidationIssue objects
const createApiIssue = (
  type: 'error' | 'warning',
  message: string,
  details?: string,
  rule?: string,
  line?: number,
  column?: number
): ValidationIssue => {
  let fullDetails = details || '';
  if (line !== undefined && column !== undefined) { // Ensure both line and col are present for location
    fullDetails = `${fullDetails} (line ${line}, col ${column})`.trim();
  } else if (line !== undefined) {
    fullDetails = `${fullDetails} (line ${line})`.trim();
  }
  if (rule) {
    fullDetails = `${fullDetails} Rule: ${rule}`.trim();
  }

  // Remove potential duplicate location info if already in message by stylelint
  if (message.includes(`(${line}:${column})`)) {
    message = message.replace(`(${line}:${column})`, '').trim();
  }
  
  return {
    id: `css-api-${type}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    message: message || 'Unknown CSS linting issue',
    details: fullDetails || 'No additional details.',
    rule: rule || (type === 'error' ? 'css-syntax-error' : 'css-lint-warning'),
  };
};

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    const { cssContent, filePath } = await request.json();

    if (typeof cssContent !== 'string' || typeof filePath !== 'string') {
      return new Response(JSON.stringify({ 
        issues: [createApiIssue('error', 'Invalid request payload: cssContent or filePath missing/invalid.')] 
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Dynamically import stylelint to potentially avoid build-time issues
    const stylelint = await import('stylelint');

    // Minimal hardcoded config; stylelint might still try to load .stylelintrc.json if codeFilename is used
    // but this internal config ensures some basic parsing.
    const config = {
      // Processor for plain CSS. No custom syntax by default.
      // We are relying on PostCSS parser used by stylelint for syntax errors.
      // Explicitly setting rules to empty to avoid issues with extending 'stylelint-config-standard' dynamically
      // if cosmiconfig (used by stylelint) fails in serverless.
      rules: {
        // We are primarily interested in syntax errors caught by the parser.
        // 'no-extra-semicolons': true, // Example rule if needed
        // 'declaration-block-no-shorthand-property-overrides': true, // Example
      },
    };
    
    let result;
    try {
      result = await stylelint.default.lint({
        code: cssContent,
        codeFilename: filePath, // Helps stylelint provide better error context
        config, // Use our minimal config
        fix: false,
      });
    } catch (lintError: any) {
      // Catch errors during the linting process itself (e.g., critical parser failure)
      console.error(`Stylelint.lint() itself threw an error for ${filePath}:`, lintError);
      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        lintIssues.push(createApiIssue('error', lintError.reason, `Source: ${lintError.input?.file || filePath}`, lintError.rule || 'CssSyntaxError', lintError.line, lintError.column));
      } else {
        lintIssues.push(createApiIssue('error', 'Stylelint execution failed.', lintError.message || 'Unknown error during stylelint.lint()', 'stylelint-execution-error'));
      }
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (result && result.errored) {
      result.results.forEach((res) => {
        // Handle parse errors (likely more severe syntax issues)
        // PostCSS parse errors might be in res.parseErrors or an error thrown by stylelint.lint()
        if (res.parseErrors && res.parseErrors.length > 0) {
            res.parseErrors.forEach((err: any) => { 
              lintIssues.push(createApiIssue('error', err.text || 'CSS parsing error', undefined, err.rule || 'CssSyntaxError', err.line, err.column));
            });
        }
        // Handle warnings (rule violations)
        if (res.warnings && res.warnings.length > 0) {
            res.warnings.forEach((warning) => {
              lintIssues.push(createApiIssue(warning.severity as 'error' | 'warning', warning.text, undefined, warning.rule, warning.line, warning.column));
            });
        }
      });

      // If errored is true but no specific issues were parsed, add a generic one
      if (lintIssues.length === 0) {
        const generalErrorMessage = result.output || 'Stylelint reported an unspecified CSS error.';
        // Try to extract details if it's a common PostCSS syntax error format
        const match = generalErrorMessage.match(/CssSyntaxError: (.+?) at L(\d+):C(\d+)/) || generalErrorMessage.match(/Unknown word\s*at L(\d+):C(\d+)/);
        if (match) {
           lintIssues.push(createApiIssue('error', match[1] || 'CSS Syntax Error', undefined, 'CssSyntaxError', parseInt(match[2]), parseInt(match[3])));
        } else if (generalErrorMessage.includes("Unclosed block")) {
           lintIssues.push(createApiIssue('error', "Unclosed block in CSS", undefined, 'CssSyntaxError'));
        }
        else {
           lintIssues.push(createApiIssue('error', 'Stylelint indicated an error, but no specific issues were detailed.', `Raw output (first 200 chars): ${generalErrorMessage.substring(0,200)}`, 'stylelint-general-error'));
        }
      }
    }
    
    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // This catches errors outside the stylelint.lint() call, or if json parsing fails, etc.
    console.error('Critical error in /api/lint-css POST handler:', error);
    
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to lint CSS due to a server-side exception.',
        details: error.message || String(error) || 'An unknown server error occurred.',
        rule: 'stylelint-server-exception',
    };
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


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
  // Rule info is often part of the message from stylelint, but good to have separately if available.
  // If rule is already in message, no need to add it to details.
  if (rule && !message.toLowerCase().includes(rule.toLowerCase())) {
    fullDetails = `${fullDetails} Rule: ${rule}`.trim();
  }

  // Clean up message if it already contains location from stylelint like (line x, col y)
  // or (x:y)
  if (line !== undefined && column !== undefined) {
    const locPattern1 = new RegExp(`\\(line ${line}, col ${column}\\)`, 'i');
    const locPattern2 = new RegExp(`\\(${line}:${column}\\)`);
    message = message.replace(locPattern1, '').replace(locPattern2, '').trim();
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

    // Dynamically import stylelint to potentially avoid build-time issues on some platforms
    const stylelint = await import('stylelint');

    // Minimal hardcoded config for basic syntax checking.
    // Stylelint relies on PostCSS for parsing, which catches most syntax errors.
    const config = {
      // No specific rules, relying on parser for syntax errors.
      // If we wanted to enforce stylelint-config-standard, we'd need to ensure
      // that config can be loaded in the serverless environment.
      rules: {}, 
    };
    
    let result;
    try {
      // console.log(`[API lint-css] Linting ${filePath} with content: ${cssContent.substring(0,100)}...`); // For debugging
      result = await stylelint.default.lint({
        code: cssContent,
        codeFilename: filePath, 
        config,
        fix: false,
      });
      // console.log('[API lint-css] Stylelint raw result:', JSON.stringify(result, null, 2)); // For debugging
    } catch (lintError: any) {
      // This catches errors during the linting process itself (e.g., critical parser failure like unclosed block)
      // console.error(`[API lint-css] Stylelint.lint() itself threw an error for ${filePath}:`, lintError);
      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        lintIssues.push(createApiIssue('error', lintError.reason, `Source: ${lintError.input?.file || filePath}`, lintError.ruleId || lintError.rule || 'CssSyntaxError', lintError.line, lintError.column));
      } else {
        // Generic error if stylelint.lint() fails for other reasons
        lintIssues.push(createApiIssue('error', `Stylelint execution failed for ${filePath}.`, lintError.message || 'Unknown error during stylelint.lint()', 'stylelint-execution-error'));
      }
      // Return 200 OK with issues, as the API handled the request, even if linting failed.
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (result && result.errored) {
      result.results.forEach((res) => {
        // Handle parse errors (more severe syntax issues not caught by the try-catch above)
        if (res.parseErrors && res.parseErrors.length > 0) {
            res.parseErrors.forEach((err: any) => { 
              lintIssues.push(createApiIssue('error', err.text || 'CSS parsing error', undefined, err.rule || 'CssSyntaxError', err.line, err.column));
            });
        }
        // Handle warnings/errors reported by stylelint rules (if any were active and triggered)
        if (res.warnings && res.warnings.length > 0) {
            res.warnings.forEach((warning) => {
              lintIssues.push(createApiIssue(warning.severity as 'error' | 'warning', warning.text, undefined, warning.rule, warning.line, warning.column));
            });
        }
      });

      // If errored is true but no specific issues were parsed (e.g. from an unhandled parse error)
      // Add a generic one, sometimes result.output has more info
      if (lintIssues.length === 0 && result.output) {
        const generalErrorMessage = result.output;
        const match = generalErrorMessage.match(/CssSyntaxError: (.+?) at L(\d+):C(\d+)/) || generalErrorMessage.match(/Unknown word\s*at L(\d+):C(\d+)/);
        if (match && match[1] && match[2] && match[3]) {
           lintIssues.push(createApiIssue('error', match[1] || 'CSS Syntax Error', undefined, 'CssSyntaxError', parseInt(match[2]), parseInt(match[3])));
        } else if (generalErrorMessage.includes("Unclosed block")) {
           lintIssues.push(createApiIssue('error', "Unclosed block in CSS", undefined, 'CssSyntaxError'));
        } else {
           lintIssues.push(createApiIssue('error', 'Stylelint indicated an error, but no specific issues were detailed.', `Raw output (first 200 chars): ${generalErrorMessage.substring(0,200)}`, 'stylelint-general-error'));
        }
      }
    }
    
    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // This catches errors outside the stylelint.lint() call, or if json parsing fails, etc.
    console.error('[API lint-css] Critical error in POST handler:', error);
    
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to lint CSS due to a server-side exception.',
        details: error.message || String(error) || 'An unknown server error occurred.',
        rule: 'stylelint-server-exception',
    };
    // Return a 500, but still try to make it JSON for the client.
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


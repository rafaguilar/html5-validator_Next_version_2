
'use server';

import type { NextRequest } from 'next/server';
import stylelint from 'stylelint'; // Using static import
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
  if (line !== undefined && column !== undefined) {
    fullDetails = `${fullDetails} (line ${line}, col ${column})`.trim();
  } else if (line !== undefined) {
    fullDetails = `${fullDetails} (line ${line})`.trim();
  }
  if (rule && !message.toLowerCase().includes(rule.toLowerCase())) {
    fullDetails = `${fullDetails} Rule: ${rule}`.trim();
  }

  // Remove line/col from message if already in details
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

    // Minimal hardcoded config for basic syntax checking.
    const config = {
      rules: {}, 
    };
    
    let result;
    try {
      console.log(`[API lint-css] About to lint ${filePath} using STATIC import of stylelint.`);
      result = await stylelint.lint({
        code: cssContent,
        codeFilename: filePath, // `codeFilename` is important for some rules/parsers
        config,
        fix: false, // We're not auto-fixing
      });
      // SERVER-SIDE LOGGING OF THE FULL RESULT:
      console.log('[API lint-css] Stylelint raw result:', JSON.stringify(result, null, 2)); 
    } catch (lintError: any) {
      console.error(`[API lint-css] Stylelint.lint() itself threw an error for ${filePath}:`, lintError);
      // If stylelint.lint() throws a CssSyntaxError (e.g., unclosed block)
      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        lintIssues.push(createApiIssue('error', lintError.reason, `Source: ${lintError.input?.file || filePath}`, lintError.ruleId || lintError.rule || 'CssSyntaxError', lintError.line, lintError.column));
      } else {
        // For other errors thrown by stylelint.lint()
        lintIssues.push(createApiIssue('error', `Stylelint execution failed for ${filePath}.`, lintError.message || 'Unknown error during stylelint.lint()', 'stylelint-execution-error'));
      }
      // Return 200 OK with issues, as the API handled the request, even if linting failed.
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Process results if stylelint.lint() completed
    if (result && result.errored) {
      result.results.forEach((res) => {
        // Handle parse errors (often fundamental syntax errors)
        if (res.parseErrors && res.parseErrors.length > 0) {
            res.parseErrors.forEach((err: any) => { // TODO: Type 'any' here is not ideal, use stylelint.LinterResult['parseErrors'][number] if possible
              lintIssues.push(createApiIssue('error', err.text || 'CSS parsing error', undefined, err.rule || 'CssSyntaxError', err.line, err.column));
            });
        }
        // Handle warnings/errors reported by stylelint rules
        if (res.warnings && res.warnings.length > 0) {
            res.warnings.forEach((warning) => {
              lintIssues.push(createApiIssue(warning.severity as 'error' | 'warning', warning.text, undefined, warning.rule, warning.line, warning.column));
            });
        }
      });

      // Fallback if errored but no specific issues were detailed in parseErrors or warnings
      // This might happen if stylelint sets 'errored' but only provides output text.
      if (lintIssues.length === 0 && result.output) {
        const rawOutputDetail = `Raw output (first 300 chars): ${result.output.substring(0,300)}`;
        const generalErrorMessage = result.output; // Often contains the detailed error message
        
        // Attempt to parse common error patterns from the output string
        const match = generalErrorMessage.match(/CssSyntaxError: (.+?) at L(\d+):C(\d+)/) || generalErrorMessage.match(/Unknown word\s*at L(\d+):C(\d+)/);
        
        if (match && match[1] && match[2] && match[3]) {
           lintIssues.push(createApiIssue('error', match[1].trim() || 'CSS Syntax Error', rawOutputDetail, 'CssSyntaxError', parseInt(match[2]), parseInt(match[3])));
        } else if (generalErrorMessage.toLowerCase().includes("unclosed block")) {
           lintIssues.push(createApiIssue('error', "Unclosed block in CSS.", rawOutputDetail, 'CssSyntaxError'));
        } else {
           lintIssues.push(createApiIssue('error', 'Stylelint indicated an error, but no specific issues were detailed.', rawOutputDetail, 'stylelint-general-error'));
        }
      }
    }
    
    // If result.errored is true but lintIssues is still empty, add a generic message
    // This can happen if stylelint flags an error but doesn't provide structured details
    // or if our parsing above didn't catch it.
    if (result && result.errored && lintIssues.length === 0) {
        lintIssues.push(createApiIssue('error', 'Stylelint reported an unspecified error.', `Output: ${result.output ? result.output.substring(0, 300) : 'N/A'}`));
    }
    
    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // Catch any unexpected critical errors in the POST handler itself
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

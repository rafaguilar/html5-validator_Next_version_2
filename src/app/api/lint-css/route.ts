
'use server';

import type { NextRequest } from 'next/server';
import stylelint from 'stylelint';
// We are not importing stylelint-config-standard directly for now,
// to test if a minimal, self-contained config works.
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    const { code, codeFilename } = await request.json();

    if (!code || typeof code !== 'string') {
      // This case should ideally be caught by client-side validation first
      return new Response(JSON.stringify({ error: 'CSS code string is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    // Using a minimal, hardcoded config to avoid dynamic require issues from config loading.
    const minimalConfig = {
      rules: {
        'color-no-invalid-hex': true,
        // Add other simple, non-plugin rules here if needed for basic testing
        // 'block-no-empty': null, // Example: disable a rule
      },
    };

    let results;
    try {
      results = await stylelint.lint({
        code: code,
        codeFilename: codeFilename || 'temp.css', // Provide a default filename
        config: minimalConfig, 
      });
    } catch (lintError: any) {
      // This catch block is for critical errors during stylelint.lint() itself,
      // often very malformed CSS that PostCSS (stylelint's parser) can't handle.
      console.error(`Stylelint.lint() execution error for ${codeFilename}:`, lintError);
      let errMsg = 'A critical error occurred during CSS linting.';
      let errLine: number | undefined;
      let errCol: number | undefined;
      let errRule = 'stylelint-execution-error';

      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        errMsg = `CSS Syntax Error: ${lintError.reason}`;
        errLine = lintError.line;
        errCol = lintError.column;
        errRule = 'css-syntax-error'; // Standardize rule name for these
      } else if (lintError.message) {
        errMsg = lintError.message;
      }
      
      lintIssues.push({
        id: `css-critical-lint-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: errMsg,
        line: errLine,
        column: errCol,
        rule: errRule,
        details: lintError.stack, // Include stack for more debug info if needed
      });
      // Even with a critical lint error, return a 200 OK with the issues found
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }


    if (results.results && results.results.length > 0) {
      const fileResult = results.results[0]; 
      
      if (fileResult.parseErrors && fileResult.parseErrors.length > 0) {
        fileResult.parseErrors.forEach((parseError: any) => { 
          let errMsg = 'Unknown CSS parse error';
          // PostCSS CssSyntaxError objects often have a 'reason' property
          if (parseError.reason) errMsg = parseError.reason;
          else if (parseError.text) errMsg = parseError.text; // Some wrapped errors might use 'text'
          else if (parseError.message) errMsg = parseError.message; // Generic fallback
          
          lintIssues.push({
            id: `css-parse-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: `CSS Parse Error: ${errMsg}`,
            line: parseError.line,
            column: parseError.column,
            rule: 'css-syntax-error', 
          });
        });
      }

      fileResult.warnings.forEach(warning => {
        let message = warning.text;
        // If Stylelint wraps a PostCSS CssSyntaxError, warning.rule is 'CssSyntaxError'
        // and warning.text often contains the rule name in parentheses.
        // Example: "Unclosed block (CssSyntaxError)" or "Missing semicolon (CssSyntaxError)"
        // We want to keep the core message, e.g., "Unclosed block" or "Missing semicolon".
        if (warning.rule === 'CssSyntaxError' && message.endsWith(` (${warning.rule})`)) {
          message = message.substring(0, message.length - ` (${warning.rule})`.length);
        } else if (message.includes(`(${warning.rule})`)) {
          // For other rules, remove the rule name from the message if present
           message = message.replace(` (${warning.rule})`, '');
        }

        lintIssues.push({
          id: `css-lint-${warning.line}-${warning.column}-${warning.rule || 'unknown'}`,
          type: warning.severity === 'error' ? 'error' : 'warning',
          message: message, 
          line: warning.line,
          column: warning.column,
          rule: warning.rule,
        });
      });
    } else if (results.errored && (!results.results || results.results.length === 0)) {
      // This case handles scenarios where stylelint signals an error but doesn't provide specific results.
      // For example, if the input code is empty or fundamentally unprocessable in a way not caught by parseErrors.
      lintIssues.push({
        id: `css-global-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: results.output || 'A global Stylelint error occurred during processing. The input CSS might be empty or critically malformed.',
        rule: 'stylelint-global',
      });
    }

    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // This is the outermost catch, for truly unexpected server errors in the API handler itself.
    console.error('Critical error in /api/lint-css POST handler:', error);
    
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to lint CSS due to a server-side exception.',
        details: error.message || 'An unknown server error occurred.',
        rule: 'stylelint-server-exception',
    };
    // Return a 500, but still try to make it JSON for the client.
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

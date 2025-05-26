
'use server';

import type { NextRequest } from 'next/server';
import stylelint from 'stylelint'; // Reverted to static import
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    // const stylelint = (await import('stylelint')).default; // Dynamic import commented out

    const { code, codeFilename: rawCodeFilename } = await request.json();

    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'CSS code string is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    // Ensure codeFilename is a string, even if it was passed as a number or other type
    const codeFilename = typeof rawCodeFilename === 'string' ? rawCodeFilename : (rawCodeFilename ? String(rawCodeFilename) : undefined);

    const minimalConfig = {
      rules: {
        'color-no-invalid-hex': true,
        // 'block-no-empty': null, // Example: disable a rule
        // Add other simple, non-plugin rules here if needed
        // More complex rules or plugins might require stylelint-config-standard or similar,
        // which can have dynamic require() issues in serverless environments.
      },
    };

    let results;
    try {
      results = await stylelint.lint({
        code: code,
        codeFilename: codeFilename || 'temp.css', // Provide a default filename if not specified
        config: minimalConfig,
        // configBasedir: '/opt/build/repo/', // This might be needed if config files were used and not found
      });
    } catch (lintError: any) {
      // This catch block is for critical errors during stylelint.lint() itself
      // This might include severe CSS syntax errors that PostCSS (used by stylelint) cannot handle.
      console.error(`Stylelint.lint() execution error for ${codeFilename || 'unknown file'}:`, lintError);
      let errMsg = 'A critical error occurred during CSS linting.';
      let errLine: number | undefined;
      let errCol: number | undefined;
      let errRule = 'stylelint-execution-error';

      // Check if it's a PostCSS CssSyntaxError which often has reason, line, column
      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        errMsg = `CSS Syntax Error: ${lintError.reason}`;
        errLine = lintError.line;
        errCol = lintError.column;
        errRule = 'css-syntax-error'; // More specific rule
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
        details: lintError.stack || String(lintError), // Include stack trace for debugging
      });
      // Even if stylelint.lint() fails catastrophically, return a 200 with the error in the issues.
      // The client expects a JSON response.
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }


    // Process results if stylelint.lint() did not throw
    if (results.results && results.results.length > 0) {
      const fileResult = results.results[0]; // Assuming single file linting
      
      // Handle parse errors explicitly provided by stylelint
      if (fileResult.parseErrors && fileResult.parseErrors.length > 0) {
        fileResult.parseErrors.forEach((parseError: any) => { // `any` because stylelint types for this can be broad
          let errMsg = 'Unknown CSS parse error';
          // Try to get a meaningful message from the parseError object
          if (parseError.reason) errMsg = parseError.reason;
          else if (parseError.text) errMsg = parseError.text; // `text` often holds the error message for parse errors
          else if (parseError.message) errMsg = parseError.message;
          
          lintIssues.push({
            id: `css-parse-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: `CSS Parse Error: ${errMsg}`,
            line: parseError.line,
            column: parseError.column,
            rule: 'css-syntax-error', // Standardize rule name for parsing issues
          });
        });
      }

      // Process warnings (rule violations)
      fileResult.warnings.forEach(warning => {
        // Clean up the message to remove the (rule-name) suffix if present, as we show the rule separately.
        let message = warning.text;
        if (warning.rule === 'CssSyntaxError' && message.endsWith(` (${warning.rule})`)) {
          // Remove specific (CssSyntaxError) suffix if rule is CssSyntaxError as it's often redundant
          message = message.substring(0, message.length - ` (${warning.rule})`.length);
        } else if (warning.rule && message.includes(`(${warning.rule})`)) {
           // Generic removal of (rule-name) suffix
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
      // Handle cases where stylelint reports an error but doesn't provide detailed results
      // This might happen for very malformed CSS or global configuration issues.
      lintIssues.push({
        id: `css-global-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: results.output || 'A global Stylelint error occurred. The CSS might be empty or critically malformed.',
        rule: 'stylelint-global',
      });
    }

    // Successfully processed, return issues (which might be empty)
    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // This is the outermost catch, for truly unexpected server errors in the API handler itself.
    // This should ideally not be reached if the inner try/catch for stylelint.lint() is robust.
    console.error('Critical error in /api/lint-css POST handler:', error);
    
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to lint CSS due to a server-side exception.',
        details: error.message || String(error) || 'An unknown server error occurred.', // Provide more error detail
        rule: 'stylelint-server-exception',
    };
    // Return a 500, but still try to make it JSON for the client.
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

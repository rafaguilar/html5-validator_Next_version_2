
'use server';

import type { NextRequest, NextResponse } from 'next/server';
import stylelint from 'stylelint';
// We are not importing stylelint-config-standard directly for now,
// to test if a minimal, self-contained config works.
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    const { code, codeFilename } = await request.json();

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'CSS code string is required.' }, { status: 400 });
    }
    
    // Using a minimal, hardcoded config to avoid dynamic require issues from config loading.
    const minimalConfig = {
      rules: {
        'color-no-invalid-hex': true,
        // Add other simple, non-plugin rules here if needed for basic testing
        // 'block-no-empty': null, // Example: disable a rule
      },
    };

    const results = await stylelint.lint({
      code: code,
      codeFilename: codeFilename || 'temp.css', // Provide a default filename
      config: minimalConfig, 
    });

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
      lintIssues.push({
        id: `css-global-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: results.output || 'A global Stylelint error occurred during processing.',
        rule: 'stylelint-global',
      });
    }

    return NextResponse.json({ issues: lintIssues });

  } catch (error: any) {
    console.error('Critical error in /api/lint-css POST handler:', error);
    // Check if the error is a PostCSS CssSyntaxError
    if (error.name === 'CssSyntaxError' && error.reason && error.line && error.column) {
      lintIssues.push({
        id: `css-postcss-exception-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: `CSS Syntax Error: ${error.reason}`, // Use error.reason directly
        line: error.line,
        column: error.column,
        rule: 'css-syntax-error', // Standardize rule name for these
      });
      // Return the identified syntax error instead of a generic server error
      return NextResponse.json({ issues: lintIssues }, { status: 200 }); // Still a 200 as the API call itself succeeded
    }

    // For other types of critical errors, return a generic server error message
    let detailMessage = 'An unexpected error occurred on the server.';
    if (error.message) {
      detailMessage = error.message;
    }
    
    // Ensure we return the standard error structure even for unhandled exceptions
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to lint CSS due to a server-side exception.',
        details: detailMessage,
        rule: 'stylelint-server-exception',
    };
    return NextResponse.json({ issues: [criticalErrorIssue] }, { status: 500 });
  }
}

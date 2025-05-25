
'use server';

import { NextRequest, NextResponse } from 'next/server';
import stylelint from 'stylelint';
// We are not importing stylelint-config-standard directly for now,
// to test if a minimal, self-contained config works.
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
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
      config: minimalConfig, // Pass the hardcoded config
    });

    const lintIssues: ValidationIssue[] = [];

    if (results.results && results.results.length > 0) {
      const fileResult = results.results[0]; // stylelint.lint with `code` option typically returns one result in the array
      
      // Handle parse errors from Stylelint (which might come from PostCSS)
      if (fileResult.parseErrors && fileResult.parseErrors.length > 0) {
        fileResult.parseErrors.forEach((parseError: any) => { // Using 'any' as the exact type from stylelint might vary or not be well-defined in @types
          let errMsg = 'Unknown CSS parse error';
          if (parseError.text) errMsg = parseError.text; // PostCSS errors often use 'text'
          else if (parseError.reason) errMsg = parseError.reason;
          else if (parseError.message) errMsg = parseError.message;
          
          lintIssues.push({
            id: `css-parse-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: `CSS Parse Error: ${errMsg}`,
            line: parseError.line,
            column: parseError.column,
            rule: parseError.ruleName || 'css-syntax-error', // parseError might have ruleName or similar
          });
        });
      }

      // Handle lint warnings/errors
      fileResult.warnings.forEach(warning => {
        lintIssues.push({
          id: `css-lint-${warning.line}-${warning.column}-${warning.rule || 'unknown'}`,
          type: warning.severity === 'error' ? 'error' : 'warning',
          message: warning.text.replace(` (${warning.rule})`, ''), // Remove rule from message if present
          line: warning.line,
          column: warning.column,
          rule: warning.rule,
        });
      });
    } else if (results.errored && (!results.results || results.results.length === 0)) {
      // This case handles global errors not tied to a specific file result structure
      lintIssues.push({
        id: `css-global-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: results.output || 'A global Stylelint error occurred during processing.',
        rule: 'stylelint-global',
      });
    }

    return NextResponse.json({ issues: lintIssues });
  } catch (error: any) {
    console.error('Critical error in /api/lint-css POST handler:', error); // Full error for server logs
    let detailMessage = 'An unexpected error occurred on the server.';
    if (error.message) {
      detailMessage = error.message;
    }
    // Avoid sending potentially large/sensitive stack traces to client
    return NextResponse.json({ error: 'Failed to lint CSS due to a server-side issue.', details: detailMessage }, { status: 500 });
  }
}

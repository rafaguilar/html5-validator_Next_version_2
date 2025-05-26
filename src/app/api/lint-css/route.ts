
'use server';

import type { NextRequest } from 'next/server';
// import stylelint from 'stylelint'; // Commented out for dynamic import
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    const stylelint = (await import('stylelint')).default; // Dynamic import
    const { code, codeFilename: rawCodeFilename } = await request.json();

    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'CSS code string is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    const codeFilename = typeof rawCodeFilename === 'string' ? rawCodeFilename : (rawCodeFilename ? String(rawCodeFilename) : undefined);

    const minimalConfig = {
      rules: {
        'color-no-invalid-hex': true,
        // 'block-no-empty': null, // Example: disable a rule
        // Add other simple, non-plugin rules here if needed
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
      // This catch block is for critical errors during stylelint.lint() itself
      console.error(`Stylelint.lint() execution error for ${codeFilename || 'unknown file'}:`, lintError);
      let errMsg = 'A critical error occurred during CSS linting.';
      let errLine: number | undefined;
      let errCol: number | undefined;
      let errRule = 'stylelint-execution-error';

      if (lintError.name === 'CssSyntaxError' && lintError.reason) {
        errMsg = `CSS Syntax Error: ${lintError.reason}`;
        errLine = lintError.line;
        errCol = lintError.column;
        errRule = 'css-syntax-error';
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
        details: lintError.stack || String(lintError),
      });
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }


    if (results.results && results.results.length > 0) {
      const fileResult = results.results[0]; 
      
      if (fileResult.parseErrors && fileResult.parseErrors.length > 0) {
        fileResult.parseErrors.forEach((parseError: any) => { 
          let errMsg = 'Unknown CSS parse error';
          if (parseError.reason) errMsg = parseError.reason;
          else if (parseError.text) errMsg = parseError.text;
          else if (parseError.message) errMsg = parseError.message;
          
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
        if (warning.rule === 'CssSyntaxError' && message.endsWith(` (${warning.rule})`)) {
          message = message.substring(0, message.length - ` (${warning.rule})`.length);
        } else if (warning.rule && message.includes(`(${warning.rule})`)) {
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
        message: results.output || 'A global Stylelint error occurred. The CSS might be empty or critically malformed.',
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
        details: error.message || String(error) || 'An unknown server error occurred.',
        rule: 'stylelint-server-exception',
    };
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

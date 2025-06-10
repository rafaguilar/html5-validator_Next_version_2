
'use server';

import type { NextRequest } from 'next/server';
import stylelint, { type LinterResult, type Warning as StylelintWarning, type LintResult as StylelintParseError } from 'stylelint';
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    const body = await request.json();
    const code = body.code as string;
    const codeFilename = (body.codeFilename as string) || 'style.css';

    if (typeof code !== 'string') {
      lintIssues.push({
        id: `css-input-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'CSS code was not provided or is not a string.',
        rule: 'api-input-validation',
      });
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (code.trim() === '')
      return new Response(JSON.stringify({ issues: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const linterResult: LinterResult = await stylelint.lint({
      code: code,
      codeFilename: codeFilename,
      config: {
        rules: {
          'declaration-block-trailing-semicolon': 'always', // Checks for trailing semicolon
          'block-no-empty': true, // Catches empty {} blocks
          // For other fundamental syntax issues like missing braces or semicolons between declarations,
          // Stylelint's parser will typically throw an error, caught by linterResult.errored.
        },
      },
      fix: false,
    });

    const firstResult = linterResult.results?.[0];

    if (linterResult.errored && firstResult) {
      let stylelintErrorMessage = "Stylelint encountered an operational problem.";
      let issueRule = 'stylelint-operational-error';
      let errorDetails = `File: ${codeFilename}. This may be due to a syntax error in the CSS or an issue with the Stylelint configuration.`;

      if (firstResult.invalidOptionWarnings?.length > 0) {
        stylelintErrorMessage = `Stylelint configuration error: ${firstResult.invalidOptionWarnings.map(w => w.text).join(', ')}`;
        issueRule = 'stylelint-config-error';
      } else if (firstResult.parseErrors?.length > 0) {
        // This is often where missing brace errors are reported by the parser
        stylelintErrorMessage = `CSS Parse Error: ${firstResult.parseErrors.map(e => `${e.text} (line ${e.line || 'N/A'})`).join('; ')}`;
        issueRule = 'css-parse-error'; // More specific rule
        errorDetails = `File: ${codeFilename}. ${stylelintErrorMessage}`;
      } else if (firstResult.warnings?.some(w => w.rule === 'CssSyntaxError')) {
        stylelintErrorMessage = 'CSS Syntax Error. Stylelint could not parse the CSS.';
        issueRule = 'css-syntax-error'; // More specific rule
        const syntaxError = firstResult.warnings.find(w => w.rule === 'CssSyntaxError');
        if (syntaxError) {
            errorDetails = `File: ${codeFilename}. ${syntaxError.text} (Line: ${syntaxError.line}, Column: ${syntaxError.column})`;
        }
      } else {
         errorDetails = `File: ${codeFilename}. Stylelint reported an error, but no specific parse errors or CssSyntaxError found. Original output: ${JSON.stringify(firstResult.warnings)}`;
      }


      lintIssues.push({
        id: `css-${issueRule}-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: stylelintErrorMessage,
        details: errorDetails,
        rule: issueRule,
      });
    } else if (firstResult?.warnings) {
      firstResult.warnings.forEach((warning: StylelintWarning) => {
        // Filter out CssSyntaxError here if it was already handled by linterResult.errored
        // However, standard rule violations (like declaration-block-trailing-semicolon) are processed here.
        if (warning.rule !== 'CssSyntaxError' || !linterResult.errored) {
            lintIssues.push({
            id: `css-${warning.rule || 'general'}-${warning.line}-${warning.column}-${Math.random().toString(36).substring(2, 9)}`,
            type: warning.severity === 'error' ? 'error' : 'warning',
            message: warning.text.replace(new RegExp(`\\s*\\(${warning.rule}\\)$`), '').trim(),
            details: `File: ${codeFilename}, Line: ${warning.line}, Column: ${warning.column}, Rule: ${warning.rule || 'unknown'}`,
            rule: warning.rule || 'unknown',
            });
        }
      });
    }

    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
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


'use server';

import type { NextRequest } from 'next/server';
import stylelint, { type LinterResult, type Warning as StylelintWarning, type LintResult as StylelintParseErrorEntry } from 'stylelint';
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
    if (code.trim() === '') {
      return new Response(JSON.stringify({ issues: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const linterResult: LinterResult = await stylelint.lint({
      code: code,
      codeFilename: codeFilename,
      config: {
        rules: {
          'declaration-block-trailing-semicolon': 'always',
          'block-no-empty': true,
          // Other fundamental syntax issues like missing braces or semicolons between declarations
          // are often caught by Stylelint's parser, resulting in linterResult.errored = true
          // or specific parseErrors.
        },
      },
      fix: false,
    });

    const firstResult = linterResult.results?.[0];
    let majorParseErrorHandled = false;

    // First, process all warnings reported by Stylelint
    if (firstResult?.warnings) {
      firstResult.warnings.forEach((warning: StylelintWarning) => {
        const issueType = warning.severity === 'error' ? 'error' : 'warning';
        let message = warning.text.replace(new RegExp(`\\s*\\(${warning.rule}\\)$`), '').trim();
        let rule = warning.rule || 'unknown';

        if (warning.rule === 'CssSyntaxError') {
          message = `CSS Syntax Error: ${message}`; // Prepend to make it clear
          rule = 'css-syntax-error'; // Standardize rule name
          majorParseErrorHandled = true; // Mark that a syntax error from warnings was handled
        }

        lintIssues.push({
          id: `css-${rule}-${warning.line}-${warning.column}-${Math.random().toString(36).substring(2, 9)}`,
          type: issueType,
          message: message,
          details: `File: ${codeFilename}, Line: ${warning.line}, Column: ${warning.column}, Rule: ${rule}`,
          rule: rule,
        });
      });
    }

    // Then, handle overarching operational or parse errors if Stylelint marked the result as errored
    if (linterResult.errored && firstResult && !majorParseErrorHandled) {
      // If a CssSyntaxError wasn't in warnings but linterResult.errored is true,
      // check for explicit parseErrors or create a general error message.
      if (firstResult.parseErrors?.length > 0) {
        firstResult.parseErrors.forEach((parseError: StylelintParseErrorEntry) => {
          lintIssues.push({
            id: `css-parse-error-explicit-${parseError.line || 'global'}-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: `CSS Parse Error: ${parseError.text || 'Unknown parsing issue.'}`,
            details: `File: ${codeFilename}, Line: ${parseError.line || 'N/A'}, Column: ${parseError.column || 'N/A'}. This often indicates a structural problem like unclosed blocks or malformed selectors.`,
            rule: 'css-parse-error',
          });
        });
        majorParseErrorHandled = true;
      } else if (firstResult.invalidOptionWarnings?.length > 0) {
        const message = `Stylelint configuration error: ${firstResult.invalidOptionWarnings.map(w => w.text).join(', ')}`;
        lintIssues.push({
            id: `css-config-error-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: message,
            details: `File: ${codeFilename}. Please check Stylelint configuration.`,
            rule: 'stylelint-config-error',
        });
        majorParseErrorHandled = true;
      }
      
      // If still no specific parse error handled but linterResult.errored is true, add a generic message.
      // This could happen if a CssSyntaxError was present but somehow not caught above,
      // or some other operational error.
      if (!majorParseErrorHandled) {
        // Check if there was a CssSyntaxError in warnings again, just in case (though `majorParseErrorHandled` should cover it)
        const syntaxErrorWarning = firstResult.warnings?.find(w => w.rule === 'CssSyntaxError');
        if (syntaxErrorWarning) {
             lintIssues.push({
                id: `css-syntax-error-fallback-${Math.random().toString(36).substring(2, 9)}`,
                type: 'error',
                message: `CSS Syntax Error: ${syntaxErrorWarning.text.replace(new RegExp(`\\s*\\(CssSyntaxError\\)$`), '').trim()}`,
                details: `File: ${codeFilename}, Line: ${syntaxErrorWarning.line}, Column: ${syntaxErrorWarning.column}. Stylelint indicated a parsing problem.`,
                rule: 'css-syntax-error',
            });
        } else {
            lintIssues.push({
                id: `css-operational-error-${Math.random().toString(36).substring(2, 9)}`,
                type: 'error',
                message: 'Stylelint encountered an operational problem or unrecoverable parse error.',
                details: `File: ${codeFilename}. This may be due to a severe syntax error not otherwise categorized, or an internal Stylelint issue. Original warnings (if any): ${JSON.stringify(firstResult.warnings)}`,
                rule: 'stylelint-operational-error',
            });
        }
      }
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
    
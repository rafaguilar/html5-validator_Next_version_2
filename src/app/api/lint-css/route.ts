
'use server';

import type { NextRequest } from 'next/server';
import stylelint, { type LinterResult, type Warning as StylelintWarning } from 'stylelint';
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
      // No issues for empty CSS
      return new Response(JSON.stringify({ issues: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const linterResult: LinterResult = await stylelint.lint({
      code: code,
      codeFilename: codeFilename,
      config: {
        // Using a minimal, direct set of rules instead of extending stylelint-config-standard
        rules: {
          'color-no-invalid-hex': true,
          'font-family-no-duplicate-names': true,
          'declaration-block-no-duplicate-properties': true,
          'block-no-empty': true,
          'unit-no-unknown': true,
          'string-no-newline': true,
          'selector-pseudo-class-no-unknown': true,
          'property-no-unknown': true,
          // Add more relatively simple, self-contained rules here if needed
        },
      },
      fix: false, // Set to true if you want to try auto-fixing (would require handling fixed code)
    });

    if (linterResult.errored) {
      let stylelintErrorMessage = "Stylelint encountered an operational problem.";
      const firstResult = linterResult.results?.[0];
      
      if (firstResult?.invalidOptionWarnings?.length > 0) {
        stylelintErrorMessage = `Stylelint configuration error: ${firstResult.invalidOptionWarnings.map(w => w.text).join(', ')}`;
      } else if (firstResult?.parseErrors?.length > 0) {
         stylelintErrorMessage = `Stylelint parse error: ${firstResult.parseErrors.map(e => `${e.text} (line ${e.line || 'N/A'})`).join(', ')}`;
      } else if (firstResult?.warnings?.some(w => w.rule === 'CssSyntaxError')) {
        stylelintErrorMessage = 'CSS Syntax Error. Stylelint could not parse the CSS.';
      }


      lintIssues.push({
        id: `css-stylelint-operational-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: stylelintErrorMessage,
        details: `File: ${codeFilename}. This may be due to a syntax error in the CSS or an issue with the Stylelint configuration.`,
        rule: 'stylelint-operational-error',
      });
    } else if (linterResult.results && linterResult.results.length > 0) {
      const warnings = linterResult.results[0].warnings;
      warnings.forEach((warning: StylelintWarning) => {
        lintIssues.push({
          id: `css-${warning.rule || 'general'}-${warning.line}-${warning.column}-${Math.random().toString(36).substring(2, 9)}`,
          type: warning.severity === 'error' ? 'error' : 'warning',
          message: warning.text.replace(new RegExp(`\\s*\\(${warning.rule}\\)$`), '').trim(),
          details: `Line: ${warning.line}, Column: ${warning.column}, Rule: ${warning.rule || 'unknown'}`,
          rule: warning.rule || 'unknown',
        });
      });
    }

    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Critical error in /api/lint-css POST handler:', error);
    
    let errorMessage = 'Failed to lint CSS due to a server-side exception.';
    if (error.message) {
      errorMessage += ` Details: ${error.message}`;
    } else if (typeof error === 'string') {
      errorMessage += ` Details: ${error}`;
    }
    
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

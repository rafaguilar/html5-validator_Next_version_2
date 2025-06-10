
'use server';

import type { NextRequest } from 'next/server';
import stylelint, { type LinterResult, type Warning, type Configuration as StylelintConfig, type CssSyntaxError as StylelintCssSyntaxError } from 'stylelint';
import type { ValidationIssue } from '@/types';

const createIssueFromStylelintWarning = (warning: Warning, filePath: string, isParseErrorRelated: boolean = false): ValidationIssue => {
  let message = warning.text;
  let details = `Line: ${warning.line}, Col: ${warning.column}. Rule: ${warning.rule}.`;
  let rule = warning.rule || 'stylelint-issue';

  if (isParseErrorRelated) {
    message = `CSS Syntax Error: ${warning.text.replace(/\s*\(CssSyntaxError\)$/i, '')}`; // Clean up "(CssSyntaxError)"
    details = `File: ${filePath}. Line: ${warning.line}, Col: ${warning.column}. This may be due to a syntax error in the CSS or an issue with the Stylelint configuration. Error Type: ${warning.rule || 'UnknownSyntaxError'}`;
    rule = 'css-syntax-error';
  } else if (warning.rule === 'declaration-block-trailing-semicolon') {
     message = 'Missing semicolon at the end of a declaration.';
  } else if (warning.rule === 'block-no-empty') {
     message = 'Empty block detected. This might indicate missing curly braces or an unintentional empty rule.';
  }


  return {
    id: `css-lint-${filePath}-${warning.line}-${warning.column}-${warning.rule}-${Math.random().toString(36).substring(2, 9)}`,
    type: warning.severity === 'error' ? 'error' : 'warning',
    message: message,
    details: details,
    rule: rule,
  };
};

const createCriticalParseErrorIssue = (error: any, filePath: string): ValidationIssue => {
  let message = 'Critical CSS parsing error.';
  let details = `Stylelint could not parse the CSS for ${filePath}. This is often due to severe syntax errors like unclosed blocks or comments. Original error: ${error.message || String(error)}`;
  if (error.name === 'CssSyntaxError') {
      const se = error as StylelintCssSyntaxError;
      message = `CSS Syntax Error: ${se.reason || 'Malformed CSS'}`;
      details = `File: ${filePath}. Line: ${se.line}, Col: ${se.column}. Source: ${se.source ? se.source.substring(0, 100) + '...' : 'N/A'}. Fix the syntax to proceed.`;
  }
  return {
      id: `css-critical-parse-error-${filePath}-${Math.random().toString(36).substring(2, 9)}`,
      type: 'error',
      message: message,
      details: details,
      rule: 'css-syntax-critical',
  };
};


export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  let filePath = 'unknown.css'; // Default filename

  try {
    const body = await request.json();
    const cssCode = body.code as string;
    filePath = body.codeFilename || filePath; // Use provided filename if available

    if (!cssCode || typeof cssCode !== 'string') {
      lintIssues.push({
        id: `css-lint-no-code-${filePath}-${Date.now()}`,
        type: 'error',
        message: 'No CSS code provided to lint.',
        details: `File: ${filePath}`,
        rule: 'stylelint-no-code',
      });
      return new Response(JSON.stringify({ issues: lintIssues }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Use a very minimal, direct Stylelint configuration
    const stylelintConfig: StylelintConfig = {
      rules: {
        'declaration-block-trailing-semicolon': 'always', // Checks for missing semicolons at the end of declaration blocks
        'block-no-empty': true, // Checks for empty blocks (e.g., {}), which can indicate missing braces
        // Add other simple, direct rules here if needed and if they don't cause path issues.
        // Avoid 'extends' or complex plugins that might cause dynamic import/path resolution problems in serverless environments.
      },
    };

    const linterResult: LinterResult = await stylelint.lint({
      code: cssCode,
      codeFilename: filePath, // This should be a string
      config: stylelintConfig,
      fix: false, 
    });
    
    if (linterResult.results && linterResult.results.length > 0) {
      const resultOutput = linterResult.results[0];
      
      resultOutput.warnings.forEach(warning => {
        const isParseErrorWarning = warning.text.includes('(CssSyntaxError)') || warning.rule === 'CssSyntaxError';
        lintIssues.push(createIssueFromStylelintWarning(warning, filePath, isParseErrorWarning));
      });

      if (resultOutput.parseErrors && resultOutput.parseErrors.length > 0) {
        resultOutput.parseErrors.forEach(parseError => {
          const existingIssue = lintIssues.find(
            (issue) =>
              issue.rule === 'css-syntax-error' &&
              issue.details?.includes(`Line: ${parseError.line}, Col: ${parseError.column}`) &&
              issue.message.includes(parseError.text.replace(/\s*\(CssSyntaxError\)$/i, ''))
          );
          if (!existingIssue) {
            const syntheticWarning: Warning = {
              line: parseError.line || 0,
              column: parseError.column || 0,
              rule: parseError.stylelintType || 'CssSyntaxError',
              severity: 'error',
              text: parseError.text || 'Syntax error during parsing.',
            };
            lintIssues.push(createIssueFromStylelintWarning(syntheticWarning, filePath, true));
          }
        });
      }
    }

    if (linterResult.errored && lintIssues.filter(i => i.type === 'error' && i.rule && i.rule.startsWith('css-syntax')).length === 0) {
        const genericErrorText = typeof linterResult.output === 'string' ? linterResult.output : JSON.stringify(linterResult.output);
        const primaryResult = linterResult.results?.[0];
        
        if (primaryResult?.invalidOptionWarnings?.length > 0) {
            primaryResult.invalidOptionWarnings.forEach(optWarning => {
                lintIssues.push({
                    id: `css-lint-config-invalid-option-${filePath}-${Math.random().toString(36).substring(2, 9)}`,
                    type: 'error',
                    message: `Stylelint configuration error: Invalid option for rule.`,
                    details: `${optWarning.text} File: ${filePath}`,
                    rule: 'stylelint-config-error',
                });
            });
        } else {
             lintIssues.push({
                id: `css-lint-operational-error-${filePath}-${Date.now()}`,
                type: 'error',
                message: 'Stylelint encountered an operational error.',
                details: `File: ${filePath}. Output: ${genericErrorText.substring(0, 500)}`,
                rule: 'stylelint-operational-error',
            });
        }
    }

    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error(`Critical error in /api/lint-css POST handler for ${filePath}:`, error);
    
    // If the error is the specific TypeError we encountered
    if (error instanceof TypeError && error.message.includes('The "path" argument must be of type string')) {
        const pathErrorIssue: ValidationIssue = {
            id: `css-critical-path-type-error-${filePath}-${Math.random().toString(36).substring(2, 9)}`,
            type: 'error',
            message: 'Internal server error during CSS linting: Path argument type error.',
            details: `A path argument provided to an internal function was not a string. This can sometimes happen with how Stylelint or its dependencies handle file paths in certain environments. Original error: ${error.message}`,
            rule: 'stylelint-path-type-error',
        };
        return new Response(JSON.stringify({ issues: [pathErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const criticalErrorIssue = createCriticalParseErrorIssue(error, filePath);
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

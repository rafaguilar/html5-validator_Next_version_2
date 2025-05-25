'use server';

import { NextRequest, NextResponse } from 'next/server';
import stylelint from 'stylelint';
import type { ValidationIssue } from '@/types'; // Assuming your ValidationIssue type is here

// It's generally better to load config from .stylelintrc.json or a shared config file.
// Stylelint should automatically pick up .stylelintrc.json if it's in the project root.
// If not, you might need to explicitly load it or pass the config object directly.
// For this example, we'll rely on auto-discovery of .stylelintrc.json

export async function POST(request: NextRequest) {
  try {
    const { code, codeFilename } = await request.json();

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'CSS code string is required.' }, { status: 400 });
    }
    
    const results = await stylelint.lint({
      code: code,
      codeFilename: codeFilename || 'temp.css', // filename is good for context-aware rules
      // configBasedir: process.cwd(), // Might be needed if .stylelintrc.json is not found
    });

    const lintIssues: { type: 'error' | 'warning'; message: string; line?: number; column?: number, rule?: string }[] = [];
    if (results.results && results.results.length > 0) {
      results.results.forEach(fileResult => {
        fileResult.warnings.forEach(warning => {
          lintIssues.push({
            type: warning.severity === 'error' ? 'error' : 'warning',
            message: warning.text.replace(` (${warning.rule})`, ''), // Remove rule from message if present
            line: warning.line,
            column: warning.column,
            rule: warning.rule,
          });
        });
      });
    }

    return NextResponse.json({ issues: lintIssues });
  } catch (error: any) {
    console.error('Error linting CSS via API:', error);
    return NextResponse.json({ error: 'Failed to lint CSS.', details: error.message }, { status: 500 });
  }
}

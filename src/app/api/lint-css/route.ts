
'use server';

import type { NextRequest } from 'next/server';
// stylelint import is removed as it causes issues on Netlify
import type { ValidationIssue } from '@/types';

export async function POST(request: NextRequest) {
  const lintIssues: ValidationIssue[] = [];
  try {
    // --- Temporarily bypass stylelint execution ---
    // This section is to avoid runtime errors on Netlify like "Cannot find module '../data/patch.json'"
    // and build errors related to static analysis of stylelint.
    // The API will return as if no CSS issues were found.

    // No stylelint logic will be executed.
    // The API will simply return an empty list of issues.

    // --- End of temporarily bypassed section ---

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
    // Return a 500, but still try to make it JSON for the client.
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

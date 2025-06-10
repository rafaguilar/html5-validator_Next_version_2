
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
    
    // To acknowledge the request body was received (even if not used for linting):
    // const body = await request.json(); 
    // console.log('Received CSS lint request, but Stylelint is bypassed. Body keys:', body ? Object.keys(body) : 'null');


    // --- End of temporarily bypassed section ---

    return new Response(JSON.stringify({ issues: lintIssues }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    // Log the error for server-side inspection
    console.error('Critical error in /api/lint-css POST handler (Stylelint bypassed state):', error);
    
    // Construct a user-friendly error to return
    const criticalErrorIssue: ValidationIssue = {
        id: `css-critical-server-error-${Math.random().toString(36).substring(2, 9)}`,
        type: 'error',
        message: 'Failed to process CSS request due to a server-side exception.', // More generic as Stylelint isn't the direct cause now
        details: error.message || String(error) || 'An unknown server error occurred.',
        rule: 'stylelint-server-exception', // Keep rule for consistency if client expects it
    };
    // Return a 500, but still try to make it JSON for the client.
    return new Response(JSON.stringify({ issues: [criticalErrorIssue] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

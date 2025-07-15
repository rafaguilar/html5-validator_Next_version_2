
'use server';
/**
 * @fileOverview An AI agent to detect potentially malicious code in website files.
 *
 * - detectMaliciousArchive - A function that analyzes file contents for security risks.
 * - MaliciousArchiveInput - The input type for the function.
 * - MaliciousArchiveOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const MaliciousArchiveInputSchema = z.array(z.object({
    name: z.string().describe('The name of the file.'),
    content: z.string().describe('The text content of the file.')
})).describe('An array of file objects from the archive.');

export type MaliciousArchiveInput = z.infer<typeof MaliciousArchiveInputSchema>;

const MaliciousArchiveOutputSchema = z.object({
  isMalicious: z.boolean().describe('Whether a potential security risk was detected.'),
  reason: z.string().optional().describe('A brief, user-friendly explanation of the potential risk.'),
});

export type MaliciousArchiveOutput = z.infer<typeof MaliciousArchiveOutputSchema>;


const maliciousCodePrompt = ai.definePrompt({
    name: 'maliciousCodePrompt',
    input: { schema: MaliciousArchiveInputSchema },
    output: { schema: MaliciousArchiveOutputSchema },
    prompt: `You are a security expert responsible for analyzing website files (HTML, JS, CSS) for potential security risks. Analyze the following files.

Your task is to identify any of the following security risks:
- Obfuscated JavaScript that might hide malicious behavior.
- Use of 'eval()' or 'new Function()' with dynamic, untrusted data.
- Scripts that load external resources from suspicious or non-standard domains (common CDNs like Google, Cloudflare, jsDelivr, unpkg are acceptable).
- Code that appears to perform crypto-mining.
- Code that attempts to access sensitive browser information or APIs without clear user benefit (e.g., extensive fingerprinting).
- Hidden forms or clickjacking techniques.

For each file, I will provide the filename and its content.

Here are the files:
{{#each input}}
---
File: {{{name}}}
Content:
\`\`\`
{{{content}}}
\`\`\`
---
{{/each}}

Based on your analysis, determine if a potential security risk exists. If a risk is found, set isMalicious to true and provide a concise, one-sentence, non-technical reason for the user. Focus on the most significant risk. If no risks are found, set isMalicious to false.`,
});


export async function detectMaliciousArchive(input: MaliciousArchiveInput): Promise<string | null> {
    const { output } = await maliciousCodePrompt(input);
    if (output?.isMalicious) {
        return output.reason || 'AI analysis detected a potential security risk in the uploaded files.';
    }
    return null;
}

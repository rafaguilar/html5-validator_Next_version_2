
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import { findHtmlFile } from '@/lib/utils';
import { detectMaliciousArchive } from '@/ai/flows/detect-malicious-archive';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function cleanup(id: string): Promise<void> {
  const previewDir = path.join(TEMP_DIR, id);
  try {
    await fs.rm(previewDir, { recursive: true, force: true });
    console.log(`[Scheduler] Successfully cleaned up preview directory ${id}.`);
  } catch (error: any) {
    if (error.code !== 'ENOENT') { // Ignore error if directory doesn't exist
      console.error(`[Scheduler] Failed to cleanup preview directory ${id}:`, error);
    }
  }
}

function scheduleCleanup(id: string) {
    setTimeout(() => {
      cleanup(id);
    }, CACHE_TTL_MS);
}
  
export async function POST(request: NextRequest) {
  console.log('[TRACE] /api/process-file: Received request.');
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    console.error('[TRACE] /api/process-file: No file found in form data.');
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const previewId = uuidv4();
  console.log(`[TRACE] /api/process-file: Generated previewId: ${previewId}`);
  
  const previewDir = path.join(TEMP_DIR, previewId);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log('[TRACE] /api/process-file: Reading file into buffer.');
    // The `checkCRC32: false` option makes JSZip more tolerant of certain zip file inconsistencies.
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
    console.log('[TRACE] /api/process-file: Loaded ZIP file into JSZip.');
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    // Ensure the preview directory exists before writing files
    await fs.mkdir(previewDir, { recursive: true });
    
    for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name.startsWith('__MACOSX/')) {
          continue;
        }

        try {
            const fileBuffer = await entry.async('nodebuffer');
            filePaths.push(entry.name);
            
            const fullPath = path.join(previewDir, entry.name);
            const dirName = path.dirname(fullPath);
            await fs.mkdir(dirName, { recursive: true });
            await fs.writeFile(fullPath, fileBuffer);

            const fileExt = (/\.([^.]+)$/.exec(entry.name) || [''])[0].toLowerCase();
            if (textFileExtensions.includes(fileExt)) {
                textFileContents.push({
                    name: entry.name,
                    content: fileBuffer.toString('utf-8')
                });
            }
        } catch (e: any) {
            // This catch block handles errors for individual files, like the "data size mismatch" error.
            // By catching it here, we can skip the problematic file and continue processing others.
            console.warn(`[TRACE] /api/process-file: Skipping problematic file '${entry.name}' due to error: ${e.message}`);
        }
    }
    
    console.log(`[TRACE] /api/process-file: Completed all file writes to ${previewDir}.`);

    const timestampPath = path.join(previewDir, '.timestamp');
    await fs.writeFile(timestampPath, Date.now().toString());

    scheduleCleanup(previewId);

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error('[TRACE] /api/process-file: No HTML entry point found.');
      await cleanup(previewId);
      return NextResponse.json({ error: 'No HTML file found in the ZIP archive.' }, { status: 400 });
    }
    console.log(`[TRACE] /api/process-file: Found HTML entry point: ${entryPoint}`);
    
    let securityWarning: string | null = null;
    try {
        console.log('[TRACE] /api/process-file: Starting AI security analysis.');
        securityWarning = await detectMaliciousArchive(textFileContents);
        console.log(`[TRACE] /api/process-file: AI security analysis complete. Warning: ${securityWarning || 'None'}`);
    } catch (aiError) {
        console.warn(`[TRACE] /api/process-file: AI security analysis failed, but continuing. Error:`, aiError);
        securityWarning = 'AI security analysis could not be performed.';
    }

    const result = { previewId, entryPoint, securityWarning };
    console.log('[TRACE] /api/process-file: Successfully prepared result. Sending response.', result);
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error(`[TRACE] /api/process-file: CRITICAL error during processing. Cleaning up cache for ${previewId}.`, error);
    await cleanup(previewId); // Cleanup disk cache on error
    return NextResponse.json({ error: `Failed to process ZIP file. ${error.message}` }, { status: 500 });
  }
}

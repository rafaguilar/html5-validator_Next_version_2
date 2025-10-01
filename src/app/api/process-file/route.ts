
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
    const stats = await fs.stat(previewDir);
    if (stats.isDirectory()) {
      await fs.rm(previewDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') { // Ignore error if directory doesn't exist
      console.error(`Failed to cleanup preview directory ${id}:`, error);
    }
  }
}

function scheduleCleanup(id: string) {
    setTimeout(() => {
      cleanup(id).catch(err => console.error(`[Scheduler] Failed to cleanup ${id}:`, err));
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
    const zip = await JSZip.loadAsync(buffer);
    console.log('[TRACE] /api/process-file: Loaded ZIP file into JSZip.');
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    const fileEntries = Object.values(zip.files);
    
    // Ensure the preview directory exists before writing files
    await fs.mkdir(previewDir, { recursive: true });
    
    const writePromises = fileEntries.map(async (entry) => {
        if (entry.dir || entry.name.startsWith('__MACOSX/')) {
          return;
        }

        filePaths.push(entry.name);
        const fileBuffer = await entry.async('nodebuffer');
        
        const fullPath = path.join(previewDir, entry.name);
        const dirName = path.dirname(fullPath);
        await fs.mkdir(dirName, { recursive: true });
        await fs.writeFile(fullPath, fileBuffer);

        const fileExt = (/\.([^.]+)$/.exec(entry.name) || [''])[0].toLowerCase();
        if (textFileExtensions.includes(fileExt)) {
            try {
                textFileContents.push({
                    name: entry.name,
                    content: fileBuffer.toString('utf-8')
                });
            } catch (e) {
                console.warn(`[TRACE] /api/process-file: Could not read file ${entry.name} as text for AI analysis.`);
            }
        }
    });

    console.log(`[TRACE] /api/process-file: Starting to write ${writePromises.length} files to disk.`);
    await Promise.all(writePromises);
    console.log('[TRACE] /api/process-file: Completed all file writes.');

    const timestampPath = path.join(previewDir, '.timestamp');
    await fs.writeFile(timestampPath, Date.now().toString());

    scheduleCleanup(previewId);

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error('[TRACE] /api/process-file: No HTML entry point found.');
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

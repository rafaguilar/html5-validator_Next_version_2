
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { fileCache } from '@/lib/file-cache';
import { findHtmlFile } from '@/lib/utils';
import { detectMaliciousArchive } from '@/ai/flows/detect-malicious-archive';

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
  
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log('[TRACE] /api/process-file: Reading file into buffer.');
    const zip = await JSZip.loadAsync(buffer);
    console.log('[TRACE] /api/process-file: Loaded ZIP file into JSZip.');
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    const fileEntries = Object.values(zip.files);
    const filesToCache = new Map<string, Buffer>();

    console.log('[TRACE] /api/process-file: Starting to iterate through ZIP entries.');
    for (const entry of fileEntries) {
      if (entry.dir || entry.name.startsWith('__MACOSX/')) {
        continue;
      }

      filePaths.push(entry.name);
      
      const fileBuffer = await entry.async('nodebuffer');
      filesToCache.set(entry.name, fileBuffer);
      
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
    }
    console.log(`[TRACE] /api/process-file: Finished iterating. Found ${filesToCache.size} files to cache.`);
    
    console.log('[TRACE] /api/process-file: Starting file cache set operation.');
    await fileCache.set(previewId, filesToCache);
    console.log('[TRACE] /api/process-file: Completed file cache set operation.');

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error('[TRACE] /api/process-file: No HTML entry point found.');
      return NextResponse.json({ error: 'No HTML file found in the ZIP archive.' }, { status: 400 });
    }
    console.log(`[TRACE] /api/process-file: Found HTML entry point: ${entryPoint}`);
    
    console.log('[TRACE] /api/process-file: Starting AI security analysis.');
    const securityWarning = await detectMaliciousArchive(textFileContents);
    console.log(`[TRACE] /api/process-file: AI security analysis complete. Warning: ${securityWarning || 'None'}`);

    const result = { previewId, entryPoint, securityWarning };
    console.log('[TRACE] /api/process-file: Successfully prepared result. Sending response.', result);
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error(`[TRACE] /api/process-file: CRITICAL error during processing. Cleaning up cache for ${previewId}.`, error);
    fileCache.cleanup(previewId);
    return NextResponse.json({ error: `Failed to process ZIP file. ${error.message}` }, { status: 500 });
  }
}

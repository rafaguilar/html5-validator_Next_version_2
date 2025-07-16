
'use server';

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { fileCache } from '@/lib/file-cache';
import { findHtmlFile } from '@/lib/utils';
import { detectMaliciousArchive } from '@/ai/flows/detect-malicious-archive';

interface ProcessedResult {
  previewId: string;
  entryPoint: string;
  securityWarning: string | null;
}

export async function processAndCacheFile(formData: FormData): Promise<ProcessedResult | { error: string }> {
  console.log("[DIAG_ACTION] processAndCacheFile started");
  const file = formData.get('file') as File;
  if (!file) {
    console.error("[DIAG_ACTION] No file found in formData");
    return { error: 'No file uploaded.' };
  }

  const previewId = uuidv4();
  
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    const fileEntries = Object.values(zip.files);
    const filesToCache = new Map<string, Buffer>();

    const writePromises: Promise<void>[] = [];

    for (const entry of fileEntries) {
      if (entry.dir || entry.name.startsWith('__MACOSX/')) {
        continue;
      }

      filePaths.push(entry.name);
      
      const fileBuffer = await entry.async('nodebuffer');
      filesToCache.set(entry.name, fileBuffer);
      
      const fileExt = path.extname(entry.name).toLowerCase();
      if (textFileExtensions.includes(fileExt)) {
          try {
            textFileContents.push({
                name: entry.name,
                content: fileBuffer.toString('utf-8')
            });
          } catch (e) {
            // Non-critical error, skip for AI analysis
          }
      }
    }
    
    // This was missing the await, causing the function to potentially return before caching was complete.
    await fileCache.set(previewId, filesToCache);
    console.log(`[DIAG_ACTION] Successfully cached ${filesToCache.size} files for previewId ${previewId}`);

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error("[DIAG_ACTION] No HTML entry point found.");
      return { error: 'No HTML file found in the ZIP archive.' };
    }
    console.log(`[DIAG_ACTION] Found entry point: ${entryPoint}`);
    
    const securityWarning = await detectMaliciousArchive(textFileContents);
    if (securityWarning) {
      console.log(`[DIAG_ACTION] AI detected a security warning: ${securityWarning}`);
    }

    const result = { previewId, entryPoint, securityWarning };
    console.log("[DIAG_ACTION] processAndCacheFile finished successfully, returning:", result);
    return result;

  } catch (error: any) {
    console.error(`[DIAG_ACTION] Error in processAndCacheFile for previewId ${previewId}:`, error);
    fileCache.cleanup(previewId);
    return { error: `Failed to process ZIP file. ${error.message}` };
  }
}

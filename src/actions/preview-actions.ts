
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
  console.log('[Action] processAndCacheFile started.');
  const file = formData.get('file') as File;
  if (!file) {
    console.error('[Action] No file found on FormData.');
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

    for (const entry of fileEntries) {
      if (entry.dir || entry.name.startsWith('__MACOSX/')) {
        continue;
      }

      filePaths.push(entry.name);
      
      const fileBuffer = await entry.async('nodebuffer');
      filesToCache.set(entry.name, fileBuffer);
      
      if (textFileExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
          textFileContents.push({
              name: entry.name,
              content: fileBuffer.toString('utf-8')
          });
      }
    }

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      console.error('[Action] No HTML file found in ZIP for previewId:', previewId);
      return { error: 'No HTML file found in the ZIP archive.' };
    }
    
    console.log(`[Action] Caching ${filesToCache.size} files for previewId: ${previewId}`);
    // Set cache before running AI check, so we don't wait on AI to serve files
    await fileCache.set(previewId, filesToCache);
    
    console.log('[Action] Running AI security check...');
    const securityWarning = await detectMaliciousArchive(textFileContents);
    console.log('[Action] AI security check complete. Warning:', securityWarning);

    const result = { previewId, entryPoint, securityWarning };
    console.log('[Action] Successfully processed. Returning:', result);
    return result;

  } catch (error) {
    console.error('[Action] Critical error processing ZIP file:', error);
    // Cleanup attempt
    fileCache.cleanup(previewId);
    return { error: 'Failed to process ZIP file.' };
  }
}

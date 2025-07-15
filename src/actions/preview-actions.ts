
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
  const file = formData.get('file') as File;
  if (!file) {
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
      
      const fileExt = path.extname(entry.name).toLowerCase();
      if (textFileExtensions.includes(fileExt)) {
          try {
            textFileContents.push({
                name: entry.name,
                content: fileBuffer.toString('utf-8')
            });
          } catch (e) {
            console.warn(`Could not read file ${entry.name} as text, skipping for AI analysis.`);
          }
      }
    }

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      return { error: 'No HTML file found in the ZIP archive.' };
    }
    
    await fileCache.set(previewId, filesToCache);
    
    const securityWarning = await detectMaliciousArchive(textFileContents);

    const result = { previewId, entryPoint, securityWarning };
    return result;

  } catch (error) {
    console.error('[Action] Critical error processing ZIP file:', error);
    fileCache.cleanup(previewId);
    return { error: 'Failed to process ZIP file.' };
  }
}

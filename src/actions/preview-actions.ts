
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
  const tempDir = path.join(os.tmpdir(), 'html-validator-previews', previewId);
  
  try {
    await fs.mkdir(tempDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    const fileEntries = Object.values(zip.files);

    for (const entry of fileEntries) {
      if (entry.dir || entry.name.startsWith('__MACOSX/')) {
        continue;
      }

      const filePath = path.join(tempDir, entry.name);
      filePaths.push(entry.name);
      
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const fileBuffer = await entry.async('nodebuffer');
      await fs.writeFile(filePath, fileBuffer);
      
      if (textFileExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
          textFileContents.push({
              name: entry.name,
              content: fileBuffer.toString('utf-8')
          });
      }
    }

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      return { error: 'No HTML file found in the ZIP archive.' };
    }

    const securityWarning = await detectMaliciousArchive(textFileContents);

    fileCache.set(previewId, tempDir);

    return { previewId, entryPoint, securityWarning };
  } catch (error) {
    console.error('Error processing ZIP file:', error);
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
        console.error('Error cleaning up temp directory:', cleanupError);
    }
    return { error: 'Failed to process ZIP file.' };
  }
}

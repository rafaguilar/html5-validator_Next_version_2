
'use server';

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import yauzl from 'yauzl-promise';
import { Readable } from 'stream';
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
    const zip = await yauzl.fromBuffer(buffer);
    
    const filePaths: string[] = [];
    const textFileContents: { name: string; content: string }[] = [];
    const textFileExtensions = ['.html', '.css', '.js', '.json', '.txt', '.svg', '.xml'];

    for await (const entry of zip) {
      if (entry.filename.startsWith('__MACOSX/')) {
        continue;
      }

      const filePath = path.join(tempDir, entry.filename);
      filePaths.push(entry.filename);

      if (entry.filename.endsWith('/')) {
        await fs.mkdir(filePath, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const readStream = await entry.openReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of readStream) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);
        await fs.writeFile(filePath, fileBuffer);

        if (textFileExtensions.some(ext => entry.filename.toLowerCase().endsWith(ext))) {
            textFileContents.push({
                name: entry.filename,
                content: fileBuffer.toString('utf-8')
            });
        }
      }
    }
    await zip.close();

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

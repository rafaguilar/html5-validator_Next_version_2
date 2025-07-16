
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { fileCache } from '@/lib/file-cache';
import { findHtmlFile } from '@/lib/utils';
import { detectMaliciousArchive } from '@/ai/flows/detect-malicious-archive';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
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
      
      const fileExt = (/\.([^.]+)$/.exec(entry.name) || [''])[0].toLowerCase();
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

    const entryPoint = findHtmlFile(filePaths);
    if (!entryPoint) {
      return NextResponse.json({ error: 'No HTML file found in the ZIP archive.' }, { status: 400 });
    }
    
    const securityWarning = await detectMaliciousArchive(textFileContents);

    const result = { previewId, entryPoint, securityWarning };
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    fileCache.cleanup(previewId);
    return NextResponse.json({ error: `Failed to process ZIP file. ${error.message}` }, { status: 500 });
  }
}


import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

async function getFile(id: string, filePath: string): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  try {
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
      // Don't cleanup here, let the periodic cleanup handle it
      return undefined; // Expired
    }
  
    // Add retry logic for file system propagation delay
    for (let i = 0; i < 3; i++) {
        try {
            const buffer = await fs.readFile(fullPath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            return { buffer, contentType };
        } catch (e: any) {
            if (e.code === 'ENOENT' && i < 2) {
                // File not found, wait and retry
                await new Promise(resolve => setTimeout(resolve, 150)); // Wait 150ms
            } else if (e.code !== 'ENOENT') {
                 // Log non-ENOENT errors but don't re-throw to avoid crashing the function
                 console.error(`[preview.get] Error reading file (attempt ${i+1}):`, e);
                 return undefined;
            }
        }
    }
    return undefined; // Return undefined after all retries fail
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
        console.error(`[preview.get] Critical error for preview ${id}/${filePath}:`, error);
    }
    return undefined;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const [previewId, ...filePathParts] = params.slug;
  const relativePath = filePathParts.join('/');

  if (!previewId || !relativePath) {
    return new NextResponse('Invalid request', { status: 400 });
  }
  
  const fileData = await getFile(previewId, relativePath);

  if (!fileData) {
    // Return a plain text response for 404 to avoid browser MIME type errors
    return new NextResponse(`Preview asset not found or expired: /${relativePath}`, { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
    });
  }
  
  return new NextResponse(fileData.buffer, {
    status: 200,
    headers: {
      'Content-Type': fileData.contentType,
      'Content-Length': fileData.buffer.length.toString(),
    },
  });
}

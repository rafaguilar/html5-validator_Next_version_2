
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { fileCache } from '@/lib/file-cache';
import mime from 'mime-types';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  const [previewId, ...filePathParts] = params.slug;
  const relativePath = filePathParts.join('/');

  if (!previewId || !relativePath) {
    return new NextResponse('Invalid request', { status: 400 });
  }

  const tempDir = fileCache.get(previewId);
  if (!tempDir) {
    return new NextResponse('Preview not found or has expired', { status: 404 });
  }

  try {
    const fullPath = path.join(tempDir, relativePath);

    // Security check to prevent path traversal
    if (!fullPath.startsWith(tempDir)) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      return new NextResponse('Cannot serve directory', { status: 400 });
    }
    
    const fileContents = await fs.readFile(fullPath);
    const contentType = mime.lookup(fullPath) || 'application/octet-stream';

    return new NextResponse(fileContents, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
      },
    });
  } catch (error) {
    console.error(`File not found: ${relativePath}`, error);
    return new NextResponse('File not found', { status: 404 });
  }
}

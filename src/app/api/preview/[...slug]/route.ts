import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';
import { getGsapControllerScript } from '@/lib/gsap-controller';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

// Path rewriting is now done at upload time, so this function is simpler.
async function getFile(id: string, filePath: string, bannerId: string | null): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  try {
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
      return undefined; // Expired
    }
  
    for (let i = 0; i < 3; i++) {
        try {
            let buffer = await fs.readFile(fullPath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            
            // We still need to inject the GSAP controller script on-the-fly for HTML files.
            if (contentType === 'text/html' && bannerId) {
                let originalHtml = buffer.toString('utf-8');
                const controllerScript = await getGsapControllerScript();
                const scriptTag = `<script data-studio-id="gsap-controller" data-banner-id="${bannerId}">${controllerScript}</script>`;
                
                if (!originalHtml.includes('data-studio-id="gsap-controller"')) {
                     originalHtml = originalHtml.replace('</head>', `${scriptTag}\n</head>`);
                }
                
                buffer = Buffer.from(originalHtml, 'utf-8');
            }

            return { buffer, contentType };
        } catch (e: any) {
            if (e.code === 'ENOENT' && i < 2) {
                await new Promise(resolve => setTimeout(resolve, 150));
            } else if (e.code !== 'ENOENT') {
                 console.error(`[preview.get] Error reading file (attempt ${i+1}):`, e);
                 return undefined;
            }
        }
    }
    return undefined;
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
  const { searchParams } = new URL(request.url);
  const bannerId = searchParams.get('bannerId');

  const [previewId, ...filePathParts] = params.slug;
  const relativePath = filePathParts.join('/');

  if (!previewId || !relativePath) {
    return new NextResponse('Invalid request', { status: 400 });
  }
  
  const fileData = await getFile(previewId, relativePath, bannerId);

  if (!fileData) {
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

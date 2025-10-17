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

// This function includes a retry mechanism for file system reads.
async function getFile(id: string, filePath: string): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  // Security check: ensure the resolved path is still within the preview directory
  if (!fullPath.startsWith(previewDir)) {
      console.error(`[preview.get] Path traversal attempt blocked: ${filePath}`);
      return undefined;
  }

  try {
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
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
                console.warn(`[preview.get] File not found on attempt ${i+1}, retrying: ${fullPath}`);
                await new Promise(resolve => setTimeout(resolve, 150));
            } else if (e.code === 'ENOENT') {
                console.error(`[preview.get] File not found after all retries: ${fullPath}`, e);
                return undefined;
            } else {
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
  // Re-join the path, ensuring it's properly decoded
  const relativePath = filePathParts.map(part => decodeURIComponent(part)).join('/');

  if (!previewId || !relativePath) {
    return new NextResponse('Invalid request', { status: 400 });
  }
  
  const fileData = await getFile(previewId, relativePath);

  if (!fileData) {
    return new NextResponse(`Preview asset not found or expired: /${relativePath}`, { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
    });
  }

  // If the requested file is an HTML file, inject the controller script
  if (fileData.contentType === 'text/html') {
    try {
      const controllerScript = await getGsapControllerScript();
      const controllerScriptTag = `<script data-banner-id="${previewId}">${controllerScript}</script>`;
      
      let htmlContent = fileData.buffer.toString('utf-8');
      
      // Inject the script into the head
      if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', `${controllerScriptTag}\n</head>`);
      } else {
        htmlContent = controllerScriptTag + htmlContent;
      }
      
      const modifiedBuffer = Buffer.from(htmlContent, 'utf-8');

      return new NextResponse(modifiedBuffer, {
        status: 200,
        headers: {
          'Content-Type': fileData.contentType,
          'Content-Length': modifiedBuffer.length.toString(),
        },
      });

    } catch (scriptError) {
        console.error('[API/preview] Failed to inject controller script:', scriptError);
        // Serve original HTML if script injection fails
        return new NextResponse(fileData.buffer, {
          status: 200,
          headers: { 'Content-Type': fileData.contentType },
        });
    }
  }
  
  return new NextResponse(fileData.buffer, {
    status: 200,
    headers: {
      'Content-Type': fileData.contentType,
      'Content-Length': fileData.buffer.length.toString(),
    },
  });
}

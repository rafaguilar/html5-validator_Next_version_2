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

const rewriteHtmlPaths = async (htmlContent: string, previewId: string): Promise<string> => {
    let processedHtml = htmlContent;
    const previewDir = path.join(TEMP_DIR, previewId);

    // This function recursively finds all file paths in the directory
    const getFiles = async (dir: string): Promise<string[]> => {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map((dirent) => {
            const res = path.resolve(dir, dirent.name);
            return dirent.isDirectory() ? getFiles(res) : res;
        }));
        return Array.prototype.concat(...files);
    };

    try {
        const allFilePaths = await getFiles(previewDir);
        // Create a list of asset paths relative to the preview directory root
        const relativeAssetPaths = allFilePaths.map(f => path.relative(previewDir, f));

        // Sort by length, descending. This is crucial.
        // It ensures we replace "images/foo.jpg" before we replace "images/".
        relativeAssetPaths.sort((a, b) => b.length - a.length);

        for (const assetPath of relativeAssetPaths) {
            // We don't need to rewrite the HTML file itself.
            if (assetPath.toLowerCase().endsWith('.html')) continue;
            
            // The absolute path the browser will use to fetch the asset
            const absoluteUrl = `/api/preview/${previewId}/${assetPath}`;

            // Create a very broad but effective regex to find relative paths.
            // This looks for src="...", href='...', or url(...) that is NOT preceded
            // by 'http', 'https', 'data:', or a leading '/'.
            // This is more robust than just replacing the assetPath string.
            const regex = new RegExp(`(src|href|poster|data-src|xlink:href)=["'](?!https?://|data:|//|/)${assetPath}["']`, 'g');
            processedHtml = processedHtml.replace(regex, `$1="${absoluteUrl}"`);

            // Add a regex for CSS `url()` function calls
            const cssUrlRegex = new RegExp(`url\\(["']?(?!https?://|data:|//|/)${assetPath}["']?\\)`, 'g');
            processedHtml = processedHtml.replace(cssUrlRegex, `url(${absoluteUrl})`);
        }
    } catch(e) {
        console.error("[Path Rewrite] Failed to rewrite paths, previews may be broken.", e);
    }
    
    return processedHtml;
};

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
            
            if (contentType === 'text/html') {
                let originalHtml = buffer.toString('utf-8');
                
                // 1. Aggressively rewrite all relative asset paths to be absolute
                originalHtml = await rewriteHtmlPaths(originalHtml, id);
                
                // 2. Inject the GSAP controller script if bannerId is present
                if (bannerId) {
                    const controllerScript = await getGsapControllerScript();
                    const scriptTag = `<script data-studio-id="gsap-controller" data-banner-id="${bannerId}">${controllerScript}</script>`;
                    if (!originalHtml.includes('data-studio-id="gsap-controller"')) {
                         originalHtml = originalHtml.replace('</head>', `${scriptTag}\n</head>`);
                    }
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

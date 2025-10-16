import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const getGsapControlsInjection = () => {
    return `
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                // Check if GSAP's main objects are available
                if (typeof window.gsap === 'undefined' && typeof window.TweenLite === 'undefined' && typeof window.TimelineLite === 'undefined') {
                    console.log('GSAP not detected on page.');
                    return;
                }
                
                var gsap = window.gsap || {};
                var TimelineLite = window.TimelineLite || gsap.timeline;
                var TweenLite = window.TweenLite || gsap;

                var globalTimeline;

                function exportAndPause() {
                    try {
                        if (gsap && typeof gsap.exportRoot === 'function') {
                           globalTimeline = gsap.exportRoot();
                        } else if (typeof TimelineLite.exportRoot === 'function') {
                           globalTimeline = TimelineLite.exportRoot();
                        } else {
                            console.error('GSAP exportRoot not found.');
                            return;
                        }

                        globalTimeline.pause();
                        
                        var playBtn = document.getElementById('studio-play-btn');
                        if (playBtn) playBtn.style.display = 'block';

                        var pauseBtn = document.getElementById('studio-pause-btn');
                        if (pauseBtn) pauseBtn.style.display = 'none';

                    } catch(e) {
                        console.error('Error exporting GSAP root timeline:', e);
                    }
                }
                
                var style = document.createElement('style');
                style.innerHTML = \`
                    #studio-controls { position: absolute; top: 5px; right: 5px; z-index: 99999; display: flex; gap: 5px; }
                    .studio-btn { width: 32px; height: 32px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.4); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; }
                    .studio-btn:hover { background: rgba(0,0,0,0.8); }
                    .studio-btn svg { width: 16px; height: 16px; }
                \`;
                document.head.appendChild(style);

                var controlsContainer = document.createElement('div');
                controlsContainer.id = 'studio-controls';

                var pauseBtn = document.createElement('button');
                pauseBtn.id = 'studio-pause-btn';
                pauseBtn.className = 'studio-btn';
                pauseBtn.title = 'Pause';
                pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
                pauseBtn.onclick = exportAndPause;

                var playBtn = document.createElement('button');
                playBtn.id = 'studio-play-btn';
                playBtn.className = 'studio-btn';
                playBtn.title = 'Play';
                playBtn.style.display = 'none';
                playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
                playBtn.onclick = function() {
                    if (globalTimeline) {
                        globalTimeline.resume();
                        playBtn.style.display = 'none';
                        pauseBtn.style.display = 'block';
                    }
                };

                controlsContainer.appendChild(pauseBtn);
                controlsContainer.appendChild(playBtn);
                document.body.appendChild(controlsContainer);
                
                // Automatically pause on load
                setTimeout(exportAndPause, 100);
            });
        </script>
    `;
};


interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

async function getFile(id: string, filePath: string, controlsEnabled: boolean): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  try {
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
      return undefined; // Expired
    }
  
    // Using fs.access to check for file existence before reading
    await fs.access(fullPath);
    
    let buffer = await fs.readFile(fullPath);
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    
    // If it's the main HTML file and controls are enabled, inject the script
    if (contentType === 'text/html' && controlsEnabled) {
        const originalHtml = buffer.toString('utf-8');
        const modifiedHtml = originalHtml.replace('</body>', `${getGsapControlsInjection()}</body>`);
        buffer = Buffer.from(modifiedHtml, 'utf-8');
    }

    return { buffer, contentType };

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

  const url = new URL(request.url);
  const controlsEnabled = url.searchParams.get('enabled') === 'true';
  
  const fileData = await getFile(previewId, relativePath, controlsEnabled);

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

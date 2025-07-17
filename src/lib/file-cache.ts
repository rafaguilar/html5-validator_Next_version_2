
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import mime from 'mime-types';

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const TEMP_DIR = path.join(os.tmpdir(), 'html-validator-previews');

// Ensure the base temp directory exists on startup
fs.mkdir(TEMP_DIR, { recursive: true }).catch(err => {
    console.error("Failed to create base temp directory for cache.", err);
});


async function set(id: string, files: Map<string, Buffer>): Promise<void> {
  const previewDir = path.join(TEMP_DIR, id);
  await fs.mkdir(previewDir, { recursive: true });

  const writePromises = Array.from(files.entries()).map(async ([filePath, fileBuffer]) => {
    const absolutePath = path.join(previewDir, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, fileBuffer);
  });

  // This will throw if any file fails to write, which will be caught by the API route.
  await Promise.all(writePromises);
}

async function get(id: string, filePath: string): Promise<CachedFile | undefined> {
    const previewDir = path.join(TEMP_DIR, id);
    const absolutePath = path.join(previewDir, filePath);

    // Security check to prevent path traversal attacks
    if (!absolutePath.startsWith(previewDir)) {
        console.warn(`Path traversal attempt blocked: ${filePath}`);
        return undefined;
    }

    try {
        const fileStat = await fs.stat(absolutePath);
        if(fileStat.isDirectory()) {
            return undefined; // Don't serve directories
        }
        
        const buffer = await fs.readFile(absolutePath);
        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';

        // Check if the directory has expired (by checking its creation time)
        const dirStat = await fs.stat(previewDir);
        if(Date.now() - dirStat.mtime.getTime() > CACHE_TTL_MS) {
            cleanup(id);
            return undefined; // Entry has expired
        }

        return { buffer, contentType };
    } catch (error) {
        // This is expected if the file or directory doesn't exist (e.g., expired and cleaned up)
        return undefined;
    }
}

async function cleanup(id: string) {
    const previewDir = path.join(TEMP_DIR, id);
    try {
        await fs.rm(previewDir, { recursive: true, force: true });
    } catch (err) {
        // It's okay if it fails, might have been cleaned up already.
        // console.error(`Failed to delete expired cache directory: ${previewDir}`, err);
    }
}

function scheduleCleanup(id: string) {
    setTimeout(() => {
        cleanup(id);
    }, CACHE_TTL_MS);
}

export const fileCache = {
  set,
  get,
  cleanup,
  scheduleCleanup,
};

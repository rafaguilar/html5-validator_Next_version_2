
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
  
  try {
    await fs.mkdir(previewDir, { recursive: true });

    for (const [filePath, fileBuffer] of files.entries()) {
      const absolutePath = path.join(previewDir, filePath);
      // Ensure parent directories exist for nested files in zip
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, fileBuffer);
    }

    // Schedule the cleanup of the directory after the TTL
    setTimeout(() => {
      cleanup(id);
    }, CACHE_TTL_MS);

  } catch (error) {
      console.error(`Failed to set cache for previewId ${id}`, error);
      // If setting cache fails, attempt to clean up whatever was created
      await cleanup(id);
      // Re-throw error to be caught by the caller
      throw error;
  }
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

export const fileCache = {
  set,
  get,
  cleanup,
};


import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

const TEMP_DIR = '/tmp/html-validator-previews';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function ensureTempDirExists() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to create temp directory:", error);
    // This might fail in some environments, but we proceed as fs.writeFile can create directories.
  }
}

async function set(id: string, filesToCache: Map<string, Buffer>): Promise<void> {
  const previewDir = path.join(TEMP_DIR, id);
  try {
    await fs.mkdir(previewDir, { recursive: true });

    const writePromises = Array.from(filesToCache.entries()).map(async ([filePath, fileBuffer]) => {
      const fullPath = path.join(previewDir, filePath);
      const dirName = path.dirname(fullPath);
      await fs.mkdir(dirName, { recursive: true });
      return fs.writeFile(fullPath, fileBuffer);
    });

    await Promise.all(writePromises);
    
    // Set a timestamp file to manage expiration
    const timestampPath = path.join(previewDir, '.timestamp');
    await fs.writeFile(timestampPath, Date.now().toString());

  } catch (error) {
    console.error(`[fileCache.set] Failed to write files for preview ID ${id}:`, error);
    // Attempt to clean up partially written directory on failure
    await cleanup(id);
    throw error; // Re-throw the error to be handled by the caller
  }
}


async function get(id: string, filePath: string): Promise<CachedFile | undefined> {
  const previewDir = path.join(TEMP_DIR, id);
  const fullPath = path.join(previewDir, filePath);

  try {
    // Check for expiration by reading the timestamp file
    const timestampPath = path.join(previewDir, '.timestamp');
    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
    const timestamp = parseInt(timestampContent, 10);

    if (Date.now() - timestamp > CACHE_TTL_MS) {
      await cleanup(id);
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
            } else {
                throw e; // Re-throw other errors or on final attempt
            }
        }
    }
    return undefined; // Return undefined after all retries fail
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
        console.error(`[fileCache.get] Error reading file for preview ${id}/${filePath}:`, error);
    }
    return undefined;
  }
}


async function cleanup(id: string): Promise<void> {
  const previewDir = path.join(TEMP_DIR, id);
  try {
    const stats = await fs.stat(previewDir);
    if (stats.isDirectory()) {
      await fs.rm(previewDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') { // Ignore error if directory doesn't exist
      console.error(`Failed to cleanup preview directory ${id}:`, error);
    }
  }
}

function scheduleCleanup(id: string) {
  setTimeout(() => {
    cleanup(id).catch(console.error);
  }, CACHE_TTL_MS);
}

// Periodically clean up all expired entries
async function cleanupAllExpired() {
    try {
        await ensureTempDirExists();
        const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
        const now = Date.now();

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const previewDir = path.join(TEMP_DIR, entry.name);
                const timestampPath = path.join(previewDir, '.timestamp');
                try {
                    const timestampContent = await fs.readFile(timestampPath, 'utf-8');
                    const timestamp = parseInt(timestampContent, 10);
                    if (now - timestamp > CACHE_TTL_MS) {
                        await cleanup(entry.name);
                    }
                } catch (e) {
                    // If timestamp is missing or unreadable, clean it up.
                    await cleanup(entry.name);
                }
            }
        }
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.error("Error during periodic cleanup of expired previews:", error);
        }
    }
}

// Run cleanup periodically
setInterval(() => {
    cleanupAllExpired().catch(console.error);
}, CACHE_TTL_MS / 2);


export const fileCache = {
  set,
  get,
  cleanup,
  scheduleCleanup,
};

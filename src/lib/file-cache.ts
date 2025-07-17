
import mime from 'mime-types';

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

interface CacheEntry {
  files: Map<string, CachedFile>;
  timestamp: number;
}

// In-memory cache
const memoryCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function set(id: string, filesToCache: Map<string, Buffer>): Promise<void> {
  const filesForCache = new Map<string, CachedFile>();
  for (const [filePath, fileBuffer] of filesToCache.entries()) {
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    filesForCache.set(filePath, {
      buffer: fileBuffer,
      contentType: contentType,
    });
  }

  memoryCache.set(id, {
    files: filesForCache,
    timestamp: Date.now(),
  });
  
  // No need to await, operation is synchronous
  return Promise.resolve();
}

async function get(id: string, filePath: string): Promise<CachedFile | undefined> {
  const entry = memoryCache.get(id);

  if (!entry) {
    return undefined; // Preview ID not found
  }

  // Check for expiration
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cleanup(id);
    return undefined; // Expired
  }

  return entry.files.get(filePath);
}

function cleanup(id: string) {
  memoryCache.delete(id);
}

function scheduleCleanup(id: string) {
  setTimeout(() => {
    cleanup(id);
  }, CACHE_TTL_MS);
}

// Periodically clean up expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of memoryCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cleanup(id);
    }
  }
}, CACHE_TTL_MS / 2);


export const fileCache = {
  set,
  get,
  cleanup,
  scheduleCleanup,
};

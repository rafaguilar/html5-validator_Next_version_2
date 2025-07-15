
import { promises as fs } from 'fs';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { path: string; timestamp: number }>();

function set(key: string, path: string) {
  const oldEntry = cache.get(key);
  if (oldEntry) {
    clearTimeout(oldEntry.timerId);
  }
  
  const timerId = setTimeout(() => {
    fs.rm(path, { recursive: true, force: true }).catch(err => {
      console.error(`Failed to delete expired cache directory: ${path}`, err);
    });
    cache.delete(key);
  }, CACHE_TTL_MS);

  // In Node.js timeout is an object, not a number, so we have to cast to any
  cache.set(key, { path, timestamp: Date.now(), timerId: timerId as any });
}

function get(key: string): string | undefined {
  const entry = cache.get(key);
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
    return entry.path;
  }
  if (entry) {
    // Entry expired
    cache.delete(key);
  }
  return undefined;
}

export const fileCache = {
  set,
  get,
};

// Extend the cache entry type to include the timer ID
declare module 'react' {
  interface CacheEntry {
    path: string;
    timestamp: number;
    timerId: NodeJS.Timeout;
  }
}

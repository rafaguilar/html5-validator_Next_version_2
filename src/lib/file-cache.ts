
import { promises as fs } from 'fs';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Correctly define the type for cache entries
interface CacheEntry {
  path: string;
  timestamp: number;
  timerId: NodeJS.Timeout;
}

const cache = new Map<string, CacheEntry>();

function set(key: string, path: string): void {
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

  cache.set(key, { path, timestamp: Date.now(), timerId });
}

function get(key: string): string | undefined {
  const entry = cache.get(key);
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
    return entry.path;
  }
  if (entry) {
    // Entry expired, clean it up
    clearTimeout(entry.timerId);
    fs.rm(entry.path, { recursive: true, force: true }).catch(err => {
      console.error(`Failed to delete expired cache directory on get: ${entry.path}`, err);
    });
    cache.delete(key);
  }
  return undefined;
}

export const fileCache = {
  set,
  get,
};

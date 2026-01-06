import * as fs from 'fs';

interface CacheEntry {
    content: string;
    mtime: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Gets cached file content if the cache is still valid (file hasn't been modified).
 * Returns null if the file is not cached or cache is stale.
 */
export function getCachedFile(filePath: string): string | null {
    const cached = cache.get(filePath);
    if (!cached) {
        return null;
    }

    try {
        const stats = fs.statSync(filePath);
        const currentMtime = stats.mtimeMs;

        if (currentMtime === cached.mtime) {
            return cached.content;
        }

        // Cache is stale, remove it
        cache.delete(filePath);
        return null;
    } catch (error) {
        // File might not exist anymore
        cache.delete(filePath);
        return null;
    }
}

/**
 * Sets a file's content in the cache with its current mtime.
 */
export function setCachedFile(filePath: string, content: string): void {
    try {
        const stats = fs.statSync(filePath);
        cache.set(filePath, {
            content,
            mtime: stats.mtimeMs
        });
    } catch (error) {
        // If we can't stat the file, don't cache it
    }
}

/**
 * Invalidates (removes) a file from the cache.
 * Call this when a file watcher detects changes.
 */
export function invalidateCache(filePath: string): void {
    cache.delete(filePath);
}

/**
 * Clears the entire cache.
 */
export function clearCache(): void {
    cache.clear();
}

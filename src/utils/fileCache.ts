/**
 * Simple cache invalidation tracking.
 * The cache map tracks invalidated files for potential future caching implementation.
 */
const cache = new Map<string, null>();

/**
 * Invalidates (removes) a file from the cache.
 * Call this when a file watcher detects changes.
 */
export function invalidateCache(filePath: string): void {
    cache.delete(filePath);
}

import type { SearchFilters, SearchResponse } from "@shared/schema";
import { searchVideos as fetchSearchVideos } from "./youtube";

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

interface CacheEntry {
  createdAt: number;
  expiresAt: number;
  promise: Promise<SearchResponse>;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cacheKey(filters: SearchFilters): string {
  return JSON.stringify({
    query: filters.query.trim().toLocaleLowerCase(),
    uploadDate: filters.uploadDate,
    duration: filters.duration,
    sortBy: filters.sortBy,
    maxResults: filters.maxResults,
  });
}

export function createYouTubeSearchCache(
  fetcher: (filters: SearchFilters) => Promise<SearchResponse>,
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? parsePositiveInt(process.env.YOUTUBE_CACHE_TTL_MS, DEFAULT_TTL_MS);
  const maxEntries = options.maxEntries ?? parsePositiveInt(process.env.YOUTUBE_CACHE_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  function prune(timestamp = now()) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= timestamp) cache.delete(key);
    }
    while (cache.size >= maxEntries) {
      const oldest = Array.from(cache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (!oldest) break;
      cache.delete(oldest[0]);
    }
  }

  async function search(filters: SearchFilters): Promise<SearchResponse> {
    const key = cacheKey(filters);
    const timestamp = now();
    const existing = cache.get(key);
    if (existing && existing.expiresAt > timestamp) return existing.promise;

    prune(timestamp);
    const promise = fetcher(filters).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, {
      createdAt: timestamp,
      expiresAt: timestamp + ttlMs,
      promise,
    });
    return promise;
  }

  return {
    search,
    clear: () => cache.clear(),
    size: () => cache.size,
  };
}

const defaultCache = createYouTubeSearchCache(fetchSearchVideos);

export const searchVideos = defaultCache.search;

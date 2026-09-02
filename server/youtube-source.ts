import type { SearchFilters, SearchResponse } from "@shared/schema";
import { ProviderError } from "./provider-errors";
import { searchVideos as searchWithDataApi } from "./youtube";
import {
  getYtDlpAvailability,
  getYtDlpPath,
  getYtDlpTimeoutMs,
  searchVideosWithYtDlp,
} from "./ytdlp";

export const YOUTUBE_SOURCE_MODES = ["auto", "api", "ytdlp"] as const;
export type YouTubeSourceMode = (typeof YOUTUBE_SOURCE_MODES)[number];

export function getYouTubeSourceMode(): YouTubeSourceMode {
  const value = process.env.YOUTUBE_SOURCE?.trim().toLowerCase();
  return YOUTUBE_SOURCE_MODES.includes(value as YouTubeSourceMode) ? value as YouTubeSourceMode : "auto";
}

export function getYouTubeSourceConfig() {
  return {
    mode: getYouTubeSourceMode(),
    dataApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    ytdlpPath: getYtDlpPath(),
    ytdlpTimeoutMs: getYtDlpTimeoutMs(),
  };
}

export async function getYouTubeSourceStatus(force = false) {
  const config = getYouTubeSourceConfig();
  const ytdlp = await getYtDlpAvailability(force);
  let preferred: "youtube-data-api-v3" | "yt-dlp" | "unavailable";
  if (config.mode === "api") preferred = config.dataApiConfigured ? "youtube-data-api-v3" : "unavailable";
  else if (config.mode === "ytdlp") preferred = ytdlp.available ? "yt-dlp" : "unavailable";
  else if (config.dataApiConfigured) preferred = "youtube-data-api-v3";
  else preferred = ytdlp.available ? "yt-dlp" : "unavailable";

  return { ...config, preferred, ytdlp };
}

function canFallbackFromDataApi(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  return [
    "missing_key",
    "invalid_key",
    "quota",
    "timeout",
    "network",
    "provider_server",
  ].includes(error.category);
}

export async function searchVideos(filters: SearchFilters): Promise<SearchResponse> {
  const mode = getYouTubeSourceMode();
  if (mode === "api") return searchWithDataApi(filters);
  if (mode === "ytdlp") return searchVideosWithYtDlp(filters);

  if (process.env.YOUTUBE_API_KEY?.trim()) {
    try {
      return await searchWithDataApi(filters);
    } catch (error) {
      if (!canFallbackFromDataApi(error)) throw error;
      const ytdlp = await getYtDlpAvailability();
      if (!ytdlp.available) throw error;
      const result = await searchVideosWithYtDlp(filters);
      result.warnings.unshift({
        code: "YOUTUBE_DATA_API_FALLBACK",
        stage: "search",
        message: `The official YouTube Data API was unavailable (${error instanceof ProviderError ? error.category : "unknown error"}); local yt-dlp was used instead.`,
      });
      return result;
    }
  }

  const ytdlp = await getYtDlpAvailability();
  if (ytdlp.available) return searchVideosWithYtDlp(filters);

  throw new ProviderError({
    message: "No YouTube research source is available. Configure a YouTube Data API key or install yt-dlp locally.",
    category: "missing_key",
    code: "YOUTUBE_SOURCE_UNAVAILABLE",
    status: 503,
    retryable: false,
  });
}

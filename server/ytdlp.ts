import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SearchFilters, SearchResponse, Video } from "@shared/schema";
import { DurationFilter, SortBy, UploadDateFilter } from "@shared/schema";
import { ProviderError } from "./provider-errors";
import { createSnapshotId } from "./youtube";

const execFileAsync = promisify(execFile);
const DEFAULT_YTDLP_PATH = "yt-dlp";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const AVAILABILITY_CACHE_MS = 60_000;
const VERSION_CHECK_TIMEOUT_MS = 10_000;

export type YtDlpAvailability = {
  available: boolean;
  executable: string;
  version?: string;
  checkedAt: string;
  error?: string;
};

export type TranscriptSegment = {
  startSeconds: number;
  durationSeconds: number;
  text: string;
};

export type TranscriptResult = {
  videoId: string;
  language: string;
  source: "yt-dlp";
  text: string;
  segments: TranscriptSegment[];
};

let availabilityCache: { expiresAt: number; executable: string; result: YtDlpAvailability } | undefined;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getYtDlpPath(): string {
  return process.env.YTDLP_PATH?.trim() || DEFAULT_YTDLP_PATH;
}

export function getYtDlpTimeoutMs(): number {
  return parsePositiveInt(process.env.YTDLP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function clearYtDlpAvailabilityCache() {
  availabilityCache = undefined;
}

function safeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function toIsoDuration(secondsValue: unknown): string | undefined {
  const seconds = safeNumber(secondsValue);
  if (seconds === undefined) return undefined;
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  let output = "PT";
  if (hours) output += `${hours}H`;
  if (minutes) output += `${minutes}M`;
  if (remainder || (!hours && !minutes)) output += `${remainder}S`;
  return output;
}

function publishedAt(record: Record<string, any>): string | undefined {
  const timestamp = safeNumber(record.timestamp ?? record.release_timestamp);
  if (timestamp !== undefined) return new Date(timestamp * 1000).toISOString();
  const date = typeof record.upload_date === "string" ? record.upload_date : "";
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`;
  return undefined;
}

function bestThumbnail(record: Record<string, any>, videoId: string): string {
  if (typeof record.thumbnail === "string" && /^https?:\/\//.test(record.thumbnail)) return record.thumbnail;
  if (Array.isArray(record.thumbnails)) {
    const candidates = record.thumbnails
      .map((item: any) => typeof item?.url === "string" ? item.url : "")
      .filter((url: string) => /^https?:\/\//.test(url));
    if (candidates.length) return candidates[candidates.length - 1];
  }
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length ? items : undefined;
}

export function mapYtDlpVideo(record: Record<string, any>): Video | null {
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const date = publishedAt(record);
  if (!id || !title || !date) return null;

  const channelTitle = String(record.channel || record.uploader || "Unknown channel").trim().slice(0, 200) || "Unknown channel";
  const channelId = String(record.channel_id || record.uploader_id || `unknown-${id}`).trim().slice(0, 128) || `unknown-${id}`;
  const subscriberCount = safeNumber(record.channel_follower_count);
  const height = safeNumber(record.height);
  const subtitles = record.subtitles && typeof record.subtitles === "object" ? Object.keys(record.subtitles) : [];
  const automaticCaptions = record.automatic_captions && typeof record.automatic_captions === "object"
    ? Object.keys(record.automatic_captions)
    : [];

  return {
    id: id.slice(0, 128),
    title: title.slice(0, 500),
    channelTitle,
    channelId,
    publishedAt: date,
    thumbnailUrl: bestThumbnail(record, id),
    description: typeof record.description === "string" ? record.description.slice(0, 10_000) : "",
    viewCount: safeNumber(record.view_count),
    likeCount: safeNumber(record.like_count),
    commentCount: safeNumber(record.comment_count),
    duration: toIsoDuration(record.duration),
    tags: boundedStrings(record.tags, 100, 200),
    liveBroadcastContent: record.is_live ? "live" : record.live_status === "is_upcoming" ? "upcoming" : "none",
    defaultLanguage: typeof record.language === "string" ? record.language.slice(0, 35) : undefined,
    defaultAudioLanguage: typeof record.language === "string" ? record.language.slice(0, 35) : undefined,
    definition: height !== undefined ? (height >= 720 ? "hd" : "sd") : undefined,
    hasCaptions: subtitles.length > 0 || automaticCaptions.length > 0,
    embeddable: typeof record.playable_in_embed === "boolean" ? record.playable_in_embed : undefined,
    channelStatistics: subscriberCount !== undefined ? {
      subscriberCount,
      hiddenSubscriberCount: false,
      thumbnailUrl: undefined,
    } : undefined,
  };
}

function uploadThreshold(uploadDate: UploadDateFilter, now = Date.now()): number | undefined {
  const date = new Date(now);
  switch (uploadDate) {
    case UploadDateFilter.HOUR:
      return now - 60 * 60 * 1000;
    case UploadDateFilter.TODAY:
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    case UploadDateFilter.WEEK:
      return now - 7 * 24 * 60 * 60 * 1000;
    case UploadDateFilter.MONTH:
      date.setMonth(date.getMonth() - 1);
      return date.getTime();
    case UploadDateFilter.YEAR:
      date.setFullYear(date.getFullYear() - 1);
      return date.getTime();
    default:
      return undefined;
  }
}

function matchesDuration(video: Video, duration: DurationFilter): boolean {
  if (duration === DurationFilter.ANY) return true;
  const match = video.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return false;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  if (duration === DurationFilter.SHORT) return seconds < 240;
  if (duration === DurationFilter.MEDIUM) return seconds >= 240 && seconds <= 1200;
  return seconds > 1200;
}

export function filterAndSortYtDlpVideos(videos: Video[], filters: SearchFilters, now = Date.now()): Video[] {
  const threshold = uploadThreshold(filters.uploadDate, now);
  let result = videos.filter((video) => {
    if (threshold !== undefined && new Date(video.publishedAt).getTime() < threshold) return false;
    return matchesDuration(video, filters.duration);
  });

  if (filters.sortBy === SortBy.DATE) {
    result = result.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  } else if (filters.sortBy === SortBy.VIEW_COUNT) {
    result = result.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  }
  return result.slice(0, filters.maxResults);
}

async function runYtDlp(
  args: string[],
  operation: string,
  timeoutMs = getYtDlpTimeoutMs(),
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(getYtDlpPath(), ["--no-config", ...args], {
      timeout: timeoutMs,
      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (cause: any) {
    if (cause?.code === "ENOENT") {
      throw new ProviderError({
        message: `yt-dlp executable was not found at ${getYtDlpPath()}.`,
        category: "provider_server",
        code: "YTDLP_NOT_INSTALLED",
        status: 503,
        retryable: false,
        cause,
      });
    }
    if (cause?.killed || cause?.signal === "SIGTERM" || /timed? ?out/i.test(String(cause?.message || ""))) {
      throw new ProviderError({
        message: `yt-dlp timed out during ${operation}.`,
        category: "timeout",
        code: "YTDLP_TIMEOUT",
        status: 504,
        retryable: true,
        cause,
      });
    }
    throw new ProviderError({
      message: `yt-dlp failed during ${operation}${cause?.stderr ? `: ${String(cause.stderr).slice(0, 300)}` : "."}`,
      category: "provider_server",
      code: "YTDLP_FAILED",
      status: 502,
      retryable: true,
      cause,
    });
  }
}

export async function getYtDlpAvailability(force = false): Promise<YtDlpAvailability> {
  const now = Date.now();
  const executable = getYtDlpPath();
  if (!force && availabilityCache && availabilityCache.expiresAt > now && availabilityCache.executable === executable) {
    return availabilityCache.result;
  }

  let result: YtDlpAvailability;
  try {
    const { stdout } = await runYtDlp(["--version"], "version check", Math.min(getYtDlpTimeoutMs(), VERSION_CHECK_TIMEOUT_MS));
    result = {
      available: true,
      executable,
      version: stdout.trim().split(/\r?\n/)[0] || "unknown",
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    result = {
      available: false,
      executable,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
  availabilityCache = { expiresAt: now + AVAILABILITY_CACHE_MS, executable, result };
  return result;
}

export async function searchVideosWithYtDlp(filters: SearchFilters): Promise<SearchResponse> {
  const candidateCount = Math.min(100, Math.max(filters.maxResults, filters.maxResults * 3));
  const searchPrefix = filters.sortBy === SortBy.DATE ? "ytsearchdate" : "ytsearch";
  const target = `${searchPrefix}${candidateCount}:${filters.query}`;
  const { stdout, stderr } = await runYtDlp([
    "--dump-json",
    "--skip-download",
    "--ignore-errors",
    "--no-warnings",
    target,
  ], "YouTube search");

  const parsedRows: Record<string, any>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") parsedRows.push(value);
    } catch {
      // Ignore isolated malformed rows; yt-dlp can continue after individual extraction errors.
    }
  }
  if (parsedRows.length === 0 && stderr.trim()) {
    throw new ProviderError({
      message: `yt-dlp returned no usable search metadata: ${stderr.trim().slice(0, 300)}`,
      category: "provider_server",
      code: "YTDLP_EMPTY_SEARCH_FAILURE",
      status: 502,
      retryable: true,
    });
  }

  const mapped = parsedRows.map(mapYtDlpVideo).filter((video): video is Video => Boolean(video));
  const videos = filterAndSortYtDlpVideos(mapped, filters);
  const retrievedAt = new Date().toISOString();
  const orderedVideoIds = videos.map((video) => video.id);
  const warnings: SearchResponse["warnings"] = [{
    code: "YTDLP_RESEARCH_SOURCE",
    stage: "search",
    message: "Research used local yt-dlp instead of the YouTube Data API. Public metadata coverage and search ordering can differ from the official API.",
  }];
  if (filters.sortBy === SortBy.RATING) {
    warnings.push({
      code: "YTDLP_RATING_SORT_UNAVAILABLE",
      stage: "search",
      message: "yt-dlp does not expose YouTube's search rating order, so relevance order was retained.",
    });
  }
  if (videos.length < filters.maxResults) {
    warnings.push({
      code: "YTDLP_PARTIAL_SAMPLE",
      stage: "search",
      message: `yt-dlp returned ${videos.length} usable videos after filters; fewer than the requested ${filters.maxResults}.`,
    });
  }

  return {
    videos,
    totalResults: videos.length,
    resultsPerPage: videos.length,
    snapshotId: createSnapshotId(filters, orderedVideoIds, retrievedAt),
    retrievedAt,
    totalResultsIsApproximate: true,
    provenance: {
      provider: "yt-dlp",
      query: filters.query.trim(),
      filters: {
        uploadDate: filters.uploadDate,
        duration: filters.duration,
        sortBy: filters.sortBy,
        maxResults: filters.maxResults,
      },
      orderedVideoIds,
    },
    enrichment: {
      search: {
        status: videos.length >= filters.maxResults ? "complete" : "partial",
        requested: filters.maxResults,
        returned: videos.length,
      },
      videoDetails: {
        status: mapped.length === parsedRows.length ? "complete" : "partial",
        requested: parsedRows.length,
        returned: mapped.length,
      },
      channels: {
        status: videos.some((video) => video.channelStatistics?.subscriberCount !== undefined) ? "partial" : "skipped",
        requested: videos.length,
        returned: videos.filter((video) => video.channelStatistics?.subscriberCount !== undefined).length,
      },
    },
    warnings,
  };
}

function safeTranscriptLanguage(value: string | undefined): string {
  const language = (value || "en").trim();
  if (!/^[A-Za-z0-9._*-]{1,32}$/.test(language)) {
    throw new ProviderError({
      message: "Transcript language contains unsupported characters.",
      category: "invalid_response",
      code: "TRANSCRIPT_LANGUAGE_INVALID",
      status: 400,
      retryable: false,
    });
  }
  return language;
}

export function parseJson3Transcript(value: unknown): TranscriptSegment[] {
  const record = value && typeof value === "object" ? value as Record<string, any> : {};
  if (!Array.isArray(record.events)) return [];
  const segments: TranscriptSegment[] = [];
  for (const event of record.events) {
    if (!event || typeof event !== "object" || !Array.isArray(event.segs)) continue;
    const text = event.segs
      .map((segment: any) => typeof segment?.utf8 === "string" ? segment.utf8 : "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || /^\[(?:music|applause)\]$/i.test(text)) continue;
    segments.push({
      startSeconds: Math.max(0, Number(event.tStartMs || 0) / 1000),
      durationSeconds: Math.max(0, Number(event.dDurationMs || 0) / 1000),
      text,
    });
  }
  return segments;
}

export async function fetchTranscriptWithYtDlp(videoId: string, language?: string): Promise<TranscriptResult> {
  const cleanVideoId = videoId.trim();
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(cleanVideoId)) {
    throw new ProviderError({
      message: "Invalid YouTube video ID.",
      category: "invalid_response",
      code: "TRANSCRIPT_VIDEO_ID_INVALID",
      status: 400,
      retryable: false,
    });
  }
  const lang = safeTranscriptLanguage(language);
  const directory = await mkdtemp(path.join(os.tmpdir(), "youtubepro-transcript-"));
  const outputTemplate = path.join(directory, "transcript.%(language)s.%(ext)s");
  try {
    await runYtDlp([
      "--skip-download",
      "--no-playlist",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", `${lang}.*,${lang}`,
      "--sub-format", "json3",
      "--no-warnings",
      "-o", outputTemplate,
      `https://www.youtube.com/watch?v=${cleanVideoId}`,
    ], "transcript retrieval");

    const files = (await readdir(directory)).filter((name) => name.endsWith(".json3")).sort();
    if (!files.length) {
      throw new ProviderError({
        message: `No ${lang} transcript was available for this video.`,
        category: "invalid_response",
        code: "TRANSCRIPT_UNAVAILABLE",
        status: 404,
        retryable: false,
      });
    }

    const raw = await readFile(path.join(directory, files[0]), "utf8");
    const segments = parseJson3Transcript(JSON.parse(raw));
    if (!segments.length) {
      throw new ProviderError({
        message: "The transcript file contained no usable speech segments.",
        category: "invalid_response",
        code: "TRANSCRIPT_EMPTY",
        status: 404,
        retryable: false,
      });
    }
    return {
      videoId: cleanVideoId,
      language: lang,
      source: "yt-dlp",
      text: segments.map((segment) => segment.text).join(" ").slice(0, 200_000),
      segments: segments.slice(0, 10_000),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

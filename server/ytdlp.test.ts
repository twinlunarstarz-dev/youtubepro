import assert from "node:assert/strict";
import test from "node:test";
import {
  DurationFilter,
  SortBy,
  UploadDateFilter,
  searchProvenanceSchema,
  type SearchFilters,
} from "@shared/schema";
import {
  filterAndSortYtDlpVideos,
  mapYtDlpVideo,
  parseJson3Transcript,
} from "./ytdlp";

test("yt-dlp metadata maps into bounded research video records", () => {
  const video = mapYtDlpVideo({
    id: "abc123xyz00",
    title: "Local research result",
    uploader: "Creator",
    uploader_id: "creator-id",
    upload_date: "20260831",
    thumbnail: "https://i.ytimg.com/vi/abc123xyz00/hqdefault.jpg",
    description: "Description",
    view_count: 12345,
    like_count: 456,
    comment_count: 12,
    duration: 301,
    height: 1080,
    channel_follower_count: 9876,
    tags: ["AI", "YouTube"],
    automatic_captions: { en: [{}] },
  });

  assert.ok(video);
  assert.equal(video.id, "abc123xyz00");
  assert.equal(video.duration, "PT5M1S");
  assert.equal(video.definition, "hd");
  assert.equal(video.hasCaptions, true);
  assert.equal(video.channelStatistics?.subscriberCount, 9876);
});

test("yt-dlp fallback applies YouTube-compatible date/duration filters and local sort", () => {
  const base = {
    title: "Video",
    channelTitle: "Channel",
    channelId: "channel",
    thumbnailUrl: "https://i.ytimg.com/example.jpg",
    description: "",
  };
  const videos = [
    { ...base, id: "old", publishedAt: "2026-07-01T00:00:00.000Z", duration: "PT3M", viewCount: 5000 },
    { ...base, id: "new-low", publishedAt: "2026-08-31T00:00:00.000Z", duration: "PT5M", viewCount: 100 },
    { ...base, id: "new-high", publishedAt: "2026-08-30T00:00:00.000Z", duration: "PT6M", viewCount: 9000 },
  ];
  const filters: SearchFilters = {
    query: "test",
    uploadDate: UploadDateFilter.WEEK,
    duration: DurationFilter.MEDIUM,
    sortBy: SortBy.VIEW_COUNT,
    maxResults: 10,
  };
  const result = filterAndSortYtDlpVideos(videos, filters, Date.parse("2026-09-02T12:00:00.000Z"));
  assert.deepEqual(result.map((video) => video.id), ["new-high", "new-low"]);
});

test("json3 transcript parser keeps spoken caption segments", () => {
  const segments = parseJson3Transcript({
    events: [
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Hello " }, { utf8: "world" }] },
      { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] },
      { tStartMs: 6000, dDurationMs: 1500, segs: [{ utf8: "Second line" }] },
    ],
  });
  assert.deepEqual(segments, [
    { startSeconds: 1, durationSeconds: 2, text: "Hello world" },
    { startSeconds: 6, durationSeconds: 1.5, text: "Second line" },
  ]);
});

test("research provenance accepts official API and local yt-dlp sources", () => {
  const base = {
    query: "test",
    filters: {
      uploadDate: UploadDateFilter.ANY,
      duration: DurationFilter.ANY,
      sortBy: SortBy.RELEVANCE,
      maxResults: 25,
    },
    orderedVideoIds: ["abc123xyz00"],
  };
  assert.equal(searchProvenanceSchema.safeParse({ ...base, provider: "youtube-data-api-v3" }).success, true);
  assert.equal(searchProvenanceSchema.safeParse({ ...base, provider: "yt-dlp" }).success, true);
});

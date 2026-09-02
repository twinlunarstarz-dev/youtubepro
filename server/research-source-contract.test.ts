import assert from "node:assert/strict";
import test from "node:test";
import { apiKeySettingsSchema } from "./settings";
import { getYouTubeSourceMode, YOUTUBE_SOURCE_MODES } from "./youtube-source";

test("YouTube source settings accept only bounded supported values", () => {
  assert.deepEqual(YOUTUBE_SOURCE_MODES, ["auto", "api", "ytdlp"]);
  assert.equal(apiKeySettingsSchema.safeParse({
    youtubeSource: "ytdlp",
    ytdlpPath: "/usr/local/bin/yt-dlp",
    ytdlpTimeoutMs: 120000,
  }).success, true);
  assert.equal(apiKeySettingsSchema.safeParse({ youtubeSource: "scrape" }).success, false);
  assert.equal(apiKeySettingsSchema.safeParse({ ytdlpPath: "yt-dlp\n--evil" }).success, false);
  assert.equal(apiKeySettingsSchema.safeParse({ ytdlpTimeoutMs: 999 }).success, false);
});

test("YouTube source mode defaults safely for missing or invalid environment values", { concurrency: false }, () => {
  const previous = process.env.YOUTUBE_SOURCE;
  try {
    delete process.env.YOUTUBE_SOURCE;
    assert.equal(getYouTubeSourceMode(), "auto");
    process.env.YOUTUBE_SOURCE = "YTDLP";
    assert.equal(getYouTubeSourceMode(), "ytdlp");
    process.env.YOUTUBE_SOURCE = "unexpected";
    assert.equal(getYouTubeSourceMode(), "auto");
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_SOURCE;
    else process.env.YOUTUBE_SOURCE = previous;
  }
});

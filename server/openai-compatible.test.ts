import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";
import { DurationFilter, SortBy, UploadDateFilter, type SearchFilters, type SearchResponse } from "@shared/schema";
import { createYouTubeSearchCache } from "./youtube-cache";
import { extractNarrationText } from "./ai";
import {
  chatCompletion,
  configureAIProvider,
  generateImage,
  normalizeAIBaseUrl,
} from "./openai-compatible";

async function readJson(req: IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body ? JSON.parse(body) : {};
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((req, res) => void Promise.resolve(handler(req, res)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("normalizes OpenAI-compatible base URLs safely", () => {
  assert.equal(normalizeAIBaseUrl("http://127.0.0.1:8080/v1/"), "http://127.0.0.1:8080/v1");
  assert.throws(() => normalizeAIBaseUrl("file:///tmp/model"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeAIBaseUrl("http://user:pass@example.com/v1"), /API key field/);
});

test("chat completion works without an API key for local servers", { concurrency: false }, async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, undefined);
    const body = await readJson(req);
    assert.equal(body.model, "local-model");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "local response" } }] }));
  }, async (baseUrl) => {
    configureAIProvider({ baseUrl, apiKey: "", textModel: "local-model", imageModel: "" });
    assert.equal(await chatCompletion("hello"), "local response");
  });
});

test("JSON mode falls back when a compatible server rejects response_format", { concurrency: false }, async () => {
  let calls = 0;
  await withServer(async (req, res) => {
    calls += 1;
    const body = await readJson(req);
    res.setHeader("content-type", "application/json");
    if (body.response_format) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: "response_format is unsupported" } }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }] }));
  }, async (baseUrl) => {
    configureAIProvider({ baseUrl, apiKey: "", textModel: "local-model" });
    assert.equal(await chatCompletion("json please", { json: true }), '{"ok":true}');
    assert.equal(calls, 2);
  });
});

test("OpenAI-compatible image generation accepts base64 responses", { concurrency: false }, async () => {
  const image = Buffer.from("fake-png-bytes").toString("base64");
  await withServer(async (req, res) => {
    assert.equal(req.url, "/v1/images/generations");
    const body = await readJson(req);
    assert.equal(body.model, "local-image");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: image }] }));
  }, async (baseUrl) => {
    configureAIProvider({ baseUrl, apiKey: "", textModel: "local-model", imageModel: "local-image", imageSize: "1024x1024" });
    const result = await generateImage("thumbnail");
    assert.equal(result.imageData, `data:image/png;base64,${image}`);
  });
});

const cacheFilters: SearchFilters = {
  query: "local ai",
  uploadDate: UploadDateFilter.ANY,
  duration: DurationFilter.ANY,
  sortBy: SortBy.RELEVANCE,
  maxResults: 25,
};
const cacheResponse = { videos: [] } as unknown as SearchResponse;

test("YouTube cache reuses identical searches within the TTL and retries failures", async () => {
  let calls = 0;
  let now = 1_000;
  const cache = createYouTubeSearchCache(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return cacheResponse;
  }, { ttlMs: 500, maxEntries: 10, now: () => now });

  await assert.rejects(() => cache.search(cacheFilters), /temporary failure/);
  assert.equal(await cache.search(cacheFilters), cacheResponse);
  assert.equal(await cache.search({ ...cacheFilters, query: " LOCAL AI " }), cacheResponse);
  assert.equal(calls, 2);

  now += 501;
  assert.equal(await cache.search(cacheFilters), cacheResponse);
  assert.equal(calls, 3);
});

test("narration extraction is local and removes common script directions", () => {
  const script = `## HOOK\n[00:00]\n(Energetic delivery)\nNARRATOR: This is the line viewers should hear.\n\n[Cut to screen recording]\n**MAIN CONTENT:**\nHOST: Here is the second spoken sentence.\n\n(Music fades)\nCTA:\n`;
  assert.equal(
    extractNarrationText(script),
    "This is the line viewers should hear.\n\nHere is the second spoken sentence.",
  );
});

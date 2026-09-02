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
  getAIProviderConfig,
  listAIModels,
  normalizeAIBaseUrl,
  testAITextConnection,
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

test("text and image providers can use different endpoints and keys", { concurrency: false }, () => {
  configureAIProvider({
    textBaseUrl: "http://127.0.0.1:8080/v1",
    textApiKey: "text-key",
    textModel: "text-model",
    textTimeoutMs: 45_000,
    imageBaseUrl: "http://127.0.0.1:9090/v1",
    imageApiKey: "image-key",
    imageModel: "image-model",
    imageSize: "1024x1024",
    imageTimeoutMs: 180_000,
  });
  const config = getAIProviderConfig();
  assert.equal(config.textBaseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(config.textApiKey, "text-key");
  assert.equal(config.textModel, "text-model");
  assert.equal(config.textTimeoutMs, 45_000);
  assert.equal(config.imageBaseUrl, "http://127.0.0.1:9090/v1");
  assert.equal(config.imageApiKey, "image-key");
  assert.equal(config.imageModel, "image-model");
  assert.equal(config.imageTimeoutMs, 180_000);
});

test("legacy shared provider input still configures both endpoints", { concurrency: false }, () => {
  configureAIProvider({ baseUrl: "http://127.0.0.1:7777/v1", apiKey: "shared", textModel: "model" });
  const config = getAIProviderConfig();
  assert.equal(config.textBaseUrl, "http://127.0.0.1:7777/v1");
  assert.equal(config.imageBaseUrl, "http://127.0.0.1:7777/v1");
  assert.equal(config.textApiKey, "shared");
  assert.equal(config.imageApiKey, "shared");
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
    configureAIProvider({ textBaseUrl: baseUrl, textApiKey: "", textModel: "local-model", imageModel: "" });
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
    configureAIProvider({ textBaseUrl: baseUrl, textApiKey: "", textModel: "local-model" });
    assert.equal(await chatCompletion("json please", { json: true }), '{"ok":true}');
    assert.equal(calls, 2);
  });
});

test("model discovery uses the selected endpoint and optional key", { concurrency: false }, async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, "Bearer draft-key");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] }));
  }, async (baseUrl) => {
    const models = await listAIModels("text", { baseUrl, apiKey: "draft-key", timeoutMs: 5_000 });
    assert.deepEqual(models, ["model-b", "model-a"]);
  });
});

test("LLM connection test uses unsaved draft endpoint settings", { concurrency: false }, async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer probe-key");
    const body = await readJson(req);
    assert.equal(body.model, "probe-model");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
  }, async (baseUrl) => {
    const result = await testAITextConnection({ baseUrl, apiKey: "probe-key", model: "probe-model", timeoutMs: 5_000 });
    assert.equal(result.ok, true);
    assert.equal(result.model, "probe-model");
    assert.equal(result.responsePreview, "OK");
    assert.ok(result.latencyMs >= 0);
  });
});

test("OpenAI-compatible image generation accepts base64 responses from a separate endpoint", { concurrency: false }, async () => {
  const image = Buffer.from("fake-png-bytes").toString("base64");
  await withServer(async (req, res) => {
    assert.equal(req.url, "/v1/images/generations");
    assert.equal(req.headers.authorization, "Bearer image-secret");
    const body = await readJson(req);
    assert.equal(body.model, "local-image");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: image }] }));
  }, async (baseUrl) => {
    configureAIProvider({
      textBaseUrl: "http://127.0.0.1:65530/v1",
      textApiKey: "text-secret",
      textModel: "local-model",
      imageBaseUrl: baseUrl,
      imageApiKey: "image-secret",
      imageModel: "local-image",
      imageSize: "1024x1024",
    });
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

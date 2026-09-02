import { ProviderError } from "./provider-errors";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8080/v1";
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_TEXT_MODEL = "local-model";
const DEFAULT_IMAGE_SIZE = "1536x1024";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 300_000;
const MAX_IMAGE_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_MODEL_RESULTS = 500;

export interface AIProviderConfig {
  // Backward-compatible aliases mirror the text provider.
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  textBaseUrl: string;
  textApiKey: string;
  textModel: string;
  textTimeoutMs: number;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageSize: string;
  imageTimeoutMs: number;
  legacyGeminiConfig: boolean;
}

export interface ConfigureAIProviderInput {
  textBaseUrl?: string;
  textApiKey?: string;
  textModel?: string;
  textTimeoutMs?: number;
  imageBaseUrl?: string;
  imageApiKey?: string;
  imageModel?: string;
  imageSize?: string;
  imageTimeoutMs?: number;
  // Backward-compatible shared aliases.
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface ChatCompletionOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface AIEndpointOverrides {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1_000 || value > 1_800_000) {
    throw new Error("AI timeouts must be whole milliseconds between 1000 and 1800000.");
  }
  return value;
}

export function normalizeAIBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("AI base URL is required.");
  if (trimmed.length > 2_048 || /[\r\n\0]/.test(trimmed)) {
    throw new Error("AI base URL is invalid.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("AI base URL must be a valid http:// or https:// URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("AI base URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Put authentication in the API key field, not in the AI base URL.");
  }
  return trimmed;
}

function cleanModel(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim() || "";
  if (trimmed.length > 256 || /[\r\n\0]/.test(trimmed)) {
    throw new Error("AI model IDs must be 256 characters or fewer.");
  }
  return trimmed || fallback;
}

function cleanImageSize(value: string | undefined): string {
  const trimmed = value?.trim() || DEFAULT_IMAGE_SIZE;
  if (!/^(?:auto|\d{2,5}x\d{2,5})$/i.test(trimmed)) {
    throw new Error("AI image size must be 'auto' or WIDTHxHEIGHT, for example 1536x1024.");
  }
  return trimmed;
}

function initialConfig(): AIProviderConfig {
  const explicitKeys = [
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_TEXT_BASE_URL",
    "AI_TEXT_API_KEY",
    "AI_TEXT_MODEL",
    "AI_IMAGE_BASE_URL",
    "AI_IMAGE_API_KEY",
    "AI_IMAGE_MODEL",
    "AI_IMAGE_SIZE",
  ];
  const hasExplicitAIConfig = explicitKeys.some((key) => Object.prototype.hasOwnProperty.call(process.env, key));
  const legacyGeminiConfig = !hasExplicitAIConfig && Boolean(process.env.GEMINI_API_KEY?.trim());

  const sharedBaseUrl = process.env.AI_BASE_URL
    || (legacyGeminiConfig ? GEMINI_OPENAI_BASE_URL : DEFAULT_LOCAL_BASE_URL);
  const textBaseUrl = normalizeAIBaseUrl(process.env.AI_TEXT_BASE_URL || sharedBaseUrl);
  const imageBaseUrl = normalizeAIBaseUrl(process.env.AI_IMAGE_BASE_URL || sharedBaseUrl || textBaseUrl);
  const sharedApiKey = (process.env.AI_API_KEY ?? (legacyGeminiConfig ? process.env.GEMINI_API_KEY : ""))?.trim() || "";

  const textApiKey = (process.env.AI_TEXT_API_KEY ?? sharedApiKey).trim();
  const textTimeoutMs = parsePositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl: textBaseUrl,
    apiKey: textApiKey,
    timeoutMs: textTimeoutMs,
    textBaseUrl,
    textApiKey,
    textModel: cleanModel(
      process.env.AI_TEXT_MODEL ?? (legacyGeminiConfig ? process.env.GEMINI_TEXT_MODEL : undefined),
      DEFAULT_TEXT_MODEL,
    ),
    textTimeoutMs,
    imageBaseUrl,
    imageApiKey: (process.env.AI_IMAGE_API_KEY ?? sharedApiKey).trim(),
    imageModel: cleanModel(
      process.env.AI_IMAGE_MODEL ?? (legacyGeminiConfig ? process.env.GEMINI_IMAGE_MODEL : undefined),
    ),
    imageSize: cleanImageSize(process.env.AI_IMAGE_SIZE),
    imageTimeoutMs: parsePositiveInt(process.env.AI_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS),
    legacyGeminiConfig,
  };
}

let providerConfig = initialConfig();

export function getAIProviderConfig(): AIProviderConfig {
  return { ...providerConfig };
}

export function configureAIProvider(input: ConfigureAIProviderInput): AIProviderConfig {
  const sharedBaseUrl = input.baseUrl !== undefined ? normalizeAIBaseUrl(input.baseUrl) : undefined;
  const sharedApiKey = input.apiKey !== undefined ? input.apiKey.trim() : undefined;
  const sharedTimeoutMs = input.timeoutMs !== undefined
    ? cleanTimeout(input.timeoutMs, providerConfig.textTimeoutMs)
    : undefined;

  const nextTextBaseUrl = input.textBaseUrl !== undefined
    ? normalizeAIBaseUrl(input.textBaseUrl)
    : sharedBaseUrl ?? providerConfig.textBaseUrl;
  const nextTextApiKey = input.textApiKey !== undefined
    ? input.textApiKey.trim()
    : sharedApiKey ?? providerConfig.textApiKey;
  const nextTextTimeoutMs = input.textTimeoutMs !== undefined
    ? cleanTimeout(input.textTimeoutMs, providerConfig.textTimeoutMs)
    : sharedTimeoutMs ?? providerConfig.textTimeoutMs;

  providerConfig = {
    ...providerConfig,
    baseUrl: nextTextBaseUrl,
    apiKey: nextTextApiKey,
    timeoutMs: nextTextTimeoutMs,
    textBaseUrl: nextTextBaseUrl,
    textApiKey: nextTextApiKey,
    textModel: input.textModel !== undefined
      ? cleanModel(input.textModel, DEFAULT_TEXT_MODEL)
      : providerConfig.textModel,
    textTimeoutMs: nextTextTimeoutMs,
    imageBaseUrl: input.imageBaseUrl !== undefined
      ? normalizeAIBaseUrl(input.imageBaseUrl)
      : sharedBaseUrl ?? providerConfig.imageBaseUrl,
    imageApiKey: input.imageApiKey !== undefined
      ? input.imageApiKey.trim()
      : sharedApiKey ?? providerConfig.imageApiKey,
    imageModel: input.imageModel !== undefined
      ? cleanModel(input.imageModel)
      : providerConfig.imageModel,
    imageSize: input.imageSize !== undefined
      ? cleanImageSize(input.imageSize)
      : providerConfig.imageSize,
    imageTimeoutMs: input.imageTimeoutMs !== undefined
      ? cleanTimeout(input.imageTimeoutMs, providerConfig.imageTimeoutMs)
      : providerConfig.imageTimeoutMs,
    legacyGeminiConfig: false,
  };

  // Persist active runtime values into process.env. Split values take precedence,
  // while the shared aliases remain useful to older installs and scripts.
  process.env.AI_TEXT_BASE_URL = providerConfig.textBaseUrl;
  process.env.AI_TEXT_API_KEY = providerConfig.textApiKey;
  process.env.AI_TEXT_MODEL = providerConfig.textModel;
  process.env.AI_TIMEOUT_MS = String(providerConfig.textTimeoutMs);
  process.env.AI_IMAGE_BASE_URL = providerConfig.imageBaseUrl;
  process.env.AI_IMAGE_API_KEY = providerConfig.imageApiKey;
  process.env.AI_IMAGE_MODEL = providerConfig.imageModel;
  process.env.AI_IMAGE_SIZE = providerConfig.imageSize;
  process.env.AI_IMAGE_TIMEOUT_MS = String(providerConfig.imageTimeoutMs);
  process.env.AI_BASE_URL = providerConfig.textBaseUrl;
  process.env.AI_API_KEY = providerConfig.textApiKey;
  return getAIProviderConfig();
}

export function isLocalAIEndpoint(baseUrl = providerConfig.textBaseUrl): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return true;
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    const match = /^172\.(\d{1,3})\./.exec(hostname);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function getProviderMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, any>;
  return [record.error?.message, record.error?.code, record.message, record.detail]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function httpProviderError(status: number, body: unknown, operation: string): ProviderError {
  const message = getProviderMessage(body).toLowerCase();
  if (status === 401 || status === 403 || /invalid.*key|unauthor|authentication|permission/.test(message)) {
    return new ProviderError({
      message: `The AI endpoint rejected authentication during ${operation}.`,
      category: "invalid_key",
      code: "AI_INVALID_KEY",
      status: 401,
      retryable: false,
    });
  }
  if (status === 408) {
    return new ProviderError({
      message: `The AI endpoint timed out during ${operation}.`,
      category: "timeout",
      code: "AI_TIMEOUT",
      status: 504,
      retryable: true,
    });
  }
  if (status === 429 || /quota|rate.?limit|too many requests/.test(message)) {
    return new ProviderError({
      message: `The AI endpoint rate limit or quota was unavailable during ${operation}.`,
      category: "quota",
      code: "AI_QUOTA",
      status: 429,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      message: `The AI endpoint returned a server error during ${operation}.`,
      category: "provider_server",
      code: "AI_PROVIDER_SERVER",
      status: 502,
      retryable: true,
    });
  }
  return new ProviderError({
    message: `The AI endpoint rejected the ${operation} request${message ? `: ${message.slice(0, 300)}` : "."}`,
    category: "invalid_response",
    code: status === 404 ? "AI_ENDPOINT_UNSUPPORTED" : "AI_REQUEST_REJECTED",
    status: 502,
    retryable: false,
  });
}

async function requestJson(
  method: "GET" | "POST",
  baseUrl: string,
  apiKey: string,
  path: string,
  operation: string,
  timeoutMs: number,
  body?: Record<string, unknown>,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(endpointUrl(baseUrl, path), {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    let parsed: unknown;
    const text = await response.text();
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (cause) {
      if (!response.ok) throw httpProviderError(response.status, { message: text.slice(0, 300) }, operation);
      throw new ProviderError({
        message: `The AI endpoint returned malformed JSON during ${operation}.`,
        category: "invalid_response",
        code: "AI_INVALID_JSON_RESPONSE",
        status: 502,
        retryable: false,
        cause,
      });
    }

    if (!response.ok) throw httpProviderError(response.status, parsed, operation);
    return { response, body: parsed };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError({
        message: `The AI endpoint timed out during ${operation}.`,
        category: "timeout",
        code: "AI_TIMEOUT",
        status: 504,
        retryable: true,
        cause: error,
      });
    }
    throw new ProviderError({
      message: `The AI endpoint could not be reached during ${operation}.`,
      category: "network",
      code: "AI_NETWORK",
      status: 502,
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  operation: string,
  timeoutMs: number,
): Promise<{ response: Response; body: unknown }> {
  return requestJson("POST", baseUrl, apiKey, path, operation, timeoutMs, body);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).join("");
  }
  return "";
}

function parseChatResponse(body: unknown): string {
  const record = body as any;
  const choice = Array.isArray(record?.choices) ? record.choices[0] : undefined;
  const text = contentToText(choice?.message?.content) || contentToText(choice?.text);
  if (!text.trim()) {
    throw new ProviderError({
      message: "The AI endpoint returned no chat-completion text.",
      category: "invalid_response",
      code: "AI_CHAT_EMPTY_RESPONSE",
      status: 502,
      retryable: false,
    });
  }
  return text.trim();
}

export function extractJsonPayload(text: string): string {
  let trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) trimmed = fenced[1].trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (objectStart >= 0 && objectEnd > objectStart && (arrayStart < 0 || objectStart < arrayStart)) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);
  return trimmed;
}

export async function chatCompletion(prompt: string, options: ChatCompletionOptions = {}): Promise<string> {
  if (!providerConfig.textModel) {
    throw new ProviderError({
      message: "AI text model is not configured.",
      category: "missing_key",
      code: "AI_TEXT_MODEL_MISSING",
      status: 503,
      retryable: false,
    });
  }

  const baseBody: Record<string, unknown> = {
    model: providerConfig.textModel,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };
  if (options.temperature !== undefined) baseBody.temperature = options.temperature;
  if (options.maxTokens !== undefined) baseBody.max_tokens = options.maxTokens;

  const structuredBody = options.json
    ? { ...baseBody, response_format: { type: "json_object" } }
    : baseBody;

  try {
    const result = await postJson(
      providerConfig.textBaseUrl,
      providerConfig.textApiKey,
      "/chat/completions",
      structuredBody,
      "chat completion",
      providerConfig.textTimeoutMs,
    );
    const text = parseChatResponse(result.body);
    return options.json ? extractJsonPayload(text) : text;
  } catch (error) {
    const canRetryWithoutResponseFormat = options.json
      && error instanceof ProviderError
      && error.code === "AI_REQUEST_REJECTED";
    if (!canRetryWithoutResponseFormat) throw error;

    const result = await postJson(
      providerConfig.textBaseUrl,
      providerConfig.textApiKey,
      "/chat/completions",
      baseBody,
      "chat completion",
      providerConfig.textTimeoutMs,
    );
    return extractJsonPayload(parseChatResponse(result.body));
  }
}

function resolveEndpoint(kind: "text" | "image", overrides: AIEndpointOverrides = {}) {
  const currentBaseUrl = kind === "text" ? providerConfig.textBaseUrl : providerConfig.imageBaseUrl;
  const currentApiKey = kind === "text" ? providerConfig.textApiKey : providerConfig.imageApiKey;
  const currentModel = kind === "text" ? providerConfig.textModel : providerConfig.imageModel;
  const currentTimeout = kind === "text" ? providerConfig.textTimeoutMs : providerConfig.imageTimeoutMs;
  return {
    baseUrl: overrides.baseUrl !== undefined ? normalizeAIBaseUrl(overrides.baseUrl) : currentBaseUrl,
    apiKey: overrides.apiKey !== undefined ? overrides.apiKey.trim() : currentApiKey,
    model: overrides.model !== undefined ? cleanModel(overrides.model) : currentModel,
    timeoutMs: overrides.timeoutMs !== undefined ? cleanTimeout(overrides.timeoutMs, currentTimeout) : currentTimeout,
  };
}

export async function listAIModels(
  kind: "text" | "image",
  overrides: AIEndpointOverrides = {},
): Promise<string[]> {
  const endpoint = resolveEndpoint(kind, overrides);
  const result = await requestJson(
    "GET",
    endpoint.baseUrl,
    endpoint.apiKey,
    "/models",
    `${kind} model discovery`,
    endpoint.timeoutMs,
  );
  const record = result.body as any;
  const data: unknown[] = Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const models: string[] = data
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "";
    })
    .map((value: string) => value.trim())
    .filter((value: string) => value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value));
  return Array.from(new Set(models)).slice(0, MAX_MODEL_RESULTS);
}

export async function testAITextConnection(overrides: AIEndpointOverrides = {}) {
  const endpoint = resolveEndpoint("text", overrides);
  if (!endpoint.model) throw new Error("AI text model is required for a connection test.");
  const startedAt = Date.now();
  const result = await postJson(
    endpoint.baseUrl,
    endpoint.apiKey,
    "/chat/completions",
    {
      model: endpoint.model,
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      stream: false,
    },
    "connection test",
    endpoint.timeoutMs,
  );
  const text = parseChatResponse(result.body);
  return {
    ok: true as const,
    model: endpoint.model,
    latencyMs: Date.now() - startedAt,
    responsePreview: text.slice(0, 120),
  };
}

async function fetchImageUrl(urlValue: string): Promise<string> {
  if (urlValue.startsWith("data:image/")) return urlValue;

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(urlValue, `${providerConfig.imageBaseUrl}/`);
  } catch {
    throw new ProviderError({
      message: "The AI endpoint returned an invalid image URL.",
      category: "invalid_response",
      code: "AI_IMAGE_INVALID_URL",
      status: 502,
      retryable: false,
    });
  }
  if (!["http:", "https:"].includes(resolvedUrl.protocol)) {
    throw new ProviderError({
      message: "The AI endpoint returned an unsupported image URL scheme.",
      category: "invalid_response",
      code: "AI_IMAGE_INVALID_URL",
      status: 502,
      retryable: false,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerConfig.imageTimeoutMs);
  try {
    const headers: Record<string, string> = {};
    const providerOrigin = new URL(providerConfig.imageBaseUrl).origin;
    if (providerConfig.imageApiKey && resolvedUrl.origin === providerOrigin) {
      headers.Authorization = `Bearer ${providerConfig.imageApiKey}`;
    }
    const response = await fetch(resolvedUrl, { headers, signal: controller.signal });
    if (!response.ok) throw httpProviderError(response.status, {}, "image download");
    const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!contentType.startsWith("image/")) {
      throw new ProviderError({
        message: "The AI endpoint returned an image URL with a non-image response.",
        category: "invalid_response",
        code: "AI_IMAGE_INVALID_CONTENT_TYPE",
        status: 502,
        retryable: false,
      });
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_RESPONSE_BYTES) {
      throw new ProviderError({
        message: "The generated image exceeded the 25 MB safety limit.",
        category: "invalid_response",
        code: "AI_IMAGE_TOO_LARGE",
        status: 502,
        retryable: false,
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_RESPONSE_BYTES) {
      throw new ProviderError({
        message: "The generated image exceeded the 25 MB safety limit.",
        category: "invalid_response",
        code: "AI_IMAGE_TOO_LARGE",
        status: 502,
        retryable: false,
      });
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError({
        message: "The generated image download timed out.",
        category: "timeout",
        code: "AI_IMAGE_DOWNLOAD_TIMEOUT",
        status: 504,
        retryable: true,
        cause: error,
      });
    }
    throw new ProviderError({
      message: "The generated image could not be downloaded.",
      category: "network",
      code: "AI_IMAGE_DOWNLOAD_NETWORK",
      status: 502,
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseImageResponse(body: unknown): { b64?: string; url?: string; revisedPrompt?: string } {
  const record = body as any;
  const first = Array.isArray(record?.data) ? record.data[0] : undefined;
  const b64 = typeof first?.b64_json === "string" ? first.b64_json : undefined;
  const url = typeof first?.url === "string" ? first.url : undefined;
  if (!b64 && !url) {
    throw new ProviderError({
      message: "The AI endpoint returned no image data or image URL.",
      category: "invalid_response",
      code: "AI_IMAGE_INVALID_RESPONSE",
      status: 502,
      retryable: false,
    });
  }
  return {
    b64,
    url,
    revisedPrompt: typeof first?.revised_prompt === "string" ? first.revised_prompt : undefined,
  };
}

export async function generateImage(prompt: string): Promise<{ imageData: string; revisedPrompt?: string }> {
  if (!providerConfig.imageModel) {
    throw new ProviderError({
      message: "AI image model is not configured. Text-only endpoints can still use Research, Ideas, and Script Writer.",
      category: "missing_key",
      code: "AI_IMAGE_MODEL_MISSING",
      status: 503,
      retryable: false,
    });
  }

  const baseBody: Record<string, unknown> = {
    model: providerConfig.imageModel,
    prompt,
    n: 1,
    size: providerConfig.imageSize,
  };

  let result: { response: Response; body: unknown };
  try {
    result = await postJson(
      providerConfig.imageBaseUrl,
      providerConfig.imageApiKey,
      "/images/generations",
      { ...baseBody, response_format: "b64_json" },
      "image generation",
      providerConfig.imageTimeoutMs,
    );
  } catch (error) {
    const canRetry = error instanceof ProviderError && error.code === "AI_REQUEST_REJECTED";
    if (!canRetry) throw error;
    result = await postJson(
      providerConfig.imageBaseUrl,
      providerConfig.imageApiKey,
      "/images/generations",
      baseBody,
      "image generation",
      providerConfig.imageTimeoutMs,
    );
  }

  const parsed = parseImageResponse(result.body);
  if (parsed.b64) {
    const compact = parsed.b64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      throw new ProviderError({
        message: "The AI endpoint returned malformed base64 image data.",
        category: "invalid_response",
        code: "AI_IMAGE_INVALID_BASE64",
        status: 502,
        retryable: false,
      });
    }
    return { imageData: `data:image/png;base64,${compact}`, revisedPrompt: parsed.revisedPrompt };
  }
  return { imageData: await fetchImageUrl(parsed.url!), revisedPrompt: parsed.revisedPrompt };
}

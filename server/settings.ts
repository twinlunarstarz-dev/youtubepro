import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import { z } from "zod";
import {
  configureAIProvider,
  getAIProviderConfig,
  isLocalAIEndpoint,
  normalizeAIBaseUrl,
} from "./openai-compatible";

const ENV_PATH = path.resolve(process.cwd(), ".env");
const ENV_TEMP_PATH = path.resolve(process.cwd(), ".env.tmp");
const SUPPORTED_KEYS = [
  "YOUTUBE_API_KEY",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_TEXT_BASE_URL",
  "AI_TEXT_API_KEY",
  "AI_TEXT_MODEL",
  "AI_TIMEOUT_MS",
  "AI_IMAGE_BASE_URL",
  "AI_IMAGE_API_KEY",
  "AI_IMAGE_MODEL",
  "AI_IMAGE_SIZE",
  "AI_IMAGE_TIMEOUT_MS",
] as const;

type SupportedKey = (typeof SUPPORTED_KEYS)[number];

export interface ApiKeySettings {
  youtubeApiKey?: string;
  clearYoutubeApiKey?: boolean;
  aiTextBaseUrl?: string;
  aiTextApiKey?: string;
  clearAiTextApiKey?: boolean;
  aiTextModel?: string;
  aiTextTimeoutMs?: number;
  aiImageBaseUrl?: string;
  aiImageApiKey?: string;
  clearAiImageApiKey?: boolean;
  aiImageModel?: string;
  aiImageSize?: string;
  aiImageTimeoutMs?: number;
  // Backward-compatible shared fields accepted from older UI builds.
  aiBaseUrl?: string;
  aiApiKey?: string;
  clearAiApiKey?: boolean;
}

const modelIdSchema = z.string().trim().min(1).max(256)
  .refine((value) => !/[\r\n\0]/.test(value), "Model ID contains unsupported characters.");
const optionalImageModelSchema = z.string().trim().max(256)
  .refine((value) => !/[\r\n\0]/.test(value), "Image model ID contains unsupported characters.");
const timeoutSchema = z.number().int().min(1_000).max(1_800_000);
const baseUrlSchema = z.string().trim().min(8).max(2_048);
const secretSchema = z.string().trim().min(1).max(2_048);

export const apiKeySettingsSchema = z.object({
  youtubeApiKey: z.string().trim().min(8).max(512).optional(),
  clearYoutubeApiKey: z.boolean().optional(),
  aiTextBaseUrl: baseUrlSchema.optional(),
  aiTextApiKey: secretSchema.optional(),
  clearAiTextApiKey: z.boolean().optional(),
  aiTextModel: modelIdSchema.optional(),
  aiTextTimeoutMs: timeoutSchema.optional(),
  aiImageBaseUrl: baseUrlSchema.optional(),
  aiImageApiKey: secretSchema.optional(),
  clearAiImageApiKey: z.boolean().optional(),
  aiImageModel: optionalImageModelSchema.optional(),
  aiImageSize: z.string().trim().regex(/^(?:auto|\d{2,5}x\d{2,5})$/i).optional(),
  aiImageTimeoutMs: timeoutSchema.optional(),
  aiBaseUrl: baseUrlSchema.optional(),
  aiApiKey: secretSchema.optional(),
  clearAiApiKey: z.boolean().optional(),
}).strict();

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1"
    || address === "::1"
    || address.startsWith("::ffff:127.");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export interface LocalSettingsRequestMetadata {
  remoteAddress?: string;
  host?: string;
  origin?: string;
  forwarded?: string;
  xForwardedFor?: string;
  xForwardedHost?: string;
  xForwardedProto?: string;
  via?: string;
  secFetchSite?: string;
}

export function isTrustedLocalSettingsMetadata(input: LocalSettingsRequestMetadata): boolean {
  if (!isLoopbackAddress(input.remoteAddress)) return false;
  if (
    input.forwarded
    || input.xForwardedFor
    || input.xForwardedHost
    || input.xForwardedProto
    || input.via
  ) return false;

  if (!input.host) return false;
  if (/[@/\\\s%]/.test(input.host)) return false;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${input.host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;

  if (input.origin) {
    try {
      const origin = new URL(input.origin);
      if (
        !["http:", "https:"].includes(origin.protocol)
        || !isLoopbackHostname(origin.hostname)
        || origin.host !== hostUrl.host
      ) return false;
    } catch {
      return false;
    }
  }

  return !input.secFetchSite || input.secFetchSite === "same-origin" || input.secFetchSite === "none";
}

export function isLocalSettingsRequest(req: Request): boolean {
  return isTrustedLocalSettingsMetadata({
    remoteAddress: req.socket.remoteAddress,
    host: req.get("host"),
    origin: req.get("origin"),
    forwarded: req.get("forwarded"),
    xForwardedFor: req.get("x-forwarded-for"),
    xForwardedHost: req.get("x-forwarded-host"),
    xForwardedProto: req.get("x-forwarded-proto"),
    via: req.get("via"),
    secFetchSite: req.get("sec-fetch-site"),
  });
}

export function getApiKeyStatus() {
  const ai = getAIProviderConfig();
  return {
    youtube: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    ai: {
      legacyGeminiConfig: ai.legacyGeminiConfig,
      text: {
        apiKeyConfigured: Boolean(ai.textApiKey),
        baseUrl: ai.textBaseUrl,
        model: ai.textModel,
        timeoutMs: ai.textTimeoutMs,
        localEndpoint: isLocalAIEndpoint(ai.textBaseUrl),
      },
      image: {
        apiKeyConfigured: Boolean(ai.imageApiKey),
        baseUrl: ai.imageBaseUrl,
        model: ai.imageModel,
        imageSize: ai.imageSize,
        timeoutMs: ai.imageTimeoutMs,
        localEndpoint: isLocalAIEndpoint(ai.imageBaseUrl),
      },
      // Compatibility aliases for clients built against the original generic settings shape.
      apiKeyConfigured: Boolean(ai.textApiKey),
      baseUrl: ai.textBaseUrl,
      textModel: ai.textModel,
      imageModel: ai.imageModel,
      imageSize: ai.imageSize,
      localEndpoint: isLocalAIEndpoint(ai.textBaseUrl),
      timeoutMs: ai.textTimeoutMs,
      imageTimeoutMs: ai.imageTimeoutMs,
    },
  };
}

function validateSecret(value: unknown, label: string, minLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length < minLength || trimmed.length > 2_048) {
    throw new Error(`${label} must be between ${minLength} and 2048 characters.`);
  }
  if (/\r|\n|\0/.test(trimmed)) throw new Error(`${label} contains unsupported characters.`);
  return trimmed;
}

function setEnvValue(contents: string, key: SupportedKey, value: string): string {
  const assignment = `${key}=${JSON.stringify(value)}`;
  const lines = contents.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (lineIndex >= 0) lines[lineIndex] = assignment;
  else {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(assignment);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function assertReplacementAndClear(replacement: string | undefined, clear: boolean, label: string) {
  if (replacement && clear) {
    throw new Error(`Choose either a replacement ${label} or clear the saved key, not both.`);
  }
}

export async function saveApiKeySettings(input: ApiKeySettings) {
  const youtubeApiKey = validateSecret(input.youtubeApiKey, "YouTube API key", 8);
  const sharedApiKey = validateSecret(input.aiApiKey, "AI API key", 1);
  const textApiKey = validateSecret(input.aiTextApiKey, "LLM API key", 1) ?? sharedApiKey;
  const imageApiKey = validateSecret(input.aiImageApiKey, "Image API key", 1) ?? sharedApiKey;
  const clearSharedKey = input.clearAiApiKey === true;
  const clearTextKey = input.clearAiTextApiKey === true || clearSharedKey;
  const clearImageKey = input.clearAiImageApiKey === true || clearSharedKey;
  const clearYoutubeKey = input.clearYoutubeApiKey === true;

  assertReplacementAndClear(youtubeApiKey, clearYoutubeKey, "YouTube API key");
  assertReplacementAndClear(textApiKey, clearTextKey, "LLM API key");
  assertReplacementAndClear(imageApiKey, clearImageKey, "Image API key");

  const current = getAIProviderConfig();
  const textBaseUrl = normalizeAIBaseUrl(input.aiTextBaseUrl ?? input.aiBaseUrl ?? current.textBaseUrl);
  const imageBaseUrl = normalizeAIBaseUrl(input.aiImageBaseUrl ?? input.aiBaseUrl ?? current.imageBaseUrl);
  const textModel = (input.aiTextModel ?? current.textModel).trim();
  const imageModel = input.aiImageModel !== undefined ? input.aiImageModel.trim() : current.imageModel;
  const imageSize = (input.aiImageSize ?? current.imageSize).trim();
  const textTimeoutMs = input.aiTextTimeoutMs ?? current.textTimeoutMs;
  const imageTimeoutMs = input.aiImageTimeoutMs ?? current.imageTimeoutMs;

  if (!textModel) throw new Error("AI text model is required.");
  if (!/^(?:auto|\d{2,5}x\d{2,5})$/i.test(imageSize)) {
    throw new Error("AI image size must be 'auto' or WIDTHxHEIGHT.");
  }
  if (!Number.isInteger(textTimeoutMs) || textTimeoutMs < 1_000 || textTimeoutMs > 1_800_000) {
    throw new Error("LLM timeout must be between 1000 and 1800000 milliseconds.");
  }
  if (!Number.isInteger(imageTimeoutMs) || imageTimeoutMs < 1_000 || imageTimeoutMs > 1_800_000) {
    throw new Error("Image timeout must be between 1000 and 1800000 milliseconds.");
  }

  const effectiveTextKey = clearTextKey ? "" : textApiKey ?? current.textApiKey;
  const effectiveImageKey = clearImageKey ? "" : imageApiKey ?? current.imageApiKey;
  const effectiveYoutubeKey = clearYoutubeKey ? "" : youtubeApiKey ?? process.env.YOUTUBE_API_KEY?.trim() ?? "";

  let contents = "";
  try {
    contents = await readFile(ENV_PATH, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  contents = setEnvValue(contents, "YOUTUBE_API_KEY", effectiveYoutubeKey);
  contents = setEnvValue(contents, "AI_TEXT_BASE_URL", textBaseUrl);
  contents = setEnvValue(contents, "AI_TEXT_API_KEY", effectiveTextKey);
  contents = setEnvValue(contents, "AI_TEXT_MODEL", textModel);
  contents = setEnvValue(contents, "AI_TIMEOUT_MS", String(textTimeoutMs));
  contents = setEnvValue(contents, "AI_IMAGE_BASE_URL", imageBaseUrl);
  contents = setEnvValue(contents, "AI_IMAGE_API_KEY", effectiveImageKey);
  contents = setEnvValue(contents, "AI_IMAGE_MODEL", imageModel);
  contents = setEnvValue(contents, "AI_IMAGE_SIZE", imageSize);
  contents = setEnvValue(contents, "AI_IMAGE_TIMEOUT_MS", String(imageTimeoutMs));
  // Keep the original shared aliases synchronized with text settings for older installs.
  contents = setEnvValue(contents, "AI_BASE_URL", textBaseUrl);
  contents = setEnvValue(contents, "AI_API_KEY", effectiveTextKey);

  await writeFile(ENV_TEMP_PATH, contents, { encoding: "utf8", mode: 0o600 });
  await rename(ENV_TEMP_PATH, ENV_PATH);
  await chmod(ENV_PATH, 0o600);

  process.env.YOUTUBE_API_KEY = effectiveYoutubeKey;
  configureAIProvider({
    textBaseUrl,
    textApiKey: effectiveTextKey,
    textModel,
    textTimeoutMs,
    imageBaseUrl,
    imageApiKey: effectiveImageKey,
    imageModel,
    imageSize,
    imageTimeoutMs,
  });

  return getApiKeyStatus();
}

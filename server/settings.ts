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
  "AI_TEXT_MODEL",
  "AI_IMAGE_MODEL",
  "AI_IMAGE_SIZE",
] as const;

type SupportedKey = (typeof SUPPORTED_KEYS)[number];

export interface ApiKeySettings {
  youtubeApiKey?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  clearAiApiKey?: boolean;
  aiTextModel?: string;
  aiImageModel?: string;
  aiImageSize?: string;
}

const modelIdSchema = z.string().trim().min(1).max(256).refine((value) => !/[\r\n\0]/.test(value), "Model ID contains unsupported characters.");
const optionalImageModelSchema = z.string().trim().max(256).refine((value) => !/[\r\n\0]/.test(value), "Image model ID contains unsupported characters.");

export const apiKeySettingsSchema = z.object({
  youtubeApiKey: z.string().trim().min(8).max(512).optional(),
  aiBaseUrl: z.string().trim().min(8).max(2_048).optional(),
  aiApiKey: z.string().trim().min(1).max(2_048).optional(),
  clearAiApiKey: z.boolean().optional(),
  aiTextModel: modelIdSchema.optional(),
  aiImageModel: optionalImageModelSchema.optional(),
  aiImageSize: z.string().trim().regex(/^(?:auto|\d{2,5}x\d{2,5})$/i).optional(),
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
      apiKeyConfigured: Boolean(ai.apiKey),
      baseUrl: ai.baseUrl,
      textModel: ai.textModel,
      imageModel: ai.imageModel,
      imageSize: ai.imageSize,
      localEndpoint: isLocalAIEndpoint(ai.baseUrl),
      legacyGeminiConfig: ai.legacyGeminiConfig,
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

export async function saveApiKeySettings(input: ApiKeySettings) {
  const youtubeApiKey = validateSecret(input.youtubeApiKey, "YouTube API key", 8);
  const aiApiKey = validateSecret(input.aiApiKey, "AI API key", 1);
  const current = getAIProviderConfig();
  const migratedLegacyApiKey = current.legacyGeminiConfig && !input.clearAiApiKey ? current.apiKey : undefined;
  const effectiveAiApiKey = aiApiKey ?? migratedLegacyApiKey;
  const baseUrl = normalizeAIBaseUrl(input.aiBaseUrl ?? current.baseUrl);
  const textModel = (input.aiTextModel ?? current.textModel).trim();
  const imageModel = input.aiImageModel !== undefined ? input.aiImageModel.trim() : current.imageModel;
  const imageSize = (input.aiImageSize ?? current.imageSize).trim();

  if (!textModel) throw new Error("AI text model is required.");
  if (!/^(?:auto|\d{2,5}x\d{2,5})$/i.test(imageSize)) {
    throw new Error("AI image size must be 'auto' or WIDTHxHEIGHT.");
  }
  if (input.clearAiApiKey && aiApiKey) {
    throw new Error("Choose either a replacement AI API key or clear the saved key, not both.");
  }

  let contents = "";
  try {
    contents = await readFile(ENV_PATH, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (youtubeApiKey) contents = setEnvValue(contents, "YOUTUBE_API_KEY", youtubeApiKey);
  contents = setEnvValue(contents, "AI_BASE_URL", baseUrl);
  contents = setEnvValue(contents, "AI_TEXT_MODEL", textModel);
  contents = setEnvValue(contents, "AI_IMAGE_MODEL", imageModel);
  contents = setEnvValue(contents, "AI_IMAGE_SIZE", imageSize);
  if (effectiveAiApiKey !== undefined) contents = setEnvValue(contents, "AI_API_KEY", effectiveAiApiKey);
  else if (input.clearAiApiKey) contents = setEnvValue(contents, "AI_API_KEY", "");

  await writeFile(ENV_TEMP_PATH, contents, { encoding: "utf8", mode: 0o600 });
  await rename(ENV_TEMP_PATH, ENV_PATH);
  await chmod(ENV_PATH, 0o600);

  if (youtubeApiKey) process.env.YOUTUBE_API_KEY = youtubeApiKey;
  configureAIProvider({
    baseUrl,
    textModel,
    imageModel,
    imageSize,
    ...(effectiveAiApiKey !== undefined ? { apiKey: effectiveAiApiKey } : {}),
    ...(input.clearAiApiKey ? { apiKey: "" } : {}),
  });

  return getApiKeyStatus();
}

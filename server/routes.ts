import type { Express } from "express";
import { createServer, type Server } from "http";
import { getYouTubeSearchCacheStats, searchVideos } from "./youtube-cache";
import { getYouTubeSourceStatus } from "./youtube-source";
import { fetchTranscriptWithYtDlp } from "./ytdlp";
import {
  extractNarrationText,
  generateIdeas,
  generateResearchInsights,
  generateScript,
  generateThumbnail,
  generateThumbnailSuggestions,
  regenerateParagraph,
  regenerateSection,
  regenerateTitles,
} from "./ai";
import { ideaGenerationRequestSchema, researchInsightsRequestSchema, searchFiltersSchema, scriptInputSchema } from "@shared/schema";
import { z } from "zod";
import { apiKeySettingsSchema, getApiKeyStatus, isLocalSettingsRequest, saveApiKeySettings } from "./settings";
import { normalizeProviderError, providerErrorPayload } from "./provider-errors";
import { thumbnailGenerationRequestSchema, thumbnailSuggestionsRequestSchema } from "./thumbnail-contract";
import {
  paragraphRegenerationRequestSchema,
  sectionRegenerationRequestSchema,
} from "./script-regeneration-contract";
import {
  narrationExtractionRequestSchema,
  titleRegenerationRequestSchema,
} from "./api-contracts";
import { createRateLimiter } from "./rate-limit";
import { listAIModels, testAITextConnection } from "./openai-compatible";

const { middleware: rateLimit } = createRateLimiter();

const aiEndpointProbeSchema = z.object({
  kind: z.enum(["text", "image"]),
  baseUrl: z.string().trim().min(8).max(2_048).optional(),
  apiKey: z.string().trim().max(2_048).optional(),
  model: z.string().trim().max(256).optional(),
  timeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
}).strict();

function getUserFriendlyError(error: any, context: string): { message: string; suggestion: string } {
  const providerError = normalizeProviderError(error, "ai");
  if (providerError.category === "invalid_key" || providerError.category === "missing_key") {
    return {
      message: `${context} is not configured`,
      suggestion: "Open Settings and check the AI endpoint, model, and optional API key.",
    };
  }
  if (providerError.category === "quota") {
    return {
      message: `${context} is experiencing high demand`,
      suggestion: "Wait and retry, or switch to a local OpenAI-compatible endpoint.",
    };
  }
  if (providerError.category === "timeout" || providerError.category === "network") {
    return {
      message: `${context} could not reach the AI endpoint`,
      suggestion: "Check that the configured local or remote server is running and reachable.",
    };
  }
  return {
    message: `${context} encountered an issue`,
    suggestion: "Retry once. If it continues, inspect the local provider logs or choose another compatible model.",
  };
}

function requireLocalSettings(req: Parameters<typeof isLocalSettingsRequest>[0], res: any): boolean {
  if (isLocalSettingsRequest(req)) return true;
  res.status(403).json({ error: "Settings are available only from this machine." });
  return false;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      service: "youtube-pro",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/api/settings/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireLocalSettings(req, res)) return;
    return res.json(getApiKeyStatus());
  });

  app.get("/api/settings/diagnostics", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireLocalSettings(req, res)) return;
    try {
      return res.json({
        research: await getYouTubeSourceStatus(true),
        cache: getYouTubeSearchCacheStats(),
      });
    } catch (error: unknown) {
      const providerError = normalizeProviderError(error, "youtube");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "Research diagnostics"));
    }
  });

  app.put("/api/settings/api-keys", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireLocalSettings(req, res)) return;

    try {
      const input = apiKeySettingsSchema.parse(req.body);
      const status = await saveApiKeySettings(input);
      return res.json({ success: true, status });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Unable to save API settings." });
    }
  });

  app.post("/api/settings/ai/models", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireLocalSettings(req, res)) return;
    try {
      const input = aiEndpointProbeSchema.parse(req.body);
      const models = await listAIModels(input.kind, {
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      return res.json({ models });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid model-discovery settings.", details: error.errors });
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/settings/ai/test", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireLocalSettings(req, res)) return;
    try {
      const input = aiEndpointProbeSchema.parse(req.body);
      if (input.kind !== "text") return res.status(400).json({ error: "Only LLM chat connections use the inference test. Use model discovery for image endpoints." });
      const result = await testAITextConnection({
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      return res.json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid connection-test settings.", details: error.errors });
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.get("/api/youtube/search", rateLimit, async (req, res) => {
    try {
      const { query, uploadDate, duration, sortBy, maxResults } = req.query;
      if (!query || typeof query !== "string") return res.status(400).json({ error: "Query parameter is required" });

      const filters = searchFiltersSchema.parse({
        query,
        uploadDate: uploadDate || "any",
        duration: duration || "any",
        sortBy: sortBy || "relevance",
        maxResults: maxResults ? parseInt(maxResults as string, 10) : 25,
      });
      return res.json(await searchVideos(filters));
    } catch (error: any) {
      console.error("YouTube search error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid search parameters", details: error.errors });
      }
      const providerError = normalizeProviderError(error, "youtube");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "YouTube research source"));
    }
  });

  app.get("/api/youtube/transcript/:videoId", rateLimit, async (req, res) => {
    try {
      const language = typeof req.query.language === "string" ? req.query.language : undefined;
      return res.json(await fetchTranscriptWithYtDlp(req.params.videoId, language));
    } catch (error: unknown) {
      console.error("Transcript retrieval error:", error);
      const providerError = normalizeProviderError(error, "youtube");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "Local transcript retrieval"));
    }
  });

  app.post("/api/script/generate", rateLimit, async (req, res) => {
    try {
      const input = scriptInputSchema.parse(req.body);
      return res.json(await generateScript(input));
    } catch (error: any) {
      console.error("Script generation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid script input", details: error.errors });
      }
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/script/extract-narration", rateLimit, async (req, res) => {
    try {
      const { scriptContent } = narrationExtractionRequestSchema.parse(req.body);
      return res.json({ narration: extractNarrationText(scriptContent) });
    } catch (error: any) {
      console.error("Narration extraction error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid narration extraction request", details: error.errors });
      }
      const friendly = getUserFriendlyError(error, "Narration extraction");
      return res.status(500).json({ error: friendly.message, suggestion: friendly.suggestion });
    }
  });

  app.post("/api/ideas/generate", rateLimit, async (req, res) => {
    try {
      const parsed = ideaGenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid grounded idea request", details: parsed.error.errors });
      }
      return res.json(await generateIdeas(parsed.data));
    } catch (error: unknown) {
      console.error("Ideas generation error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/research/insights", rateLimit, async (req, res) => {
    try {
      const parsed = researchInsightsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "A query and between 1 and 50 valid videos are required.",
          code: "RESEARCH_REQUEST_INVALID",
          details: parsed.error.errors,
        });
      }
      return res.json(await generateResearchInsights(parsed.data));
    } catch (error: unknown) {
      console.error("Research insights error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/script/regenerate-titles", rateLimit, async (req, res) => {
    try {
      const { topic, format, audience, evidenceContext } = titleRegenerationRequestSchema.parse(req.body);
      const titles = await regenerateTitles(topic, format, audience, evidenceContext);
      return res.json({ titles });
    } catch (error: any) {
      console.error("Title regeneration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid title regeneration request", details: error.errors });
      }
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/script/regenerate-section", rateLimit, async (req, res) => {
    try {
      const parsed = sectionRegenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid section regeneration request",
          code: "SCRIPT_SECTION_REGENERATION_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Keep the current section and review its topic, format, audience, and evidence context.",
          details: parsed.error.flatten(),
        });
      }
      return res.json(await regenerateSection(parsed.data));
    } catch (error: unknown) {
      console.error("Section regeneration error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/script/regenerate-paragraph", rateLimit, async (req, res) => {
    try {
      const parsed = paragraphRegenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid paragraph regeneration request",
          code: "SCRIPT_PARAGRAPH_REGENERATION_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Keep the current paragraph and review its section, topic, format, audience, and evidence context.",
          details: parsed.error.flatten(),
        });
      }
      return res.json(await regenerateParagraph(parsed.data));
    } catch (error: unknown) {
      console.error("Paragraph regeneration error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  app.post("/api/thumbnail/generate", rateLimit, async (req, res) => {
    try {
      const parsed = thumbnailGenerationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid thumbnail generation request",
          code: "THUMBNAIL_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Review the thumbnail fields and reference image requirements, then try again.",
          details: parsed.error.flatten(),
        });
      }
      const { topic, ...config } = parsed.data;
      return res.json(await generateThumbnail(topic, config));
    } catch (error: unknown) {
      console.error("Thumbnail generation error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI image provider"));
    }
  });

  app.post("/api/thumbnail/suggestions", rateLimit, async (req, res) => {
    try {
      const parsed = thumbnailSuggestionsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid thumbnail suggestions request",
          code: "THUMBNAIL_SUGGESTIONS_REQUEST_INVALID",
          category: "invalid_response",
          retryable: false,
          suggestion: "Add a valid topic and shorten any supplied idea context.",
          details: parsed.error.flatten(),
        });
      }
      return res.json({ suggestions: await generateThumbnailSuggestions(parsed.data) });
    } catch (error: unknown) {
      console.error("Thumbnail suggestions error:", error);
      const providerError = normalizeProviderError(error, "ai");
      return res.status(providerError.status).json(providerErrorPayload(providerError, "AI provider"));
    }
  });

  return httpServer;
}

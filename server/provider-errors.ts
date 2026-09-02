import type { ProviderErrorCategory, ProviderErrorResponse } from "@shared/schema";

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(options: {
    message: string;
    category: ProviderErrorCategory;
    code: string;
    status: number;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderError";
    this.category = options.category;
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

type ProviderErrorContext = "youtube" | "gemini" | "ai";

function categoryFromMessage(message: string): ProviderErrorCategory {
  const normalized = message.toLowerCase();
  if (normalized.includes("not configured") || normalized.includes("missing api key")) return "missing_key";
  if (
    normalized.includes("api key not valid")
    || normalized.includes("keyinvalid")
    || normalized.includes("invalid api key")
    || normalized.includes("api_key_invalid")
    || normalized.includes("permission_denied")
    || normalized.includes("authentication")
    || normalized.includes("unauthorized")
  ) return "invalid_key";
  if (
    normalized.includes("quota")
    || normalized.includes("ratelimit")
    || normalized.includes("rate limit")
    || normalized.includes("too many requests")
    || normalized.includes("daily limit")
    || normalized.includes("resource_exhausted")
  ) return "quota";
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("abort")) return "timeout";
  if (normalized.includes("network") || normalized.includes("fetch failed") || normalized.includes("econn")) return "network";
  if (normalized.includes("invalid response") || normalized.includes("malformed") || normalized.includes("schema")) return "invalid_response";
  return "unknown";
}

function defaultsForCategory(category: ProviderErrorCategory): Pick<ProviderError, "status" | "retryable"> {
  switch (category) {
    case "missing_key": return { status: 503, retryable: false };
    case "invalid_key": return { status: 401, retryable: false };
    case "quota": return { status: 429, retryable: true };
    case "timeout": return { status: 504, retryable: true };
    case "network":
    case "provider_server": return { status: 502, retryable: true };
    case "invalid_response": return { status: 502, retryable: false };
    default: return { status: 500, retryable: true };
  }
}

export function normalizeProviderError(error: unknown, context: ProviderErrorContext): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error || "Unknown provider error");
  const category = categoryFromMessage(message);
  const defaults = defaultsForCategory(category);

  return new ProviderError({
    message,
    category,
    code: `${context.toUpperCase()}_${category.toUpperCase()}`,
    ...defaults,
    cause: error,
  });
}

export function providerErrorPayload(error: ProviderError, contextLabel: string): ProviderErrorResponse {
  const copy: Record<ProviderErrorCategory, { error: string; suggestion: string }> = {
    missing_key: {
      error: `${contextLabel} is not configured`,
      suggestion: "Configure the provider endpoint, model, and optional key in Settings, then try again.",
    },
    invalid_key: {
      error: `${contextLabel} rejected the configured API key`,
      suggestion: "Replace or clear the relevant provider key in Settings, then verify the endpoint authentication settings.",
    },
    quota: {
      error: `${contextLabel} quota is unavailable`,
      suggestion: "Wait for quota to reset, switch to a local endpoint, or review the provider quota before retrying.",
    },
    timeout: {
      error: `${contextLabel} timed out`,
      suggestion: "Check the endpoint and increase the matching LLM or image timeout in Settings if the provider is simply slow.",
    },
    network: {
      error: `${contextLabel} could not be reached`,
      suggestion: "Check the configured base URL in Settings and make sure the selected local or remote server is running.",
    },
    provider_server: {
      error: `${contextLabel} returned a server error`,
      suggestion: "Retry after a short delay or inspect the selected provider logs.",
    },
    invalid_response: {
      error: `${contextLabel} returned an invalid response`,
      suggestion: "Retry once. If it continues, use Settings model discovery or choose another compatible model/endpoint.",
    },
    unknown: {
      error: `${contextLabel} encountered an issue`,
      suggestion: "Retry once. If it continues, inspect the provider logs and verify the connection in Settings.",
    },
  };

  return {
    ...copy[error.category],
    code: error.code,
    category: error.category,
    retryable: error.retryable,
  };
}

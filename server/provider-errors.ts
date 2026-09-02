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
      suggestion: "Open Settings, configure the required local tool/provider or key, then try again.",
    },
    invalid_key: {
      error: `${contextLabel} rejected the configured API key`,
      suggestion: "Replace the relevant API key in Settings or verify the endpoint authentication settings.",
    },
    quota: {
      error: `${contextLabel} quota is unavailable`,
      suggestion: "Wait for quota to reset, switch to an available local source/provider, or review provider quota before retrying.",
    },
    timeout: {
      error: `${contextLabel} timed out`,
      suggestion: "Check the endpoint/tool and increase its timeout in Settings if the local hardware or operation needs more time.",
    },
    network: {
      error: `${contextLabel} could not be reached`,
      suggestion: "Check the configured address and make sure the local or remote provider/tool is running and network access is available.",
    },
    provider_server: {
      error: `${contextLabel} returned a server/tool error`,
      suggestion: "Retry once, then inspect Settings diagnostics or the local provider/tool logs if the problem continues.",
    },
    invalid_response: {
      error: `${contextLabel} returned an invalid response`,
      suggestion: "Retry once. If it continues, choose a compatible model/source and inspect the provider/tool logs.",
    },
    unknown: {
      error: `${contextLabel} encountered an issue`,
      suggestion: "Retry once. If it continues, inspect Settings diagnostics and the server/provider logs.",
    },
  };

  return {
    ...copy[error.category],
    code: error.code,
    category: error.category,
    retryable: error.retryable,
  };
}

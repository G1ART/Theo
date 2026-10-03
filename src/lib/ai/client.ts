import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { AiFeatureKey, AiDegradation } from "./types";
import { SAFETY_FOOTER, assertSafePrompt } from "./safety";

const CONFIGURED_MODEL = (process.env.OPENAI_MODEL ?? "").trim();

/**
 * Default for every AI feature (2026-10-02). Vision + chat completions
 * + JSON. Chosen over `gpt-6-astra` for artwork boundary / crop /
 * correction volume: same image tokenizer, about 40% of the price
 * ($4 / $20 per 1M). `gpt-5.6` aliases to this snapshot.
 */
export const RECOMMENDED_MODEL = "gpt-5.6-sol";

/** Env pins we refuse to keep, including the one-day `gpt-6-astra`
 *  default, so a stale Vercel value cannot undo this choice. */
const RETIRED_MODELS = new Set([
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-6-astra",
]);

export const DEFAULT_MODEL =
  CONFIGURED_MODEL && !RETIRED_MODELS.has(CONFIGURED_MODEL)
    ? CONFIGURED_MODEL
    : RECOMMENDED_MODEL;
/**
 * OpenAI chat completion budget (SDK client + AbortSignal in handleAiRoute).
 * 8s was too tight for JSON-mode portfolio hints in production; keep below
 * maxDuration on each `app/api/ai/.../route.ts` segment (60s).
 */
export const GENERATE_TIMEOUT_MS = 45_000;

/**
 * Per-feature model overrides (2026-08-19).
 *
 * Every feature rides `DEFAULT_MODEL` (`gpt-5.6-sol` unless a
 * non-retired `OPENAI_MODEL` is set). Add a key here only to diverge.
 */
export const FEATURE_MODEL_OVERRIDE: Partial<Record<AiFeatureKey, string>> = {};

/**
 * Pick the model for a given feature. A key in `FEATURE_MODEL_OVERRIDE`
 * wins over `DEFAULT_MODEL`. Retired env pins (`gpt-4o`, `gpt-4o-mini`)
 * never become the default — see `RETIRED_MODELS`.
 */
export function resolveModelForFeature(feature: AiFeatureKey): string {
  return FEATURE_MODEL_OVERRIDE[feature] ?? DEFAULT_MODEL;
}

function modelUsesReasoning(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

// Log the model in use on first module load so Vercel Function logs always
// show which model is active. Helps catch misconfigurations (e.g. typos in
// OPENAI_MODEL env var) without requiring a failed request.
if (process.env.OPENAI_API_KEY) {
  const overrideKeys = Object.keys(FEATURE_MODEL_OVERRIDE);
  console.info(
    "[ai/client] default=%s (env=%s) overrides=%s",
    DEFAULT_MODEL,
    CONFIGURED_MODEL || "(default)",
    overrideKeys.length > 0 ? overrideKeys.join(",") : "(none)",
  );
}

let client: OpenAI | null = null;

export function getOpenAiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!client) {
    client = new OpenAI({ apiKey: key, timeout: GENERATE_TIMEOUT_MS });
  }
  return client;
}

/**
 * P6.4 — Vision support. When `imageInputs` is non-empty the user
 * message is built as a multimodal content array
 * (`[{type: "text"}, {type: "image_url"}, ...]`). Each image is passed
 * inline via a `data:` URL so callers don't have to upload to OpenAI's
 * file API. Callers should
 * pre-resize and JPEG-encode large originals before getting here; this
 * client does not transcode.
 */
export type ImageInput = {
  /** Either an image MIME (image/png, image/jpeg, image/webp) or "image" as a generic. */
  mime: string;
  /** Raw base64 (no data URL prefix). */
  base64: string;
  /** OpenAI vision detail flag — "low" is cheaper and adequate for CV
   *  pages where layout is more important than fine pixels. */
  detail?: "low" | "high" | "auto";
};

export type GenerateJsonOptions<T> = {
  feature: AiFeatureKey;
  system: string;
  user: string;
  /** Shape hint appended to the system prompt. */
  schemaHint: string;
  /** Client-side fallback when the key is missing, timeout hits, or parsing fails. */
  fallback: () => T;
  signal?: AbortSignal;
  /** Optional vision inputs. Caller is responsible for size + format. */
  imageInputs?: ImageInput[];
};

export type GenerateJsonResponse<T> = {
  data: T & AiDegradation;
  meta: {
    latencyMs: number;
    model: string;
    errorCode: string | null;
    contextSize: number;
  };
};

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return trimmed;
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(stripCodeFence(raw)) as T;
  } catch {
    const fenced = stripCodeFence(raw);
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Generate a typed JSON payload using OpenAI. Retries once on transient
 * failures, times out at GENERATE_TIMEOUT_MS, and never throws into the
 * caller — instead it returns the caller-provided `fallback` with
 * `degraded: true`. The caller is responsible for logging the event.
 */
export async function generateJSON<T extends object>(
  opts: GenerateJsonOptions<T>,
): Promise<GenerateJsonResponse<T>> {
  assertSafePrompt(opts.feature);
  const started = Date.now();
  const ai = getOpenAiClient();
  const contextSize = opts.system.length + opts.user.length + opts.schemaHint.length;
  const model = resolveModelForFeature(opts.feature);
  const reasoning = modelUsesReasoning(model);

  if (!ai) {
    return {
      data: { ...opts.fallback(), degraded: true, reason: "no_key" },
      meta: { latencyMs: 0, model, errorCode: "no_key", contextSize },
    };
  }

  const systemMessage = `${SAFETY_FOOTER}\n\n${opts.system}\n\nRespond with a single JSON object matching this shape (no code fences, no prose): ${opts.schemaHint}`;

  const hasImages = !!opts.imageInputs && opts.imageInputs.length > 0;

  // Build the user message: text-only or multimodal depending on
  // `imageInputs`. The OpenAI SDK accepts `string | ContentPart[]` for
  // `messages[].content`, and ContentPart unions text + image_url.
  // We construct the typed user message in two arms so the SDK
  // overload picker doesn't have to widen `content` to a union.
  const userMessage = hasImages
    ? {
        role: "user" as const,
        content: [
          { type: "text" as const, text: opts.user },
          ...opts.imageInputs!.map((img) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${img.mime || "image/png"};base64,${img.base64}`,
              detail: img.detail ?? "low",
            },
          })),
        ],
      }
    : { role: "user" as const, content: opts.user };

  const run = async () => {
    return ai.chat.completions.create(
      {
        model,
        // Reasoning models reject a non-default temperature. Medium
        // matches gpt-5.6-sol's own default for both vision and text.
        // Classic models keep 0.7.
        ...(reasoning
          ? {
              // Corner detection is on the upload critical path. Low
              // effort keeps the same model but skips the long think
              // that was costing ~15s. Other features stay at medium.
              reasoning_effort:
                opts.feature === "artwork_painting_bbox" ? ("low" as const) : ("medium" as const),
            }
          : { temperature: 0.7 }),
        max_completion_tokens: reasoning ? 8192 : 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system" as const, content: systemMessage },
          userMessage,
        ],
      },
      { signal: opts.signal },
    );
  };

  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const resp = await run();
      const text = resp.choices?.[0]?.message?.content ?? "";
      const parsed = tryParseJson<T>(text);
      if (!parsed) {
        lastError = "parse";
        if (attempt === 0) continue;
        break;
      }
      return {
        data: parsed,
        meta: {
          latencyMs: Date.now() - started,
          model,
          errorCode: null,
          contextSize,
        },
      };
    } catch (err: unknown) {
      if (err instanceof APIUserAbortError) {
        lastError = "timeout";
        break;
      }
      if (err instanceof APIConnectionTimeoutError || err instanceof APIConnectionError) {
        lastError = "timeout";
        break;
      }
      if (err instanceof RateLimitError) {
        lastError = "rate_limit";
        break;
      }
      if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
        lastError = "upstream_auth";
        break;
      }
      if (err instanceof BadRequestError) {
        const e = err as APIError;
        const msg = String(e.message ?? "").toLowerCase();
        const code = String(e.code ?? "").toLowerCase();
        if (
          code.includes("context_length") ||
          code.includes("string_above_max_length") ||
          msg.includes("context length") ||
          msg.includes("maximum context") ||
          msg.includes("too many tokens") ||
          msg.includes("reduce the length") ||
          msg.includes("token count")
        ) {
          lastError = "context_limit";
        } else {
          lastError = "error";
        }
        console.error("[ai/client] OpenAI BadRequest", {
          feature: opts.feature,
          model,
          attempt,
          code: e.code,
          message: e.message,
        });
        break;
      }
      if (err instanceof APIError) {
        const e = err as APIError;
        if (e.status === 429) {
          lastError = "rate_limit";
          break;
        }
        if (e.status === 401 || e.status === 403) {
          lastError = "upstream_auth";
          break;
        }
        console.error("[ai/client] OpenAI call failed", {
          feature: opts.feature,
          model,
          attempt,
          status: e.status,
          code: e.code,
          message: e.message,
        });
        lastError = "error";
        if (attempt === 0 && (e.status ?? 0) >= 500) continue;
        break;
      }
      const anyErr = err as { name?: string; status?: number; message?: string };
      const name = String(anyErr?.name ?? "");
      if (name === "AbortError") {
        lastError = "timeout";
        break;
      }
      console.error("[ai/client] OpenAI call failed", {
        feature: opts.feature,
        model,
        attempt,
        status: anyErr?.status,
        name: anyErr?.name,
        message: anyErr?.message,
      });
      lastError = "error";
      if (attempt === 0 && (anyErr?.status ?? 0) >= 500) continue;
      break;
    }
  }

  const reason: AiDegradation["reason"] =
    lastError === "parse"
      ? "parse"
      : lastError === "timeout"
        ? "timeout"
        : lastError === "rate_limit"
          ? "rate_limit"
          : lastError === "context_limit"
            ? "context_limit"
            : lastError === "upstream_auth"
              ? "upstream_auth"
              : "error";

  return {
    data: { ...opts.fallback(), degraded: true, reason },
    meta: {
      latencyMs: Date.now() - started,
      model,
      errorCode: lastError,
      contextSize,
    },
  };
}

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
export const DEFAULT_MODEL = CONFIGURED_MODEL || "gpt-4o-mini";
/**
 * OpenAI chat completion budget (SDK client + AbortSignal in handleAiRoute).
 * 8s was too tight for JSON-mode portfolio hints in production; keep below
 * maxDuration on each `app/api/ai/.../route.ts` segment (60s).
 */
export const GENERATE_TIMEOUT_MS = 45_000;

/**
 * Per-feature model overrides (2026-08-19).
 *
 * The default (`DEFAULT_MODEL`, typically `gpt-4o-mini`) is fine for
 * most text-only JSON copilots — but a handful of vision features
 * need the fuller `gpt-4o` for measurably tighter geometry. When a
 * key is present here, `generateJSON` picks THIS model instead of
 * the environment default; every other feature keeps riding
 * `DEFAULT_MODEL` so we don't 10x the token bill globally.
 *
 * Current overrides:
 *   • `artwork_painting_bbox` → `gpt-4o` — the Display Simulation
 *     "여백 자동 제거 (AI)" pipeline. `gpt-4o-mini` frequently
 *     returned a symmetric 10% fallback bbox
 *     ({x:0.1, y:0.1, w:0.8, h:0.8}) instead of tight edges for
 *     typical framed-photo uploads, which defeats the whole feature
 *     (the fallback keeps every pixel of matte / frame padding).
 *     `gpt-4o` measurably tightens those edges. See
 *     `ARTWORK_PAINTING_BBOX_SYSTEM` for the prompt-side companion
 *     changes (anti-fallback instructions).
 */
export const FEATURE_MODEL_OVERRIDE: Partial<Record<AiFeatureKey, string>> = {
  artwork_painting_bbox: "gpt-4o",
};

/**
 * Pick the model for a given feature. Env override
 * (`OPENAI_MODEL=…`) is intentionally IGNORED for keys that appear
 * in `FEATURE_MODEL_OVERRIDE` — a feature-specific choice (e.g.
 * "we need gpt-4o for this bbox") shouldn't silently regress to
 * mini when someone force-pins mini via env for another workflow.
 */
export function resolveModelForFeature(feature: AiFeatureKey): string {
  return FEATURE_MODEL_OVERRIDE[feature] ?? DEFAULT_MODEL;
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
 * file API. The model field stays the same — gpt-4o-mini already
 * supports vision and matches our default budget. Callers should
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
  // Per-feature model override (see FEATURE_MODEL_OVERRIDE). Every
  // ai_events row now records the model that ACTUALLY ran, so the
  // artwork_painting_bbox rows will read `gpt-4o` while the rest keep
  // reading `gpt-4o-mini`.
  const model = resolveModelForFeature(opts.feature);

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
        temperature: 0.7,
        /** Portfolio / profile JSON payloads need headroom beyond the default cap. */
        max_completion_tokens: 2048,
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

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateJSON, GENERATE_TIMEOUT_MS, type ImageInput } from "./client";
import { logAiEvent } from "./events";
import { assertSafePrompt } from "./safety";
import type { AiDegradation, AiFeatureKey } from "./types";
import { resolveEntitlementFor } from "@/lib/entitlements";
import { recordUsageEvent, type UsageEventKey } from "@/lib/metering";
import {
  AI_FEATURE_TO_ENTITLEMENT_KEY,
  AI_FEATURE_TO_METER_KEY,
  USAGE_KEYS,
} from "@/lib/metering/usageKeys";

export type RouteHandlerInput<TBody> = {
  feature: AiFeatureKey;
  body: TBody;
  userId: string;
  supabase: SupabaseClient;
  accessToken: string;
};

export type PreparedPrompt<TResult extends AiDegradation> = {
  system: string;
  user: string;
  schemaHint: string;
  fallback: () => TResult;
  /** P6.4 — vision multimodal inputs. When non-empty the route's
   *  generateJSON call switches to a multimodal user message. */
  imageInputs?: ImageInput[];
};

export type RouteHandlerDefinition<TBody, TResult extends AiDegradation> = {
  feature: AiFeatureKey;
  /**
   * Validate and normalize the request body. Returning `{ ok: false, reason }`
   * makes the route reply with `400 { degraded: true, reason: "invalid_input", validation }`.
   */
  validateBody?: (raw: unknown) => { ok: true; value: TBody } | { ok: false; reason: string };
  buildPromptInput: (
    input: RouteHandlerInput<TBody>,
  ) => Promise<PreparedPrompt<TResult> | NextResponse>;
};

function buildSupabaseForToken(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Consistent error contract for every AI route: the body always carries
 * `degraded: true` and a stable `reason` enum so the browser helper can
 * surface the correct i18n fallback copy.
 */
function degradedResponse(
  status: number,
  reason: AiDegradation["reason"] | "invalid_input",
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { degraded: true, reason, ...(extra ?? {}) },
    { status },
  );
}

export async function handleAiRoute<TBody, TResult extends AiDegradation>(
  req: Request,
  def: RouteHandlerDefinition<TBody, TResult>,
  /**
   * Tests pass a client so the handler runs without a live project.
   * Production routes omit this and keep the bearer-token client.
   */
  deps?: { supabase?: SupabaseClient },
): Promise<NextResponse> {
  try {
    assertSafePrompt(def.feature);

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token) return degradedResponse(401, "unauthorized");

    const supabase = deps?.supabase ?? buildSupabaseForToken(token);
    if (!supabase) return degradedResponse(500, "error", { error: "Server misconfigured" });

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) return degradedResponse(401, "unauthorized");

    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }

    let body: TBody;
    if (def.validateBody) {
      const parsed = def.validateBody(rawBody);
      if (!parsed.ok) {
        return degradedResponse(400, "invalid_input", { validation: parsed.reason });
      }
      body = parsed.value;
    } else {
      body = rawBody as TBody;
    }

    const entitlementKey = AI_FEATURE_TO_ENTITLEMENT_KEY[def.feature];
    if (entitlementKey) {
      const decision = await resolveEntitlementFor({
        featureKey: entitlementKey,
        userId: user.id,
        client: supabase,
      });
      if (!decision.allowed) {
        await recordUsageEvent(
          {
            userId: user.id,
            key: USAGE_KEYS.FEATURE_GATE_BLOCKED,
            featureKey: entitlementKey,
            metadata: {
              source: decision.source,
              ai_feature: def.feature,
              paywall_hint: decision.paywallHint,
            },
          },
          { client: supabase, dualWriteBeta: false },
        );
        await logAiEvent(supabase, {
          user_id: user.id,
          feature_key: def.feature,
          error_code: "cap",
        });
        const status = decision.source === "quota_exceeded" ? 429 : 402;
        return degradedResponse(status, "cap", {
          error: "plan_required",
          paywallHint: decision.paywallHint,
          source: decision.source,
        });
      }
    }

    // Account-day draft counts are not a gate. Rectangle detection,
    // the quality gate, and the other calls on this handler are not
    // stopped at 30. OpenAI bills per token; this route does not.
    const prepared = await def.buildPromptInput({
      feature: def.feature,
      body,
      userId: user.id,
      supabase,
      accessToken: token,
    });

    if (prepared instanceof NextResponse) return prepared;

    const hasKey = Boolean(process.env.OPENAI_API_KEY);
    if (!hasKey) {
      const aiEventId = await logAiEvent(supabase, {
        user_id: user.id,
        feature_key: def.feature,
        error_code: "no_key",
      });
      return NextResponse.json(
        {
          ...prepared.fallback(),
          degraded: true,
          reason: "no_key",
          ...(aiEventId ? { aiEventId } : {}),
        },
        { status: 503 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    let result;
    try {
      result = await generateJSON<TResult>({
        feature: def.feature,
        system: prepared.system,
        user: prepared.user,
        schemaHint: prepared.schemaHint,
        fallback: prepared.fallback,
        signal: controller.signal,
        imageInputs: prepared.imageInputs,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (process.env.NODE_ENV !== "production") {
      const promptBytes =
        (prepared.system?.length ?? 0) +
        (prepared.user?.length ?? 0) +
        (prepared.schemaHint?.length ?? 0);
      let responseBytes = 0;
      try {
        responseBytes = JSON.stringify(result.data ?? {}).length;
      } catch {
        responseBytes = 0;
      }
      console.debug(
        `[ai/${def.feature}] prompt≈${promptBytes}B response≈${responseBytes}B latency=${result.meta.latencyMs ?? "?"}ms` +
          (result.meta.errorCode ? ` degraded=${result.meta.errorCode}` : ""),
      );
    }

    const aiEventId = await logAiEvent(supabase, {
      user_id: user.id,
      feature_key: def.feature,
      context_size: result.meta.contextSize,
      model: result.meta.model,
      latency_ms: result.meta.latencyMs,
      error_code: result.meta.errorCode,
    });

    const meterKey = AI_FEATURE_TO_METER_KEY[def.feature] as UsageEventKey | undefined;
    if (meterKey && !result.meta.errorCode) {
      await recordUsageEvent(
        {
          userId: user.id,
          key: meterKey,
          featureKey: entitlementKey ?? undefined,
          metadata: {
            ai_feature: def.feature,
            model: result.meta.model,
            latency_ms: result.meta.latencyMs,
            context_size: result.meta.contextSize,
          },
        },
        { client: supabase, dualWriteBeta: false },
      );
    }

    return NextResponse.json(
      {
        ...result.data,
        ...(aiEventId ? { aiEventId } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[ai/route] unexpected", err);
    return degradedResponse(500, "error", { error: "Unexpected error" });
  }
}

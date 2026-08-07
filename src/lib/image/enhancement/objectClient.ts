"use client";

/**
 * Theo Image Enhance (Beta) — client-side helpers for the object
 * hybrid pipeline (Photoroom + sharp on the server).
 *
 * Two responsibilities:
 *   1. `uploadStagingForEnhancement` — write the user's original file
 *      into a short-lived per-user staging folder that Storage RLS
 *      already covers (`{userId}/enhanced-staging/…` or
 *      `exhibition-media/{exhibitionId}/enhanced-staging/…`).
 *   2. `requestObjectEnhancement` — POST the staging path to
 *      `/api/image-enhance/object` with the current session bearer.
 *
 * All errors are normalized into `EnhancementError` so the calling UI
 * can render a single-source-of-truth i18n toast without inspecting
 * HTTP wire shapes.
 */

import { supabase } from "@/lib/supabase/client";
import { EnhancementError } from "./types";
import type {
  EnhancementErrorReason,
  EnhancementMeta,
} from "./types";
import { normalizeEnhancementMeta } from "./types";

const STORAGE_BUCKET = "artworks";

export type EnhancementOwnerScope =
  | { kind: "user"; userId: string }
  | { kind: "exhibition"; exhibitionId: string };

function sanitizeName(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const sanitized = base.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
  return `${sanitized || "input"}${ext || ""}`;
}

function stagingRoot(scope: EnhancementOwnerScope): string {
  if (scope.kind === "user") return `${scope.userId}/enhanced-staging`;
  return `exhibition-media/${scope.exhibitionId}/enhanced-staging`;
}

export async function uploadStagingForEnhancement(
  file: File,
  scope: EnhancementOwnerScope,
): Promise<string> {
  const uuid = crypto.randomUUID();
  const path = `${stagingRoot(scope)}/${uuid}-${sanitizeName(file.name)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) {
    throw new EnhancementError("storage_error", error.message, 502);
  }
  return path;
}

export async function cleanupStagingPath(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  } catch {
    // Best-effort cleanup; never crash the caller path.
  }
}

export async function cleanupEnhancedPath(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  } catch {
    // Same rationale as cleanupStagingPath.
  }
}

export type RequestObjectEnhancementParams = {
  inputStoragePath: string;
  exhibitionId?: string | null;
  mode?: "auto" | "flat" | "object";
};

export type RequestObjectEnhancementResult = {
  enhancedPath: string;
  width: number;
  height: number;
  latencyMs: number;
  meta: EnhancementMeta;
};

export async function requestObjectEnhancement(
  params: RequestObjectEnhancementParams,
): Promise<RequestObjectEnhancementResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new EnhancementError("not_authorized", "missing_session", 401);
  }
  const res = await fetch("/api/image-enhance/object", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      inputStoragePath: params.inputStoragePath,
      exhibitionId: params.exhibitionId ?? null,
      mode: params.mode ?? "object",
    }),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const bodyJson: unknown = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : null;
  if (!res.ok) {
    const reason = readReason(bodyJson);
    throw new EnhancementError(reason ?? "error", `status_${res.status}`, res.status);
  }
  if (!bodyJson || typeof bodyJson !== "object") {
    throw new EnhancementError("error", "invalid_response");
  }
  const body = bodyJson as Record<string, unknown>;
  const enhancedPath = typeof body.enhancedPath === "string" ? body.enhancedPath : "";
  if (!enhancedPath) {
    throw new EnhancementError("error", "no_enhanced_path");
  }
  const width = typeof body.width === "number" ? body.width : 0;
  const height = typeof body.height === "number" ? body.height : 0;
  const latencyMs = typeof body.latencyMs === "number" ? body.latencyMs : 0;
  const normalizedMeta = normalizeEnhancementMeta(body.meta);
  if (!normalizedMeta) {
    throw new EnhancementError("error", "missing_meta");
  }
  return {
    enhancedPath,
    width,
    height,
    latencyMs,
    meta: normalizedMeta,
  };
}

function readReason(raw: unknown): EnhancementErrorReason | null {
  if (!raw || typeof raw !== "object") return null;
  const val = (raw as { reason?: unknown }).reason;
  if (typeof val !== "string") return null;
  switch (val) {
    case "provider_unauthorized":
    case "provider_rate_limited":
    case "provider_timeout":
    case "unsupported_format":
    case "invalid_input":
    case "not_authorized":
    case "storage_error":
    case "error":
      return val;
    default:
      return "error";
  }
}

"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Ask the server to lift a non-rectangular artwork off its background.
 * Returns a WebP blob already sitting on the gallery matte. Throws an
 * Error whose message is the route `reason` (`no_key`, `not_authorized`, …).
 */
export async function requestSilhouetteCutout(file: File, signal?: AbortSignal): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("not_authorized");
  const body = new FormData();
  body.append("file", file, file.name || "artwork.jpg");
  const res = await fetch("/api/image-enhance/silhouette", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
    signal,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(payload?.reason || "error");
  }
  return res.blob();
}

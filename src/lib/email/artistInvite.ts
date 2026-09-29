"use client";

import { getMyProfile } from "@/lib/supabase/profiles";

type InviterRole = "gallery" | "curator" | "both" | "other";

function inferInviterRole(mainRole: string | null, roles: string[] | null): InviterRole {
  const all = new Set<string>(
    [mainRole, ...(roles ?? [])].filter((v): v is string => !!v).map((v) => v.toLowerCase())
  );
  const hasGallery = all.has("gallerist") || all.has("gallery");
  const hasCurator = all.has("curator");
  if (hasGallery && hasCurator) return "both";
  if (hasGallery) return "gallery";
  if (hasCurator) return "curator";
  return "other";
}

export async function sendArtistInviteEmailClient(params: {
  toEmail: string;
  artistName?: string | null;
  exhibitionTitle?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  return sendArtistInviteEmailWithResult(params);
}

/** Same as client but returns result for UI (invite page). */
export async function sendArtistInviteEmailWithResult(params: {
  toEmail: string;
  artistName?: string | null;
  exhibitionTitle?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = params.toEmail.trim();
    if (!email) return { ok: false, error: "Email is required" };

    const { data: profile } = await getMyProfile();
    const inviterName = profile?.display_name || profile?.username || null;
    const inviterRole = inferInviterRole(profile?.main_role ?? null, profile?.roles ?? null);

    const res = await fetch("/api/artist-invite-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail: email,
        artistName: params.artistName ?? null,
        inviterName,
        inviterRole,
        exhibitionTitle: params.exhibitionTitle ?? null,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "Failed to send invite" };
    return { ok: true };
  } catch (error) {
    console.error("sendArtistInviteEmailWithResult failed", error);
    return { ok: false, error: (error as Error)?.message ?? "Failed to send invite" };
  }
}


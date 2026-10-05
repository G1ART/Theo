"use client";

import { getSession } from "@/lib/supabase/auth";
import { getMyProfile } from "@/lib/supabase/profiles";

type InviterRole = "gallery" | "curator" | "both" | "other";

export type InviteEmailOutcome = {
  ok: boolean;
  emailed: boolean;
  alreadySent: boolean;
  skipped?: boolean;
  error?: string;
};

export type InviteCardKind = "sent" | "already" | "failed";

export function inviteCardKind(result: InviteEmailOutcome): InviteCardKind | null {
  if (result.skipped) return null;
  if (result.emailed) return "sent";
  if (result.alreadySent) return "already";
  return "failed";
}

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
  toEmail?: string;
  artistName?: string | null;
  exhibitionTitle?: string | null;
  externalArtistId?: string | null;
  resend?: boolean;
}): Promise<InviteEmailOutcome> {
  return sendArtistInviteEmailWithResult(params);
}

/** Same as client but returns result for UI (invite page). */
export async function sendArtistInviteEmailWithResult(params: {
  toEmail?: string;
  artistName?: string | null;
  exhibitionTitle?: string | null;
  externalArtistId?: string | null;
  resend?: boolean;
}): Promise<InviteEmailOutcome> {
  const failed = (error: string): InviteEmailOutcome => ({
    ok: false,
    emailed: false,
    alreadySent: false,
    error,
  });
  try {
    const email = params.toEmail?.trim() ?? "";
    const externalArtistId = params.externalArtistId?.trim() ?? "";
    if (!email && !externalArtistId) return failed("Email is required");

    const {
      data: { session },
    } = await getSession();
    const token = session?.access_token;
    if (!token) return failed("unauthorized");

    const { data: profile } = await getMyProfile();
    const inviterName = profile?.display_name || profile?.username || null;
    const inviterRole = inferInviterRole(profile?.main_role ?? null, profile?.roles ?? null);

    const res = await fetch("/api/artist-invite-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        toEmail: email || null,
        artistName: params.artistName ?? null,
        inviterName,
        inviterRole,
        exhibitionTitle: params.exhibitionTitle ?? null,
        externalArtistId: externalArtistId || null,
        resend: params.resend === true,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      emailed?: boolean;
      alreadySent?: boolean;
      skipped?: string;
    };
    if (data.skipped === "ir_demo") {
      return { ok: true, emailed: false, alreadySent: false, skipped: true };
    }
    if (data.alreadySent) return { ok: true, emailed: false, alreadySent: true };
    if (res.ok && data.emailed) return { ok: true, emailed: true, alreadySent: false };
    return failed(data.error ?? "Failed to send invite");
  } catch (error) {
    console.error("sendArtistInviteEmailWithResult failed", error);
    return failed((error as Error)?.message ?? "Failed to send invite");
  }
}

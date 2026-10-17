import { recordActingContextEvent } from "@/lib/delegation/actingContext";
import { supabase } from "@/lib/supabase/client";

async function noteProfileWrite(profileId: string): Promise<void> {
  await recordActingContextEvent({
    subjectProfileId: profileId,
    action: "profile.update",
    resourceType: "profile",
    resourceId: profileId,
  });
}

export async function saveActingPublicProfile(input: {
  profileId: string;
  basePatch: Record<string, unknown>;
  detailsPatch?: Record<string, unknown>;
}): Promise<{ ok: boolean; error: unknown }> {
  const profileId = input.profileId.trim();
  const { error } = await supabase.rpc("save_acting_public_profile", {
    p_profile_id: profileId,
    p_acting_profile_id: profileId,
    p_base: input.basePatch ?? {},
    p_details: input.detailsPatch ?? {},
  });
  if (error) return { ok: false, error };
  await noteProfileWrite(profileId);
  return { ok: true, error: null };
}

export async function saveActingProfileCv(input: {
  profileId: string;
  education?: unknown[] | null;
  exhibitions?: unknown[] | null;
  awards?: unknown[] | null;
  residencies?: unknown[] | null;
}): Promise<{ ok: boolean; error: unknown }> {
  const profileId = input.profileId.trim();
  const { error } = await supabase.rpc("save_acting_profile_cv", {
    p_profile_id: profileId,
    p_acting_profile_id: profileId,
    p_education: input.education ?? null,
    p_exhibitions: input.exhibitions ?? null,
    p_awards: input.awards ?? null,
    p_residencies: input.residencies ?? null,
  });
  if (error) return { ok: false, error };
  await noteProfileWrite(profileId);
  return { ok: true, error: null };
}

export async function saveActingCvPdfPath(
  profileId: string,
  path: string | null,
): Promise<{ ok: boolean; error: unknown }> {
  const id = profileId.trim();
  const { error } = await supabase.rpc("save_acting_cv_pdf_path", {
    p_profile_id: id,
    p_acting_profile_id: id,
    p_path: path,
  });
  if (error) return { ok: false, error };
  await noteProfileWrite(id);
  return { ok: true, error: null };
}

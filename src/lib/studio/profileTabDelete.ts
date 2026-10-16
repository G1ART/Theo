import { removeCascadeStorage } from "@/lib/supabase/artworkStorageCleanup";
import { deleteArtworkCascade } from "@/lib/supabase/artworks";
import { supabase } from "@/lib/supabase/client";
import { removeStorageFiles } from "@/lib/supabase/storage";
import type { ProfileContentKind } from "@/lib/studio/profileContentKind";
import { persistStudioPortfolio } from "@/lib/studio/persistStudioPortfolio";
import {
  assignArtworksToCustomTab,
  removeCustomTab,
  type StudioPortfolioV1,
} from "@/lib/studio/studioPortfolioConfig";

async function deleteListedWorks(
  ids: string[],
  profileId: string,
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const needsRpc: string[] = [];
  for (const id of ids) {
    const { error } = await deleteArtworkCascade(id);
    if (error) needsRpc.push(id);
    else deleted.push(id);
  }
  if (needsRpc.length === 0 || !profileId) {
    return { deleted, failed: needsRpc };
  }

  const { data: images } = await supabase
    .from("artwork_images")
    .select("artwork_id, storage_path, original_storage_path")
    .in("artwork_id", needsRpc);
  const rows = images ?? [];

  const { data, error } = await supabase.rpc("delete_profile_tab_artworks", {
    p_profile_id: profileId,
    p_artwork_ids: needsRpc,
  });
  if (error || !Array.isArray(data)) {
    return { deleted, failed: needsRpc };
  }
  const removed = new Set(data.filter((id): id is string => typeof id === "string"));
  for (const id of removed) {
    const mine = rows.filter((row) => row.artwork_id === id);
    if (mine.length === 0) continue;
    await removeCascadeStorage(mine, removeStorageFiles);
  }
  const failed = needsRpc.filter((id) => !removed.has(id));
  return { deleted: [...deleted, ...removed], failed };
}

async function writeMovedWorkKinds(
  profileId: string,
  kind: ProfileContentKind,
  ids: string[],
): Promise<{ ok: boolean; error: unknown }> {
  if (!profileId) {
    const { error } = await supabase.from("artworks").update({ work_kind: kind }).in("id", ids);
    return { ok: !error, error };
  }
  const { error } = await supabase.rpc("set_profile_tab_work_kinds", {
    p_profile_id: profileId,
    p_artwork_ids: ids,
    p_kind: kind,
  });
  return { ok: !error, error };
}

export async function applyCustomTabDelete(params: {
  portfolio: StudioPortfolioV1;
  sourceTabId: string;
  deleteArtworkIds: string[];
  moveIds: string[];
  destinationTabId: string | null;
  kindByArtworkId: Record<string, ProfileContentKind | null>;
  profileId?: string;
}): Promise<{ ok: boolean; error: unknown; portfolio: StudioPortfolioV1 }> {
  const profileId = params.profileId?.trim() ?? "";
  const { deleted, failed } = await deleteListedWorks(params.deleteArtworkIds, profileId);
  let portfolio = params.portfolio;
  if (deleted.length > 0) {
    portfolio = assignArtworksToCustomTab({
      portfolio,
      artworkIds: deleted,
      targetCustomId: null,
    });
  }
  if (failed.length > 0) {
    const saved = await persistStudioPortfolio(portfolio, profileId);
    return { ok: false, error: saved.error ?? new Error("delete_failed"), portfolio };
  }
  if (params.moveIds.length > 0 && params.destinationTabId) {
    portfolio = assignArtworksToCustomTab({
      portfolio,
      artworkIds: params.moveIds,
      targetCustomId: params.destinationTabId,
    });
  }
  portfolio = removeCustomTab(portfolio, params.sourceTabId);
  const saved = await persistStudioPortfolio(portfolio, profileId);
  if (!saved.ok) return { ok: false, error: saved.error, portfolio };
  const byKind = new Map<ProfileContentKind, string[]>();
  for (const [id, kind] of Object.entries(params.kindByArtworkId)) {
    if (!kind || !params.moveIds.includes(id)) continue;
    const list = byKind.get(kind) ?? [];
    list.push(id);
    byKind.set(kind, list);
  }
  for (const [kind, ids] of byKind) {
    const written = await writeMovedWorkKinds(profileId, kind, ids);
    if (!written.ok) return { ok: false, error: written.error, portfolio };
  }
  return { ok: true, error: null, portfolio };
}

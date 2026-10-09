import { deleteArtworkCascade } from "@/lib/supabase/artworks";
import { supabase } from "@/lib/supabase/client";
import type { ProfileContentKind } from "@/lib/studio/profileContentKind";
import { persistStudioPortfolio } from "@/lib/studio/persistStudioPortfolio";
import {
  assignArtworksToCustomTab,
  removeCustomTab,
  type StudioPortfolioV1,
} from "@/lib/studio/studioPortfolioConfig";

export async function applyCustomTabDelete(params: {
  portfolio: StudioPortfolioV1;
  sourceTabId: string;
  deleteArtworkIds: string[];
  moveIds: string[];
  destinationTabId: string | null;
  kindByArtworkId: Record<string, ProfileContentKind | null>;
}): Promise<{ ok: boolean; error: unknown; portfolio: StudioPortfolioV1 }> {
  const failed: string[] = [];
  const deleted: string[] = [];
  for (const id of params.deleteArtworkIds) {
    const { error } = await deleteArtworkCascade(id);
    if (error) failed.push(id);
    else deleted.push(id);
  }
  let portfolio = params.portfolio;
  if (deleted.length > 0) {
    portfolio = assignArtworksToCustomTab({
      portfolio,
      artworkIds: deleted,
      targetCustomId: null,
    });
  }
  if (failed.length > 0) {
    const saved = await persistStudioPortfolio(portfolio);
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
  const saved = await persistStudioPortfolio(portfolio);
  if (!saved.ok) return { ok: false, error: saved.error, portfolio };
  const byKind = new Map<ProfileContentKind, string[]>();
  for (const [id, kind] of Object.entries(params.kindByArtworkId)) {
    if (!kind || !params.moveIds.includes(id)) continue;
    const list = byKind.get(kind) ?? [];
    list.push(id);
    byKind.set(kind, list);
  }
  for (const [kind, ids] of byKind) {
    const { error } = await supabase.from("artworks").update({ work_kind: kind }).in("id", ids);
    if (error) return { ok: false, error, portfolio };
  }
  return { ok: true, error: null, portfolio };
}

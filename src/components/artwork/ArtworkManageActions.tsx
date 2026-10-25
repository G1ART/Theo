"use client";

import { useState } from "react";
import Link from "next/link";
import { useActingAs } from "@/context/ActingAsContext";
import { canManageArtwork } from "@/lib/artworks/claimMenu";
import { useArtworkManageActorIds } from "@/lib/artworks/useArtworkManageActorIds";
import { useT } from "@/lib/i18n/useT";
import { deleteArtworkCascade } from "@/lib/supabase/artworks";

type ArtworkRef = {
  id: string;
  artist_id?: string | null;
  created_by?: string | null;
};

/**
 * Edit and delete for a card. Hidden unless this viewer is the artist,
 * the uploader, or acting for one of them with artwork management.
 */
export function ArtworkManageActions({
  artwork,
  onDeleted,
  className,
}: {
  artwork: ArtworkRef;
  onDeleted?: () => void;
  className?: string;
}) {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const { ids, ready } = useArtworkManageActorIds();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!ready || !canManageArtwork(artwork, ids)) return null;

  return (
    <div
      className={className ?? "mt-1 flex flex-wrap items-center gap-3"}
      onClick={(event) => event.stopPropagation()}
    >
      <Link
        href={`/artwork/${artwork.id}/edit`}
        onClick={(event) => event.stopPropagation()}
        className="text-[11px] font-medium text-zinc-700 hover:text-zinc-900"
      >
        {t("common.edit")}
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (
            typeof window !== "undefined" &&
            !window.confirm(t("common.confirmDeleteShort"))
          ) {
            return;
          }
          setBusy(true);
          setFailed(false);
          void deleteArtworkCascade(artwork.id, {
            actingAsProfileId,
          }).then(({ error }) => {
            setBusy(false);
            if (error) {
              setFailed(true);
              return;
            }
            onDeleted?.();
          });
        }}
        className="text-[11px] text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {t("common.delete")}
      </button>
      {failed ? (
        <span className="text-[11px] text-red-600">{t("errors.failedDelete")}</span>
      ) : null}
    </div>
  );
}

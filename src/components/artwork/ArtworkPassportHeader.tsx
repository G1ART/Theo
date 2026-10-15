"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { profileReturnLinkProps } from "@/lib/profile/scrollRestore";

/**
 * `getArtworkBack()` returns `labelKey: string` because it derives from
 * the runtime URL — TypeScript can't narrow the value to a closed
 * `MessageKey` union from a startsWith() chain. The Sprint 3 (and prior)
 * call sites already passed it straight to `t()` with a manual cast,
 * so this prop mirrors that contract: the component takes a string and
 * casts at the t() boundary. If a bad key sneaks in, t() falls back to
 * the key itself which is the same failure mode as before.
 */

/**
 * Sprint 4 — extracted Passport breadcrumb header.
 *
 * Pure presentation; takes only navigation params. The page itself owns
 * back-state derivation (`getArtworkBack()`) and the `?fromRoom=` URL
 * search param so the parent stays the source of truth for routing
 * intent. This keeps the split cheap to revert.
 *
 * Visual contract — pinned by Sprint 3 §3.2:
 *   - "ARTWORK RECORD" caption above the back-row, announcing the page
 *     genre as an *official record*, never an ecommerce product.
 *   - When `fromRoom` is set the "Back to room" link wins primary visual
 *     weight; the generic back link drops to secondary because the user
 *     just came from a more specific surface.
 *   - When `fromRoom` is null only the generic back appears, weight
 *     unchanged.
 */
export function ArtworkPassportHeader({
  fromRoom,
  backPath,
  backLabelKey,
}: {
  fromRoom: string | null;
  backPath: string;
  backLabelKey: string;
}) {
  const { t } = useT();
  const backKey = backLabelKey as MessageKey;
  const profileReturn = profileReturnLinkProps(backPath);
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        {t("artwork.recordTitle")}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {fromRoom ? (
          <Link
            href={`/room/${encodeURIComponent(fromRoom)}`}
            className="text-zinc-700 hover:text-zinc-900"
          >
            ← {t("artwork.backToRoom")}
          </Link>
        ) : (
          <Link href={backPath} {...profileReturn} className="text-zinc-600 hover:text-zinc-900">
            ← {t(backKey)}
          </Link>
        )}
        {fromRoom && (
          <>
            <span className="text-zinc-300">·</span>
            <Link href={backPath} {...profileReturn} className="text-zinc-500 hover:text-zinc-800">
              {t(backKey)}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

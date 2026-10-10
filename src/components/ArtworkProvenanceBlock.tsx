"use client";

import Link from "next/link";
import type { Artwork, ArtworkClaim } from "@/lib/supabase/artworks";
import { getProvenanceClaims, canViewProvenance } from "@/lib/supabase/artworks";
import { claimTypeToByPhrase } from "@/lib/provenance/rpc";
import type { ClaimType } from "@/lib/provenance/types";
import { formatDisplayName } from "@/lib/identity/format";
import type { Locale } from "@/lib/i18n/locale";
import {
  claimTypeToProvenanceKind,
  provenanceLabel,
} from "@/lib/provenance/label";
import { useT } from "@/lib/i18n/useT";

type Props = {
  artwork: Artwork;
  viewerId: string | null;
  /** Compact = one line; full = list */
  variant?: "compact" | "full";
  className?: string;
  /** Prevent navigation (e.g. inside card click) */
  stopPropagation?: boolean;
  /** Exclude this claim ID from display (e.g. if already shown as primary claim) */
  excludeClaimId?: string | null;
};

function ClaimLine({
  claim,
  stopPropagation,
  t,
  locale,
}: {
  claim: ArtworkClaim;
  stopPropagation?: boolean;
  t: (k: string) => string;
  locale: Locale;
}) {
  const byPhrase = claimTypeToByPhrase(claim.claim_type as ClaimType);
  if (!byPhrase) return null;

  const prof = claim.profiles;
  const label = formatDisplayName(prof, t, locale);
  const kind = claimTypeToProvenanceKind(claim.claim_type as ClaimType);
  const sentence = provenanceLabel(kind, t);

  return (
    <span>
      <span className="text-zinc-400">{sentence}</span>{" "}
      {byPhrase}{" "}
      {prof?.username ? (
        <Link
          href={`/u/${prof.username}`}
          onClick={(e) => stopPropagation && e.stopPropagation()}
          className="hover:text-zinc-900"
        >
          {label}
        </Link>
      ) : (
        label
      )}
    </span>
  );
}

export function ArtworkProvenanceBlock({
  artwork,
  viewerId,
  variant = "compact",
  className = "",
  stopPropagation = false,
  excludeClaimId = null,
}: Props) {
  const { t, locale } = useT();
  if (!canViewProvenance(artwork, viewerId)) return null;
  const claims = getProvenanceClaims(artwork);
  const nonCreated = claims.filter(
    (c) => c.claim_type !== "CREATED" && c.id !== excludeClaimId
  );
  if (nonCreated.length === 0) return null;

  if (variant === "compact") {
    return (
      <p className={`mt-1 text-sm text-zinc-500 ${className}`}>
        {nonCreated.map((c, i) => (
          <span key={c.id ?? i}>
            {i > 0 && " · "}
            <ClaimLine claim={c} stopPropagation={stopPropagation} t={t} locale={locale} />
          </span>
        ))}
      </p>
    );
  }

  return (
    <ul className={`mt-2 space-y-1 text-sm text-zinc-600 ${className}`}>
      {nonCreated.map((c, i) => (
        <li key={c.id ?? i}>
          <ClaimLine claim={c} stopPropagation={stopPropagation} t={t} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

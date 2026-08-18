"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import type { EntitlementDecision } from "@/lib/entitlements";

/**
 * Paywall CTA for the Display / Hang Simulation surfaces.
 *
 * The project doesn't ship a canonical `<Paywall>` component today —
 * gated features surface upgrade prompts inline (see
 * `MessageComposer`'s `near_limit` copy, `insights.upgradeToSeeViewers`,
 * `studio.views.upgrade`, etc.). This is the simulation-flavored
 * version of that inline pattern, kept in one file so the list page,
 * artwork CTA sheet, and editor share exact copy + link.
 *
 * We link to `/settings/plans` if it exists — otherwise `/settings` —
 * because there's no dedicated pricing page yet. When one lands, this
 * is the only file to edit.
 */
export function SimulationPaywallCard({
  variant = "create",
  decision,
  className,
}: {
  variant?: "create" | "export";
  decision?: EntitlementDecision | null;
  className?: string;
}) {
  const { t } = useT();
  const titleKey =
    variant === "export" ? "simulation.paywall.export.title" : "simulation.paywall.title";
  const bodyKey =
    variant === "export" ? "simulation.paywall.export.body" : "simulation.paywall.body";
  const hint = decision?.paywallHint ?? null;
  const href = hint ? `/settings?highlight=${encodeURIComponent(hint)}` : "/settings";
  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50/70 p-4 ${className ?? ""}`}
      role="status"
    >
      <p className="text-sm font-medium text-zinc-900">{t(titleKey)}</p>
      <p className="mt-1 text-xs text-zinc-500">{t(bodyKey)}</p>
      <div className="mt-3">
        <Link
          href={href}
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
        >
          {t("simulation.paywall.cta")}
        </Link>
      </div>
    </div>
  );
}

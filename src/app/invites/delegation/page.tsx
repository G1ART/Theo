"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import { getSession } from "@/lib/supabase/auth";
import {
  PRESET_PERMISSIONS,
  acceptDelegationByToken,
  declineDelegationById,
  getDelegationByToken,
  type DelegationPreset,
  type GetDelegationByTokenResult,
} from "@/lib/supabase/delegations";
import { permissionLabel } from "@/lib/delegation/permissionLabel";
import { backToLabel } from "@/lib/i18n/back";

const DENIES_SHARED = [
  "delegation.deniesShared.login",
  "delegation.deniesShared.billing",
  "delegation.deniesShared.deleteAccount",
  "delegation.deniesShared.delegations",
] as const;

function scopeLabel(scope: string, t: (k: string) => string): string {
  switch (scope) {
    case "account":
      return t("delegation.inviteScopeAccount");
    case "project":
      return t("delegation.inviteScopeProject");
    case "inventory":
      return t("delegation.inviteScopeInventory");
    default:
      return scope;
  }
}

function presetTitleKey(p: DelegationPreset): string {
  switch (p) {
    case "operations":
      return "delegation.preset.operations.title";
    case "content":
      return "delegation.preset.content.title";
    case "review":
      return "delegation.preset.review.title";
    case "project_co_edit":
      return "delegation.preset.projectCoEdit.title";
    case "project_works_only":
      return "delegation.preset.projectWorksOnly.title";
    case "project_review":
      return "delegation.preset.projectReview.title";
  }
}

function InvitesDelegationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { t, locale } = useT();

  const [info, setInfo] = useState<GetDelegationByTokenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setInfo({ found: false });
      setLoading(false);
      return;
    }
    const sessionRes = await getSession();
    setHasSession(!!sessionRes.data?.session);

    const { data: delegationData, error } = await getDelegationByToken(token);
    if (error) {
      setInfo({ found: false });
      setLoading(false);
      return;
    }
    setInfo(delegationData ?? { found: false });
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAccept() {
    if (!token || !info?.found) return;
    setAccepting(true);
    setAcceptError(null);
    const { data, error } = await acceptDelegationByToken(token);
    setAccepting(false);
    if (error) {
      setAcceptError(t("delegation.acceptFailed"));
      return;
    }
    if (data?.ok) {
      setAccepted(true);
      router.replace("/my/delegations");
      return;
    }
    if (data?.reason === "email_mismatch" || data?.code === "email_mismatch") {
      setAcceptError(t("delegation.acceptFailed"));
    } else if (data?.code === "already_used") {
      // Race: somebody else (or another tab) accepted/declined just now.
      // Reload so we render the correct already-* state instead of a
      // misleading generic error.
      await load();
    } else {
      setAcceptError(t("delegation.invalidOrExpired"));
    }
  }

  async function handleDecline() {
    if (!info?.found || !info.id) return;
    setDeclining(true);
    setAcceptError(null);
    const { data, error } = await declineDelegationById(info.id);
    setDeclining(false);
    if (error || !data?.ok) {
      // Don't surface a destructive-looking error here — the user
      // explicitly chose not to accept. Route them to the hub which can
      // show a precise state if needed.
      router.replace("/my/delegations");
      return;
    }
    router.replace("/my/delegations");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (!info?.found) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-4 text-xl font-semibold">{t("delegation.inviteTitle")}</h1>
        <p className="text-zinc-600">{t("delegation.invalidOrExpired")}</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-zinc-700 underline">
          ← {backToLabel(t("common.home"), locale)}
        </Link>
      </div>
    );
  }

  // Graceful handling for non-pending statuses. The RPC now returns the
  // row regardless of status (handoff parity migration), so these
  // branches actually fire instead of falling through to "invalid".
  if (info.status && info.status !== "pending") {
    const statusBody = (() => {
      switch (info.status) {
        case "active":
          return t("delegation.alreadyActive");
        case "declined":
          return t("delegation.alreadyDeclined");
        case "revoked":
          return t("delegation.alreadyRevoked");
        case "expired":
          return t("delegation.alreadyExpired");
        default:
          return t("delegation.invalidOrExpired");
      }
    })();
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-4 text-xl font-semibold">{t("delegation.inviteTitle")}</h1>
        <p className="text-zinc-600">{statusBody}</p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/my/delegations"
            className="rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
          >
            {t("delegation.openHub")}
          </Link>
          <Link
            href="/"
            className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            {t("common.home")}
          </Link>
        </div>
      </div>
    );
  }

  const delegatorName =
    (info.delegator && formatDisplayName(info.delegator, t, locale)) ||
    (info.delegator?.username ? `@${info.delegator.username}` : null) ||
    "Someone";
  const scope = scopeLabel(info.scope_type ?? "project", t);
  const projectTitle =
    info.scope_type === "project" && info.project
      ? pickLocalizedTitle(info.project, locale) || info.project.title || null
      : null;

  if (!hasSession) {
    const nextTarget = `/invites/delegation?token=${token}`;
    const loginUrl = `/login?next=${encodeURIComponent(nextTarget)}`;
    const signUpUrl = `/onboarding?next=${encodeURIComponent(nextTarget)}`;
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-4 text-xl font-semibold">{t("delegation.inviteTitle")}</h1>
        <p className="mb-2 text-zinc-700">
          {t("delegation.inviteFrom").replace("{name}", delegatorName)} {scope}
          {projectTitle ? ` "${projectTitle}"` : ""}.
        </p>
        <p className="mb-6 text-zinc-600">{t("delegation.logInToAccept")}</p>
        <div className="flex gap-3">
          <Link
            href={loginUrl}
            className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800"
          >
            {t("delegation.logIn")}
          </Link>
          <Link
            href={signUpUrl}
            className="rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-50"
          >
            {t("delegation.signUp")}
          </Link>
        </div>
      </div>
    );
  }

  const preset = info.preset ?? null;
  const presetTitle = preset ? t(presetTitleKey(preset)) : null;
  const permissions = preset ? PRESET_PERMISSIONS[preset] : [];

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-2 text-xl font-semibold">{t("delegation.inviteTitle")}</h1>
      <p className="mb-6 text-zinc-700">
        {t("delegation.inviteFrom").replace("{name}", delegatorName)} {scope}
        {projectTitle ? ` "${projectTitle}"` : ""}.
      </p>

      {presetTitle && (
        <section className="mb-5 rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {t("delegation.detail.presetLabel")}
          </p>
          <p className="text-sm font-medium text-zinc-900">{presetTitle}</p>
        </section>
      )}

      <section className="mb-5">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.canDo")}
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          {permissions.length > 0 ? (
            permissions.map((p) => (
              <li key={p}>· {permissionLabel(p, t)}</li>
            ))
          ) : (
            <li className="text-zinc-400">—</li>
          )}
        </ul>
      </section>

      <section className="mb-6">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.cannotShare")}
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          {DENIES_SHARED.map((k) => (
            <li key={k}>· {t(k)}</li>
          ))}
        </ul>
      </section>

      {acceptError && (
        <p className="mb-4 text-sm text-red-600">{acceptError}</p>
      )}
      {accepted ? (
        <p className="text-zinc-600">{t("delegation.accepted")}</p>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting || declining}
            className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {accepting ? t("common.loading") : t("delegation.accept")}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={accepting || declining}
            className="rounded border border-zinc-300 px-4 py-2 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {declining ? t("common.loading") : t("delegation.decline")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function InvitesDelegationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      }
    >
      <InvitesDelegationInner />
    </Suspense>
  );
}

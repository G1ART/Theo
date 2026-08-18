"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import {
  ACCOUNT_PRESETS,
  PROJECT_PRESETS,
  PRESET_PERMISSIONS,
  createDelegationInvite,
  createDelegationInviteForProfile,
  type DelegationPreset,
  type DelegationScopeType,
} from "@/lib/supabase/delegations";
import { listMyExhibitions } from "@/lib/supabase/exhibitions";
import type { ExhibitionWithCredits } from "@/lib/exhibitionCredits";
import { searchPeople, type PublicProfile } from "@/lib/supabase/artists";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { classifyDelegationInviteError } from "@/lib/delegation/inviteErrors";
import { permissionLabel } from "@/lib/delegation/permissionLabel";
import { getSession } from "@/lib/supabase/auth";
import { getMyProfile } from "@/lib/supabase/me";

type WizardScope = "account" | "project";

export type CreateDelegationWizardProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (result: { id: string; invite_token: string; scope: DelegationScopeType }) => void;
  /** Pre-fill scope (e.g. from in-context CTA on exhibition pages). */
  initialScope?: WizardScope;
  /** Pre-fill project for project scope. */
  initialProjectId?: string;
  initialProjectTitle?: string;
  /** Pre-fill preset (defaults to operations / project_co_edit). */
  initialPreset?: DelegationPreset;
  /** Optional title override (e.g. "전시 권한 공유"). */
  titleOverride?: string;
};

type StepId = 1 | 1.5 | 2 | 3 | 4;

type PersonSelection =
  | { kind: "user"; profile: PublicProfile }
  | { kind: "email"; email: string }
  | null;

const DENIES_SHARED = [
  "delegation.deniesShared.login",
  "delegation.deniesShared.billing",
  "delegation.deniesShared.deleteAccount",
  "delegation.deniesShared.delegations",
] as const;

function presetTitleKey(p: DelegationPreset): string {
  switch (p) {
    case "operations": return "delegation.preset.operations.title";
    case "content": return "delegation.preset.content.title";
    case "review": return "delegation.preset.review.title";
    case "project_co_edit": return "delegation.preset.projectCoEdit.title";
    case "project_works_only": return "delegation.preset.projectWorksOnly.title";
    case "project_review": return "delegation.preset.projectReview.title";
  }
}

function presetSummaryKey(p: DelegationPreset): string {
  switch (p) {
    case "operations": return "delegation.preset.operations.summary";
    case "content": return "delegation.preset.content.summary";
    case "review": return "delegation.preset.review.summary";
    case "project_co_edit": return "delegation.preset.projectCoEdit.summary";
    case "project_works_only": return "delegation.preset.projectWorksOnly.summary";
    case "project_review": return "delegation.preset.projectReview.summary";
  }
}

export function CreateDelegationWizard(props: CreateDelegationWizardProps) {
  const { open, onClose, onCreated, initialScope, initialProjectId, initialProjectTitle, initialPreset, titleOverride } = props;
  const { t, locale } = useT();

  const [step, setStep] = useState<StepId>(initialScope ? (initialScope === "project" && !initialProjectId ? 1.5 : 2) : 1);
  const [scope, setScope] = useState<WizardScope>(initialScope ?? "account");
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [projectTitle, setProjectTitle] = useState<string | null>(initialProjectTitle ?? null);
  const [exhibitions, setExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const [person, setPerson] = useState<PersonSelection>(null);
  const [personTab, setPersonTab] = useState<"user" | "email">("user");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [preset, setPreset] = useState<DelegationPreset>(
    initialPreset ?? (scope === "project" ? "project_co_edit" : "operations")
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customPermissions, setCustomPermissions] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myDisplayName, setMyDisplayName] = useState<string | null>(null);
  /**
   * When the SMTP send fails (or throws), we pause inside the wizard
   * with this token captured so the user can copy the invite URL and
   * share it manually. The delegation row already exists by then.
   * Cleared when the user dismisses the fallback panel.
   */
  const [emailFailedResult, setEmailFailedResult] = useState<
    | { id: string; invite_token: string; scope: DelegationScopeType; recipientEmail: string }
    | null
  >(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(initialScope ? (initialScope === "project" && !initialProjectId ? 1.5 : 2) : 1);
    setScope(initialScope ?? "account");
    setProjectId(initialProjectId ?? null);
    setProjectTitle(initialProjectTitle ?? null);
    setPerson(null);
    setPersonTab("user");
    setSearchQ("");
    setSearchResults([]);
    setEmailDraft("");
    setPreset(initialPreset ?? ((initialScope ?? "account") === "project" ? "project_co_edit" : "operations"));
    setShowAdvanced(false);
    setCustomPermissions(null);
    setNote("");
    setError(null);
    setSubmitting(false);
  }, [open, initialScope, initialProjectId, initialProjectTitle, initialPreset]);

  useEffect(() => {
    if (!open) return;
    getSession().then(({ data: { session } }) => setMyId(session?.user?.id ?? null));
    getMyProfile().then(({ data }) => {
      if (!data) {
        setMyDisplayName(null);
        return;
      }
      const name = formatDisplayName(data, t, locale) || data.username || null;
      setMyDisplayName(name);
    });
  }, [open, t, locale]);

  useEffect(() => {
    if (!open) return;
    if (step !== 1.5 || initialProjectId) return;
    setExLoading(true);
    listMyExhibitions().then(({ data }) => {
      setExhibitions(data ?? []);
      setExLoading(false);
    });
  }, [open, step, initialProjectId]);

  useEffect(() => {
    if (!open || personTab !== "user") return;
    const handle = setTimeout(async () => {
      const q = searchQ.trim();
      if (!q) {
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      const { data } = await searchPeople({ q, limit: 10 });
      setSearchResults((data ?? []).filter((p) => p.id !== myId));
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQ, personTab, open, myId]);

  // When scope changes, reset preset to a valid one for the scope.
  useEffect(() => {
    setPreset((p) =>
      scope === "project"
        ? PROJECT_PRESETS.includes(p) ? p : "project_co_edit"
        : ACCOUNT_PRESETS.includes(p) ? p : "operations"
    );
    setCustomPermissions(null);
    setShowAdvanced(false);
  }, [scope]);

  const presets = scope === "project" ? PROJECT_PRESETS : ACCOUNT_PRESETS;
  const effectivePermissions = customPermissions ?? PRESET_PERMISSIONS[preset];

  const canAdvance = useMemo(() => {
    if (step === 1) return true;
    if (step === 1.5) return !!projectId;
    if (step === 2) {
      if (personTab === "user") return person?.kind === "user";
      return /^.+@.+\..+$/.test(emailDraft.trim());
    }
    if (step === 3) return effectivePermissions.length > 0;
    return true;
  }, [step, projectId, personTab, person, emailDraft, effectivePermissions]);

  const goNext = useCallback(() => {
    setError(null);
    if (step === 1) {
      if (scope === "project" && !projectId) setStep(1.5);
      else setStep(2);
      return;
    }
    if (step === 1.5) {
      setStep(2);
      return;
    }
    if (step === 2) {
      if (personTab === "email") {
        const email = emailDraft.trim().toLowerCase();
        setPerson({ kind: "email", email });
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
  }, [step, scope, projectId, personTab, emailDraft]);

  const goBack = useCallback(() => {
    setError(null);
    if (step === 1.5) setStep(1);
    else if (step === 2) setStep(scope === "project" ? 1.5 : 1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  }, [step, scope]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const trimmedNote = note.trim();
      const noteValue = trimmedNote === "" ? null : trimmedNote;
      const usePreset = customPermissions === null ? preset : null;
      const usePerms = customPermissions ?? null;

      if (person?.kind === "user") {
        const { data, error: rpcErr } = await createDelegationInviteForProfile({
          delegateProfileId: person.profile.id,
          scopeType: scope as DelegationScopeType,
          projectId: scope === "project" ? projectId : null,
          permissions: usePerms ?? undefined,
          preset: usePreset,
          note: noteValue,
        });
        if (rpcErr || !data) {
          const cls = classifyDelegationInviteError(rpcErr);
          setError(t(cls.key));
          setSubmitting(false);
          return;
        }
        onCreated?.({ id: data.id, invite_token: data.invite_token, scope: scope as DelegationScopeType });
      } else if (person?.kind === "email") {
        const { data, error: rpcErr } = await createDelegationInvite({
          delegateEmail: person.email,
          scopeType: scope as DelegationScopeType,
          projectId: scope === "project" ? projectId : null,
          permissions: usePerms ?? undefined,
          preset: usePreset,
          note: noteValue,
        });
        if (rpcErr || !data) {
          const cls = classifyDelegationInviteError(rpcErr);
          setError(t(cls.key));
          setSubmitting(false);
          return;
        }
        // Fire SMTP email so external/non-onboarded recipients actually get the
        // invite. RPC creates the row + token, this hop carries it to inbox.
        // We surface a non-blocking warning if email fails — the invite row
        // still exists and is reachable from the hub.
        try {
          const resp = await fetch("/api/delegation-invite-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toEmail: person.email,
              inviterName: myDisplayName,
              scopeType: scope,
              projectTitle: scope === "project" ? projectTitle : null,
              inviteToken: data.invite_token,
            }),
          });
          if (!resp.ok) {
            console.warn("delegation-invite-email failed", resp.status);
            // Keep the wizard open with a fallback panel: the row is
            // already created server-side, but the email never reached
            // the recipient. Surface the invite link so the inviter can
            // share it through their own channel (DM, work chat, etc.).
            setEmailFailedResult({
              id: data.id,
              invite_token: data.invite_token,
              scope: scope as DelegationScopeType,
              recipientEmail: person.email,
            });
            setSubmitting(false);
            return;
          }
        } catch (emailErr) {
          console.warn("delegation-invite-email threw", emailErr);
          setEmailFailedResult({
            id: data.id,
            invite_token: data.invite_token,
            scope: scope as DelegationScopeType,
            recipientEmail: person.email,
          });
          setSubmitting(false);
          return;
        }
        onCreated?.({ id: data.id, invite_token: data.invite_token, scope: scope as DelegationScopeType });
      } else {
        setError(t("delegation.error.unknown"));
        setSubmitting(false);
        return;
      }
      onClose();
    } catch (e) {
      const cls = classifyDelegationInviteError(e);
      setError(t(cls.key));
    } finally {
      setSubmitting(false);
    }
  }, [note, customPermissions, preset, person, scope, projectId, projectTitle, myDisplayName, onCreated, onClose, t]);

  if (!open) return null;

  const titleText = titleOverride ?? t("delegation.wizard.title");

  // Build the absolute invite URL for the link-copy fallback. We pull
  // the canonical app origin from NEXT_PUBLIC_APP_URL so the link looks
  // identical to what we send via email; falling back to window.origin
  // for local dev. Computed at render time intentionally — the token
  // never changes after the row is created.
  const buildInviteUrl = (token: string): string => {
    const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
    const origin =
      configured ||
      (typeof window !== "undefined" ? window.location.origin : "");
    return `${origin}/invites/delegation?token=${token}`;
  };

  const handleCopyLink = async (token: string) => {
    const url = buildInviteUrl(token);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 2000);
        return;
      }
    } catch {
      // fall through to legacy textarea fallback below
    }
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 2000);
      } catch {
        // last resort: leave selection so user can Ctrl+C
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  const handleFallbackDone = () => {
    if (emailFailedResult) {
      onCreated?.({
        id: emailFailedResult.id,
        invite_token: emailFailedResult.invite_token,
        scope: emailFailedResult.scope,
      });
    }
    setEmailFailedResult(null);
    setLinkCopied(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-3 pt-12 sm:items-center sm:px-6 sm:py-12">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <h2 className="truncate text-base font-semibold text-zinc-900">{titleText}</h2>
              {!emailFailedResult && (
                <StepDots step={step} scope={scope} skipExhibitionPick={!!initialProjectId} />
              )}
            </div>
            <button
              type="button"
              onClick={emailFailedResult ? handleFallbackDone : onClose}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
              aria-label={t("delegation.wizard.cancel")}
            >
              ✕
            </button>
          </div>
          {/*
            When a caller opens the wizard already scoped to one exhibition
            (e.g. from the "Share exhibition access" CTA), surface a subline
            that reminds the user this is a per-exhibition share, not an
            account-wide delegation. Keeps the underlying "delegation" term
            visible in copy but reframes it in the entry context.
          */}
          {!emailFailedResult && titleOverride && scope === "project" && initialProjectId && projectTitle && (
            <p className="mt-1 truncate text-xs text-zinc-500">
              {t("delegation.wizard.subtitleShareExhibition").replace("{title}", projectTitle)}
            </p>
          )}
        </header>

        {emailFailedResult && (
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <p className="text-base font-semibold text-zinc-900">
              {t("delegation.fallback.title")}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              {t("delegation.fallback.body").replace(
                "{email}",
                emailFailedResult.recipientEmail
              )}
            </p>
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("delegation.fallback.linkLabel")}
              </p>
              <p className="break-all text-xs text-zinc-700">
                {buildInviteUrl(emailFailedResult.invite_token)}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyLink(emailFailedResult.invite_token)}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {linkCopied
                  ? t("delegation.fallback.copied")
                  : t("delegation.fallback.copyLink")}
              </button>
              <button
                type="button"
                onClick={handleFallbackDone}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {t("delegation.fallback.done")}
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
              {t("delegation.fallback.privacyNote")}
            </p>
          </div>
        )}

        {!emailFailedResult && (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {step === 1 && (
            <div>
              <p className="mb-1 text-base font-medium text-zinc-900">{t("delegation.wizard.step1Title")}</p>
              <p className="mb-4 text-sm text-zinc-500">{t("delegation.wizard.step1Hint")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ScopeCard
                  active={scope === "account"}
                  onClick={() => setScope("account")}
                  title={t("delegation.wizard.scopeAccount.title")}
                  body={t("delegation.wizard.scopeAccount.body")}
                  safety={t("delegation.wizard.scopeAccount.safety")}
                />
                <ScopeCard
                  active={scope === "project"}
                  onClick={() => setScope("project")}
                  title={t("delegation.wizard.scopeProject.title")}
                  body={t("delegation.wizard.scopeProject.body")}
                  safety={t("delegation.wizard.scopeProject.safety")}
                />
              </div>
            </div>
          )}

          {step === 1.5 && (
            <div>
              <p className="mb-1 text-base font-medium text-zinc-900">{t("delegation.wizard.step1bTitle")}</p>
              <p className="mb-4 text-sm text-zinc-500">{t("delegation.wizard.step1bHint")}</p>
              {exLoading ? (
                <p className="text-sm text-zinc-500">{t("common.loading")}</p>
              ) : exhibitions.length === 0 ? (
                <p className="text-sm text-zinc-500">{t("delegation.wizard.exhibitionEmpty")}</p>
              ) : (
                <ul className="space-y-2">
                  {exhibitions.map((ex) => {
                    const active = projectId === ex.id;
                    return (
                      <li key={ex.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setProjectId(ex.id);
                            setProjectTitle(pickLocalizedTitle(ex, locale) || ex.title);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            active
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                          }`}
                        >
                          <span className="truncate font-medium">
                            {pickLocalizedTitle(ex, locale) || ex.title}
                          </span>
                          {ex.start_date && (
                            <span className={`ml-3 shrink-0 text-xs ${active ? "text-zinc-300" : "text-zinc-500"}`}>
                              {new Date(ex.start_date).getFullYear()}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-3 text-base font-medium text-zinc-900">{t("delegation.wizard.step2Title")}</p>
              <div className="mb-3 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-xs">
                {(["user", "email"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setPersonTab(tab)}
                    className={`rounded-md px-3 py-1.5 ${
                      personTab === tab ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
                    }`}
                  >
                    {tab === "user"
                      ? t("delegation.wizard.step2TabUser")
                      : t("delegation.wizard.step2TabEmail")}
                  </button>
                ))}
              </div>

              {personTab === "user" ? (
                person?.kind === "user" ? (
                  <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-center gap-3">
                      <Avatar profile={person.profile} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {formatDisplayName(person.profile, t, locale) ||
                            person.profile.username ||
                            "—"}
                        </p>
                        {person.profile.username && (
                          <p className="text-xs text-zinc-500">@{person.profile.username}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPerson(null)}
                      className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                    >
                      {t("delegation.wizard.step2ChangePerson")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder={t("delegation.searchUserPlaceholder")}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    />
                    {searchLoading && (
                      <p className="mt-2 text-xs text-zinc-400">{t("common.loading")}</p>
                    )}
                    {searchResults.length > 0 && (
                      <ul className="mt-2 max-h-56 divide-y divide-zinc-100 overflow-auto rounded-lg border border-zinc-200">
                        {searchResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setPerson({ kind: "user", profile: p })}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                            >
                              <Avatar profile={p} />
                              <span className="min-w-0 flex-1 truncate">
                                {formatDisplayName(p, t, locale) ||
                                  p.username ||
                                  p.id.slice(0, 8)}
                              </span>
                              {p.username && (
                                <span className="shrink-0 text-xs text-zinc-400">@{p.username}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              ) : (
                <div>
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder={t("delegation.wizard.step2EmailPlaceholder")}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-2 text-xs text-zinc-500">{t("delegation.wizard.step2EmailHint")}</p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="mb-1 text-base font-medium text-zinc-900">{t("delegation.wizard.step3Title")}</p>
              <p className="mb-4 text-sm text-zinc-500">{t("delegation.wizard.step3Hint")}</p>
              <ul className="space-y-2">
                {presets.map((p) => {
                  const active = preset === p;
                  return (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => {
                          setPreset(p);
                          setCustomPermissions(null);
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? "border-zinc-900 bg-zinc-50"
                            : "border-zinc-200 hover:border-zinc-300"
                        }`}
                      >
                        <p className="text-sm font-semibold text-zinc-900">{t(presetTitleKey(p))}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">{t(presetSummaryKey(p))}</p>
                        <PermsRollup t={t} permissions={PRESET_PERMISSIONS[p]} />
                      </button>
                    </li>
                  );
                })}
              </ul>

              <details
                className="mt-4 rounded-lg border border-zinc-200"
                open={showAdvanced}
                onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-zinc-600">
                  {t("delegation.wizard.step3Advanced")}
                </summary>
                <div className="border-t border-zinc-100 px-3 py-3">
                  <p className="mb-2 text-xs text-zinc-500">{t("delegation.wizard.step3AdvancedHint")}</p>
                  <AdvancedPermissionsToggle
                    t={t}
                    base={PRESET_PERMISSIONS[preset]}
                    value={customPermissions ?? PRESET_PERMISSIONS[preset]}
                    onChange={(perms) => setCustomPermissions(perms)}
                  />
                </div>
              </details>
            </div>
          )}

          {step === 4 && (
            <div data-step="4">
              <p className="mb-3 text-base font-medium text-zinc-900">{t("delegation.wizard.step4Title")}</p>
              <dl className="space-y-3 text-sm">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("delegation.wizard.step4Person")}</dt>
                  <dd className="mt-1 text-zinc-800">
                    {person?.kind === "user"
                      ? formatDisplayName(person.profile, t, locale) ||
                        person.profile.username ||
                        "—"
                      : person?.kind === "email"
                      ? person.email
                      : "—"}
                  </dd>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("delegation.wizard.step4Scope")}</dt>
                  <dd className="mt-1 text-zinc-800">
                    {scope === "project"
                      ? projectTitle
                        ? t("delegation.scopeExhibitionPrefix").replace("{title}", projectTitle)
                        : t("delegation.scopeProject")
                      : t("delegation.scopeAccount")}
                  </dd>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("delegation.wizard.step4Preset")}</dt>
                  <dd className="mt-1 text-zinc-800">{t(presetTitleKey(preset))}</dd>
                  <PermsRollup t={t} permissions={effectivePermissions} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600">
                    {t("delegation.wizard.step4NoteLabel")}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 280))}
                    placeholder={t("delegation.wizard.step4NotePlaceholder")}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  />
                </div>
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {t("delegation.wizard.step4Trust")}
                </p>
                <DeniesShared t={t} />
              </dl>
              {error && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
        )}

        {!emailFailedResult && (
        <footer className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            {step === 1 ? t("delegation.wizard.cancel") : t("delegation.wizard.back")}
          </button>
          {step === 4 ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? t("delegation.wizard.submitting") : t("delegation.wizard.submit")}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {t("delegation.wizard.next")}
            </button>
          )}
        </footer>
        )}
      </div>
    </div>
  );
}

function StepDots({ step, scope, skipExhibitionPick }: { step: StepId; scope: WizardScope; skipExhibitionPick: boolean }) {
  const stages: StepId[] =
    scope === "project" && !skipExhibitionPick
      ? [1, 1.5, 2, 3, 4]
      : [1, 2, 3, 4];
  return (
    <div className="hidden items-center gap-1 sm:flex" aria-hidden="true">
      {stages.map((s) => (
        <span
          key={s}
          className={`h-1.5 w-4 rounded-full ${
            step >= s ? "bg-zinc-900" : "bg-zinc-200"
          }`}
        />
      ))}
    </div>
  );
}

function ScopeCard({
  active, onClick, title, body, safety,
}: { active: boolean; onClick: () => void; title: string; body: string; safety: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full flex-col rounded-xl border p-4 text-left transition-colors ${
        active ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white hover:border-zinc-300"
      }`}
    >
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 text-xs text-zinc-600">{body}</p>
      <p className="mt-3 inline-block rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
        {safety}
      </p>
    </button>
  );
}

function Avatar({ profile }: { profile: PublicProfile }) {
  const url = profile.avatar_url
    ? profile.avatar_url.startsWith("http")
      ? profile.avatar_url
      : getArtworkImageUrl(profile.avatar_url, "avatar")
    : null;
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-9 w-9 rounded-full object-cover" />
    );
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600">
      {(profile.display_name ?? profile.username ?? "?").charAt(0).toUpperCase()}
    </div>
  );
}

function PermsRollup({ t, permissions }: { t: (key: string) => string; permissions: string[] }) {
  if (!permissions || permissions.length === 0) return null;
  const labels = permissions.slice(0, 3).map((p) => permissionLabel(p, t));
  const more = permissions.length > 3 ? ` +${permissions.length - 3}` : "";
  return (
    <p className="mt-2 truncate text-[11px] text-zinc-500">
      {labels.join(" · ")}{more}
    </p>
  );
}

function AdvancedPermissionsToggle({
  t, base, value, onChange,
}: {
  t: (k: string) => string;
  base: string[];
  value: string[];
  onChange: (perms: string[]) => void;
}) {
  const all = base;
  const set = new Set(value);
  return (
    <ul className="space-y-1.5">
      {all.map((perm) => {
        const checked = set.has(perm);
        return (
          <li key={perm}>
            <label className="flex items-center gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = new Set(value);
                  if (e.target.checked) next.add(perm);
                  else next.delete(perm);
                  onChange(Array.from(next));
                }}
              />
              {permissionLabel(perm, t)}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function DeniesShared({ t }: { t: (k: string) => string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
      <p className="text-xs font-medium text-zinc-600">{t("delegation.detail.cannotShare")}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
        {DENIES_SHARED.map((k) => (
          <li key={k}>· {t(k)}</li>
        ))}
      </ul>
    </div>
  );
}

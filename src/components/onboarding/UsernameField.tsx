"use client";

/**
 * UsernameField — single input with live validation, availability
 * check (debounced), and tap-to-fill suggestions derived from the
 * display name / email (Onboarding Identity Overhaul, Track G).
 *
 * Public API is minimal:
 *   <UsernameField
 *     value={username}
 *     onChange={setUsername}
 *     suggestionInput={{ displayName, email }}
 *     onValidityChange={(ok, state) => setUsernameOk(ok)}
 *   />
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { useT } from "@/lib/i18n/useT";
import {
  checkUsernameAvailability,
  type UsernameAvailabilityReason,
} from "@/lib/supabase/profiles";
import {
  fetchUsernameSuggestions,
  type SuggestionInput,
  type UsernameSuggestion,
} from "@/lib/identity/suggestions";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export type UsernameFieldStatus =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "self" }
  | { kind: "taken" }
  | { kind: "reserved" }
  | { kind: "error" };

type Props = {
  value: string;
  onChange: (next: string) => void;
  suggestionInput: SuggestionInput;
  onValidityChange?: (isReady: boolean, status: UsernameFieldStatus) => void;
  inputId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** `"oval"` is the signup Step 2 mark: a pill with `@` centered
   *  until the person types. Suggestions stay on the default field. */
  variant?: "default" | "oval";
  label?: string;
};

function tone(status: UsernameFieldStatus): string {
  switch (status.kind) {
    case "available":
    case "self":
      return "text-emerald-600";
    case "invalid":
    case "taken":
    case "reserved":
    case "error":
      return "text-red-600";
    case "checking":
      return "text-zinc-500";
    default:
      return "text-zinc-500";
  }
}

function reasonToStatus(
  reason: UsernameAvailabilityReason,
  available: boolean
): UsernameFieldStatus {
  if (reason === "available" || (available && reason === "self")) {
    return reason === "self" ? { kind: "self" } : { kind: "available" };
  }
  switch (reason) {
    case "taken":
      return { kind: "taken" };
    case "invalid":
    case "empty":
      return { kind: "invalid" };
    case "reserved":
      return { kind: "reserved" };
    default:
      return { kind: "error" };
  }
}

export function UsernameField({
  value,
  onChange,
  suggestionInput,
  onValidityChange,
  inputId = "onboarding-username",
  autoFocus = false,
  disabled = false,
  variant = "default",
  label,
}: Props) {
  const { t } = useT();
  // Only the async RPC result lives in state, keyed by the normalized
  // input. The synchronous `idle` / `invalid` / `checking` baseline is
  // derived during render, which keeps us away from the
  // `react-hooks/set-state-in-effect` cascade rule.
  const [asyncResult, setAsyncResult] = useState<
    { forKey: string; status: UsernameFieldStatus } | null
  >(null);
  const [suggestions, setSuggestions] = useState<UsernameSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const seqRef = useRef(0);
  const suggestionSeqRef = useRef(0);

  const normalized = value.trim().toLowerCase();

  const baseStatus = useMemo<UsernameFieldStatus>(() => {
    if (!normalized) return { kind: "idle" };
    if (!USERNAME_REGEX.test(normalized)) return { kind: "invalid" };
    return { kind: "checking" };
  }, [normalized]);

  const status: UsernameFieldStatus =
    asyncResult && asyncResult.forKey === normalized ? asyncResult.status : baseStatus;

  useEffect(() => {
    if (!normalized || !USERNAME_REGEX.test(normalized)) {
      // Nothing to fetch — `status` falls back to `baseStatus` because
      // the cached async result (if any) is keyed to a stale value.
      return;
    }
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      const res = await checkUsernameAvailability(normalized);
      if (seq !== seqRef.current) return;
      setAsyncResult({ forKey: normalized, status: reasonToStatus(res.reason, res.available) });
    }, 350);
    return () => clearTimeout(handle);
  }, [normalized]);

  const isReady = status.kind === "available" || status.kind === "self";

  useEffect(() => {
    onValidityChange?.(isReady, status);
  }, [isReady, status, onValidityChange]);

  const loadSuggestions = useCallback(async () => {
    const seq = ++suggestionSeqRef.current;
    const hasSource =
      (suggestionInput.displayName ?? "").trim().length > 0 ||
      (suggestionInput.email ?? "").trim().length > 0;
    if (!hasSource) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    const list = await fetchUsernameSuggestions(suggestionInput, { limit: 3 });
    if (seq !== suggestionSeqRef.current) return;
    setSuggestions(list);
    setLoadingSuggestions(false);
  }, [suggestionInput]);

  useEffect(() => {
    if (variant === "oval") return;
    // Re-derive suggestions whenever the source inputs change. We
    // debounce slightly so typing a display name doesn't hammer the
    // RPC on each keystroke.
    const handle = setTimeout(() => {
      void loadSuggestions();
    }, 450);
    return () => clearTimeout(handle);
  }, [loadSuggestions, variant]);

  const statusLabel = useMemo(() => {
    switch (status.kind) {
      case "checking":
        return t("identity.username.live.checking");
      case "available":
      case "self":
        return t("identity.username.live.available");
      case "taken":
        return t("identity.username.live.taken");
      case "invalid":
        return t("identity.username.live.invalid");
      case "reserved":
        return t("identity.username.live.reserved");
      case "error":
        return t("identity.username.live.error");
      default:
        return null;
    }
  }, [status.kind, t]);

  if (variant === "oval") {
    const ovalError =
      status.kind === "taken" ||
      status.kind === "invalid" ||
      status.kind === "reserved" ||
      status.kind === "error"
        ? statusLabel
        : undefined;
    return (
      <OvalInput
        id={inputId}
        labelStyle="outer"
        label={label ?? t("identity.finish.labelUsername")}
        value={value}
        onChange={(next) => onChange(next.toLowerCase())}
        leadingAdornment="@"
        centerLeading={!normalized}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        loading={status.kind === "checking"}
        error={ovalError ?? undefined}
      />
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-zinc-900">
        {t("identity.finish.labelUsername")}
      </label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400"
        >
          @
        </span>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="yourname"
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-7 pr-3 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={`${inputId}-hint ${inputId}-status`}
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <p id={`${inputId}-hint`} className="text-zinc-500">
          {t("identity.finish.usernameHint")}
        </p>
        {statusLabel && (
          <p id={`${inputId}-status`} className={tone(status)}>
            {statusLabel}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          {t("identity.username.suggestions.title")}
        </span>
        {loadingSuggestions && suggestions.length === 0 ? (
          <span className="text-xs text-zinc-500">
            {t("identity.username.suggestions.loading")}
          </span>
        ) : suggestions.length === 0 ? (
          <span className="text-xs text-zinc-500">
            {t("identity.username.suggestions.empty")}
          </span>
        ) : (
          suggestions.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange(s.value)}
              className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
              disabled={disabled}
            >
              @{s.value}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => void loadSuggestions()}
          className="ml-auto rounded-full px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          disabled={disabled || loadingSuggestions}
        >
          {t("identity.username.suggestions.reload")}
        </button>
      </div>
    </div>
  );
}

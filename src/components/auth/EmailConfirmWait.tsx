"use client";

import { useEffect, useRef, useState } from "react";
import {
  deliverSignupConfirmation,
  getSession,
  isUnconfirmedAuthError,
  signInWithPassword,
} from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";

/**
 * The confirmation link may be opened on another device. That click
 * confirms the account on the server, but the session lands only in
 * the browser that opened the link. This screen still has the password
 * the user just chose, so it signs in here as soon as the email is
 * confirmed — no need to press the link on this same device.
 */
export function EmailConfirmWait({
  email,
  password,
  nextPath,
  onConfirmed,
  onChangeEmail,
}: {
  email: string;
  password: string;
  nextPath: string | null;
  onConfirmed: (userId: string) => void;
  /** Lets the person leave the wait and edit the address. */
  onChangeEmail?: () => void;
}) {
  const { t } = useT();
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stillWaiting, setStillWaiting] = useState(false);
  const done = useRef(false);
  const busy = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  function sameEmail(sessionEmail: string | null | undefined): boolean {
    const left = sessionEmail?.trim().toLowerCase() ?? "";
    return left.length > 0 && left === email.trim().toLowerCase();
  }

  async function tryContinue(manual: boolean) {
    if (done.current || busy.current) return;
    busy.current = true;
    // The link may have been opened in another tab of this browser.
    // That writes the session here even when the password on an
    // invited ghost does not match what was just typed.
    const { data: existing } = await getSession();
    if (existing.session?.user?.id && sameEmail(existing.session.user.email)) {
      busy.current = false;
      if (done.current) return;
      done.current = true;
      onConfirmedRef.current(existing.session.user.id);
      return;
    }
    if (!password) {
      busy.current = false;
      return;
    }
    const { data, error } = await signInWithPassword(email.trim(), password);
    busy.current = false;
    if (done.current) return;
    if (!error && data.session?.user?.id) {
      done.current = true;
      onConfirmedRef.current(data.session.user.id);
      return;
    }
    if (manual && isUnconfirmedAuthError(error)) setStillWaiting(true);
  }

  useEffect(() => {
    let stopped = false;
    const started = Date.now();

    let timer = 0;
    async function tick() {
      if (stopped || done.current) return;
      if (document.visibilityState === "visible") await tryContinue(false);
      if (stopped || done.current) return;
      if (Date.now() - started > 3 * 60 * 1000) return;
      timer = window.setTimeout(tick, 4000);
    }

    function onVisible() {
      if (document.visibilityState === "visible") void tryContinue(false);
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const first = window.setTimeout(tick, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // Password and email are fixed for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  const sentTemplate = t("onboarding.verify.sent");
  const sentParts = sentTemplate.split("{email}");
  const shownEmail = email.trim();

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-400/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-verify-title"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white px-8 py-10 text-center shadow-lg">
        <h2 id="email-verify-title" className="text-lg font-semibold text-zinc-900">
          {t("onboarding.verify.title")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("onboarding.verify.inbox")}</p>
        <p className="mt-8 text-sm leading-relaxed text-zinc-700">
          {sentParts.length === 2 ? (
            <>
              {sentParts[0]}
              <span className="underline underline-offset-2">{shownEmail}</span>
              {sentParts[1]}
            </>
          ) : (
            sentTemplate.replace("{email}", shownEmail)
          )}
        </p>
        <p className="mt-6 text-sm text-zinc-800">{t("onboarding.verify.open")}</p>
        <div className="mt-8 flex items-center justify-center gap-8 text-sm text-zinc-700">
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setSending(true);
              setNote(null);
              void deliverSignupConfirmation(email.trim(), nextPath).then((res) => {
                setSending(false);
                setNote(
                  res.error
                    ? t("onboarding.verify.resendFailed")
                    : t("onboarding.verify.resent"),
                );
              });
            }}
            className="hover:text-zinc-900 disabled:opacity-50"
          >
            ( {sending ? t("onboarding.verify.resending") : t("onboarding.verify.resend")} )
          </button>
          <button
            type="button"
            onClick={() => {
              setStillWaiting(false);
              void tryContinue(true);
            }}
            className="hover:text-zinc-900"
          >
            ( {t("onboarding.verify.verify")} )
          </button>
        </div>
        {stillWaiting ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {t("onboarding.verify.notYet")}
          </p>
        ) : null}
        {note ? <p className="mt-3 text-xs text-zinc-500">{note}</p> : null}
        {onChangeEmail ? (
          <button
            type="button"
            onClick={onChangeEmail}
            className="mt-5 text-xs text-zinc-500 hover:text-zinc-800"
          >
            {t("onboarding.duplicateEmailUseDifferent")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

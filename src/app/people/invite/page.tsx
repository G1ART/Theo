"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/useT";
import { AuthGate } from "@/components/AuthGate";
import { sendArtistInviteEmailWithResult } from "@/lib/email/artistInvite";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";

/**
 * Invite-by-email entry surface, shipped as a salon-tone variant of
 * the People tab so the visual & copy register stays consistent across
 * "search → no result → invite".
 *
 * The Suspense fallback is text-less (skeleton only) so the KO locale
 * never sees an English literal flash before the form mounts.
 */
function PeopleInviteForm() {
  const searchParams = useSearchParams();
  const { t } = useT();
  const nameFromQuery = searchParams.get("name") ?? "";

  const [artistName, setArtistName] = useState(nameFromQuery.trim());
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<"success" | "already" | "error" | "unconfigured" | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedEmail = email.trim();
      if (!trimmedEmail) return;
      setSending(true);
      setToast(null);
      const result = await sendArtistInviteEmailWithResult({
        toEmail: trimmedEmail,
        artistName: artistName.trim() || null,
        exhibitionTitle: null,
        resend: toast === "already",
      });
      setSending(false);
      if (result.emailed) {
        setToast("success");
        setEmail("");
      } else if (result.alreadySent) {
        setToast("already");
      } else if (result.skipped) {
        setToast(null);
      } else if (result.error === "email_unconfigured") {
        setToast("unconfigured");
      } else {
        setToast("error");
      }
    },
    [artistName, email, toast]
  );

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <PageHeader
          variant="plain"
          title={t("people.invitePage.title")}
          lead={t("people.invitePage.hint")}
        />

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="artistName"
              className="mb-1.5 block text-sm font-medium text-zinc-700"
            >
              {t("people.invitePage.artistName")}
            </label>
            <input
              id="artistName"
              type="text"
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              placeholder={t("people.invitePage.artistNamePlaceholder")}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200"
            />
          </div>
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-zinc-700"
            >
              {t("people.invitePage.email")} <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("people.invitePage.emailPlaceholder")}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200"
            />
          </div>
          {toast && (
            <p
              className={`text-sm ${toast === "success" ? "text-zinc-600" : "text-amber-600"}`}
              role="status"
            >
              {toast === "success"
                ? t("people.invitePage.success")
                : toast === "already"
                  ? t("people.invitePage.alreadySent")
                  : toast === "unconfigured"
                    ? t("people.invitePage.unconfigured")
                    : t("people.invitePage.failed")}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {sending
                ? t("common.loading")
                : toast === "already"
                  ? t("people.invitePage.resend")
                  : t("people.invitePage.send")}
            </button>
            <Link
              href="/people"
              className="rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("people.invitePage.backToSearch")}
            </Link>
          </div>
        </form>
      </PageShell>
    </AuthGate>
  );
}

export default function PeopleInvitePage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="narrow" />}>
      <PeopleInviteForm />
    </Suspense>
  );
}

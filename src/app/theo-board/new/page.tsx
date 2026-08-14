"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { useT } from "@/lib/i18n/useT";
import {
  USER_SUBMIT_TYPES,
  isUserSubmitType,
  submitTheoBoardPost,
  theoBoardTypeLabelKey,
  type TheoBoardType,
} from "@/lib/supabase/theoBoard";

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function NewPostForm() {
  const { t } = useT();
  const router = useRouter();
  const [type, setType] = useState<TheoBoardType>("event");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 1 || trimmedTitle.length > 120) {
      setError(t("theoBoard.form.invalidTitle"));
      return;
    }
    if (!isUserSubmitType(type)) {
      setError(t("theoBoard.form.invalidType"));
      return;
    }
    const hrefTrim = href.trim();
    if (hrefTrim && !isHttpUrl(hrefTrim)) {
      setError(t("theoBoard.form.invalidHref"));
      return;
    }
    let expires: number | null = null;
    if (expiresInDays.trim()) {
      const n = Number(expiresInDays);
      if (!Number.isFinite(n) || n <= 0) {
        setError(t("theoBoard.form.invalidExpires"));
        return;
      }
      expires = n;
    }
    if (!agreed) {
      setError(t("theoBoard.policy.mustAgree"));
      return;
    }

    setBusy(true);
    const { error: err } = await submitTheoBoardPost({
      type,
      title: trimmedTitle,
      body_md: body.trim() || null,
      summary: summary.trim() || null,
      href: hrefTrim || null,
      expires_in_days: expires,
    });
    setBusy(false);
    if (err) {
      const msg = String((err as { message?: string })?.message ?? err);
      setError(msg || t("common.unknownError"));
      return;
    }
    router.push("/theo-board/mine?submitted=1");
  }

  const inputCls = "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm";

  return (
    <PageShell variant="narrow">
      <Link
        href="/theo-board"
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {t("theoBoard.backToBoard")}
      </Link>
      <PageHeader
        variant="plain"
        title={t("theoBoard.submit.title")}
        lead={t("theoBoard.submit.lead")}
        density="tight"
      />

      <div className="mb-6 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">{t("theoBoard.policy.title")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600">
          <li>{t("theoBoard.policy.noFalseClaims")}</li>
          <li>{t("theoBoard.policy.realExhibition")}</li>
          <li>{t("theoBoard.policy.adsClear")}</li>
          <li>{t("theoBoard.policy.staffMayReject")}</li>
          <li>{t("theoBoard.policy.noHarassment")}</li>
        </ul>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.type")}
          </span>
          <select
            value={type}
            onChange={(e) => {
              const v = e.target.value;
              if (isUserSubmitType(v)) setType(v);
            }}
            className={inputCls}
          >
            {USER_SUBMIT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(theoBoardTypeLabelKey(ty))}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.title")}
          </span>
          <input
            type="text"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.summary")}
          </span>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.body")}
          </span>
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.href")}
          </span>
          <input
            type="url"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            {t("theoBoard.form.expiresInDays")}
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="flex items-start gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>{t("theoBoard.policy.agree")}</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || !agreed || !title.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? t("common.loading") : t("theoBoard.form.submit")}
        </button>
      </form>
    </PageShell>
  );
}

export default function TheoBoardNewPage() {
  return (
    <AuthGate>
      <NewPostForm />
    </AuthGate>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import { IR_PERSONAS, isIrDemo, type IrPersonaKey } from "@/lib/irDemo/config";

export default function IrDemoGatePage() {
  const { t } = useT();
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<IrPersonaKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isIrDemo()) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm text-zinc-600">{t("irDemo.notEnabled")}</p>
      </main>
    );
  }

  async function enter(persona: IrPersonaKey) {
    setBusy(persona);
    setError(null);
    try {
      const res = await fetch("/api/ir/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, persona }),
      });
      const json = (await res.json()) as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
        home?: string;
      };
      if (!res.ok || !json.access_token || !json.refresh_token) {
        setError(
          json.error === "forbidden"
            ? t("irDemo.badSecret")
            : t("irDemo.enterFailed"),
        );
        return;
      }
      await supabase.auth.signOut();
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (sessionErr) {
        setError(t("irDemo.enterFailed"));
        return;
      }
      router.replace(json.home || "/feed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
        {t("irDemo.eyebrow")}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{t("irDemo.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{t("irDemo.body")}</p>

      <label className="mt-8 block text-sm font-medium text-zinc-800">
        {t("irDemo.secretLabel")}
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>

      {error && (
        <p className="mt-3 text-sm text-amber-800" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-3">
        {IR_PERSONAS.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={!!busy || secret.trim() === ""}
            onClick={() => void enter(p.key)}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-left hover:bg-zinc-50 disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-zinc-900">
              {t(`irDemo.persona.${p.key}.title`)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {t(`irDemo.persona.${p.key}.hint`)}
            </p>
            {busy === p.key && (
              <p className="mt-2 text-xs text-zinc-500">{t("irDemo.entering")}</p>
            )}
          </button>
        ))}
      </div>
    </main>
  );
}

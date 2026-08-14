"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShell } from "@/components/ds/PageShell";
import { chipButton, chipButtonPrimary } from "@/components/ds/buttonStyles";
import { useT } from "@/lib/i18n/useT";
import {
  getAlertPreferences,
  upsertAlertPreferences,
  listSavedInterests,
  addSavedInterest,
  removeSavedInterest,
  listPendingDigestEvents,
  type AlertPreferences,
  type DigestEventRow,
  type DigestFrequency,
  type SavedInterest,
} from "@/lib/supabase/alerts";

function AlertsContent() {
  const { t } = useT();
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null);
  const [interests, setInterests] = useState<SavedInterest[]>([]);
  const [digestEvents, setDigestEvents] = useState<DigestEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState<SavedInterest["interest_type"]>("artist");
  const [newValue, setNewValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: i }, { data: d }] = await Promise.all([
      getAlertPreferences(),
      listSavedInterests(),
      listPendingDigestEvents(20),
    ]);
    setPrefs(p);
    setInterests(i);
    setDigestEvents(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  const handleToggleAlerts = useCallback(async () => {
    setSaving(true);
    await upsertAlertPreferences({ new_work_alerts: !(prefs?.new_work_alerts ?? true) });
    await refresh();
    setSaving(false);
  }, [prefs, refresh]);

  const handleDigest = useCallback(async (freq: DigestFrequency) => {
    setSaving(true);
    await upsertAlertPreferences({ digest_frequency: freq });
    await refresh();
    setSaving(false);
  }, [refresh]);

  const handleAddInterest = useCallback(async () => {
    if (!newValue.trim()) return;
    await addSavedInterest(newType, newValue);
    setNewValue("");
    void refresh();
  }, [newType, newValue, refresh]);

  const handleRemoveInterest = useCallback(async (id: string) => {
    await removeSavedInterest(id);
    setInterests((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return (
    <PageShell variant="narrow">
      <Link href="/my" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t("profile.privateBackToMy")}
      </Link>
      <PageHeader
        variant="plain"
        title={t("alerts.title")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className={chipButton}>
              {t("alerts.jumpSettings")}
            </Link>
            <Link href="/notifications" className={chipButton}>
              {t("alerts.jumpNotifications")}
            </Link>
          </div>
        }
      />

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 font-medium text-zinc-800">{t("alerts.newWork.title")}</h2>
            <p className="mb-3 text-sm text-zinc-600">{t("alerts.newWork.hint")}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs?.new_work_alerts ?? true}
                onChange={() => void handleToggleAlerts()}
                disabled={saving}
                className="h-4 w-4 rounded border-zinc-300"
              />
              {t("alerts.newWork.enable")}
            </label>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 font-medium text-zinc-800">{t("alerts.digest.title")}</h2>
            <p className="mb-3 text-sm text-zinc-500">{t("alerts.digest.hint")}</p>
            <div className="flex flex-wrap gap-2">
              {(["off", "daily", "weekly"] as const).map((freq) => (
                <button
                  key={freq}
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDigest(freq)}
                  className={
                    (prefs?.digest_frequency ?? "off") === freq
                      ? chipButtonPrimary
                      : chipButton
                  }
                >
                  {t(`alerts.digest.${freq}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 font-medium text-zinc-800">{t("alerts.interests.title")}</h2>
            <p className="mb-3 text-sm text-zinc-600">{t("alerts.interests.hint")}</p>

            <div className="mb-4 flex flex-wrap gap-2">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as SavedInterest["interest_type"])}
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="artist">{t("alerts.interests.type.artist")}</option>
                <option value="medium">{t("alerts.interests.type.medium")}</option>
                <option value="price_band">{t("alerts.interests.type.price_band")}</option>
                <option value="exhibition">{t("alerts.interests.type.exhibition")}</option>
              </select>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t("alerts.interests.placeholder")}
                className="min-w-[160px] flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!newValue.trim()}
                onClick={() => void handleAddInterest()}
                className={`${chipButtonPrimary} disabled:opacity-50`}
              >
                {t("alerts.interests.add")}
              </button>
            </div>

            {interests.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("alerts.interests.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {interests.map((i) => (
                  <li key={i.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-zinc-600">
                        {t(`alerts.interests.type.${i.interest_type}`)}:
                      </span>{" "}
                      <span className="text-zinc-800">{i.interest_value}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveInterest(i.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      {t("alerts.interests.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {digestEvents.length > 0 && (
            <details className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
              <summary className="cursor-pointer text-sm text-zinc-500">
                {t("alerts.queued").replace("{n}", String(digestEvents.length))}
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {digestEvents.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between rounded bg-white px-3 py-1.5 text-sm">
                    <span className="text-zinc-600">{ev.event_type}</span>
                    <span className="text-xs text-zinc-400">{new Date(ev.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </PageShell>
  );
}

export default function AlertsPage() {
  return (
    <AuthGate>
      <AlertsContent />
    </AuthGate>
  );
}

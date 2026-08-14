"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { useT } from "@/lib/i18n/useT";
import {
  STAFF_ROLES,
  claimFounder,
  grantStaff,
  isStaffAtLeast,
  listStaff,
  lookupStaffCandidates,
  revokeStaff,
  type StaffLookupRow,
  type StaffRole,
  type StaffRow,
} from "@/lib/ops/staff";

function personLabel(row: { display_name?: string | null; username?: string | null }) {
  const name = row.display_name?.trim();
  const user = row.username?.trim();
  if (name && user) return `${name} @${user}`;
  if (name) return name;
  if (user) return `@${user}`;
  return "—";
}

function StaffContent() {
  const { t } = useT();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [candidates, setCandidates] = useState<StaffLookupRow[]>([]);
  const [selected, setSelected] = useState<StaffLookupRow | null>(null);
  const [role, setRole] = useState<StaffRole>("moderator");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await listStaff();
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      setRows([]);
    } else {
      setError(null);
      setRows(data);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // Founder claim is silent. Fail-soft if the RPC is not applied yet.
      await claimFounder();
      const ok = await isStaffAtLeast("admin");
      setAllowed(ok);
      setChecking(false);
      if (ok) await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!allowed) return;
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      setLookupBusy(false);
      return;
    }
    setLookupBusy(true);
    const tm = setTimeout(() => {
      void (async () => {
        const { data, error: err } = await lookupStaffCandidates(q);
        setLookupBusy(false);
        if (err) {
          setError(t("ops.staff.lookupError"));
          setCandidates([]);
          return;
        }
        setCandidates(data.filter((r) => r.id));
      })();
    }, 250);
    return () => clearTimeout(tm);
  }, [allowed, query, t]);

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    if (!selected?.id) return;
    setBusy(true);
    setError(null);
    const { error: err } = await grantStaff(selected.id, role, note.trim() || null);
    setBusy(false);
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    setNotice(t("ops.staff.grantedNotice"));
    setSelected(null);
    setQuery("");
    setCandidates([]);
    setNote("");
    await refresh();
  }

  async function handleRevoke() {
    if (!revokeId) return;
    setBusy(true);
    const { error: err } = await revokeStaff(revokeId);
    setBusy(false);
    setRevokeId(null);
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    setNotice(t("ops.staff.revokedNotice"));
    await refresh();
  }

  if (checking) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-500">
        {t("common.loading")}
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href="/my/ops"
          className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
        >
          ← {t("common.back")}
        </Link>
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">
          {t("ops.staff.title")}
        </h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {t("ops.staff.noAccess")}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/my/ops"
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {t("common.back")}
      </Link>
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">
        {t("ops.staff.title")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500">{t("ops.staff.lead")}</p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}

      <form
        onSubmit={(e) => void handleGrant(e)}
        className="mb-6 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4"
      >
        <p className="text-sm font-medium text-zinc-800">{t("ops.staff.grant")}</p>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-600">
            {t("ops.staff.searchLabel")}
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder={t("ops.staff.searchPlaceholder")}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            autoComplete="off"
          />
        </label>
        {lookupBusy && (
          <p className="text-xs text-zinc-500">{t("common.loading")}</p>
        )}
        {!selected && candidates.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded border border-zinc-200 bg-white text-sm">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(p);
                    setQuery("");
                    setCandidates([]);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                >
                  <span className="font-medium text-zinc-800">
                    {personLabel(p)}
                  </span>
                  {p.email && (
                    <span className="ml-2 truncate text-[11px] text-zinc-400">
                      {p.email}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <p className="text-sm text-zinc-700">
            {t("ops.staff.selectedPerson")}:{" "}
            <span className="font-medium">{personLabel(selected)}</span>
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-600">
            {t("ops.staff.role")}
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`ops.staff.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-600">
            {t("ops.staff.note")}
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !selected}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {t("ops.staff.grant")}
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2">{t("ops.staff.username")}</th>
              <th className="px-3 py-2">{t("ops.staff.role")}</th>
              <th className="px-3 py-2">{t("ops.staff.note")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.profile_id}>
                <td className="px-3 py-2">
                  <p className="font-medium text-zinc-800">
                    {r.display_name || r.username || "—"}
                  </p>
                  {r.username && (
                    <p className="text-[11px] text-zinc-400">@{r.username}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-700">
                  {t(`ops.staff.role.${r.role}`)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {r.note ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setRevokeId(r.profile_id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    {t("ops.staff.revoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmActionDialog
        open={!!revokeId}
        title={t("ops.staff.revokeConfirmTitle")}
        description={t("ops.staff.revokeConfirmDesc")}
        confirmLabel={t("ops.staff.revoke")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        busy={busy}
        onConfirm={() => void handleRevoke()}
        onCancel={() => (busy ? null : setRevokeId(null))}
      />
    </main>
  );
}

export default function OpsStaffPage() {
  return (
    <AuthGate>
      <StaffContent />
    </AuthGate>
  );
}

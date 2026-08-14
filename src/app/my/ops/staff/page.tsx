"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { useT } from "@/lib/i18n/useT";
import {
  STAFF_ROLES,
  grantStaff,
  isStaffAtLeast,
  listStaff,
  revokeStaff,
  type StaffRole,
  type StaffRow,
} from "@/lib/ops/staff";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function StaffContent() {
  const { t } = useT();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("");
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
      const ok = await isStaffAtLeast("admin");
      setAllowed(ok);
      setChecking(false);
      if (ok) await refresh();
    })();
  }, [refresh]);

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    const id = profileId.trim();
    if (!UUID_RE.test(id)) {
      setError(t("ops.staff.invalidUuid"));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await grantStaff(id, role, note.trim() || null);
    setBusy(false);
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    setNotice(t("ops.staff.grantedNotice"));
    setProfileId("");
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

      {rows.length === 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">{t("ops.staff.firstAdminTitle")}</p>
          <p className="mt-1 text-amber-900">{t("ops.staff.firstAdminHint")}</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white px-3 py-2 text-[11px] text-zinc-700">
            {`insert into platform_admins (profile_id, role, note)\nvalues ('<uuid>', 'admin', 'founder');`}
          </pre>
        </div>
      )}

      <form
        onSubmit={(e) => void handleGrant(e)}
        className="mb-6 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4"
      >
        <p className="text-sm font-medium text-zinc-800">{t("ops.staff.grant")}</p>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-600">
            {t("ops.staff.profileId")}
          </span>
          <input
            type="text"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
        </label>
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
          disabled={busy || !profileId.trim()}
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
                  <p className="font-mono text-[10px] text-zinc-400">
                    {r.profile_id}
                  </p>
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

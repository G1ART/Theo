"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { FilterChip } from "@/components/ds/FilterChip";
import { useT } from "@/lib/i18n/useT";
import { isStaffAtLeast } from "@/lib/ops/staff";
import {
  approveTheoBoardPost,
  displaySummary,
  listTheoBoardQueue,
  rejectTheoBoardPost,
  type TheoBoardPost,
  type TheoBoardQueueStatus,
} from "@/lib/supabase/theoBoard";
import { TheoBoardTypeChip } from "@/components/theo-board/TheoBoardTypeChip";
import { OpsBackLink } from "@/components/ops/OpsBackLink";

const TABS: TheoBoardQueueStatus[] = ["pending", "rejected", "approved"];

function BoardQueueContent() {
  const { t } = useT();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<TheoBoardQueueStatus>("pending");
  const [posts, setPosts] = useState<TheoBoardPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ok = await isStaffAtLeast("moderator");
      setAllowed(ok);
      setChecking(false);
    })();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await listTheoBoardQueue({ status: tab });
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      setPosts([]);
    } else {
      setError(null);
      setPosts(data);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
  }, [allowed, refresh]);

  async function handleApprove() {
    if (!approveId) return;
    setBusy(true);
    const { error: err } = await approveTheoBoardPost(approveId);
    setBusy(false);
    setApproveId(null);
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    setNotice(t("ops.board.approvedNotice"));
    await refresh();
  }

  async function handleReject() {
    if (!rejectId) return;
    const reason = rejectReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      setError(t("ops.board.invalidReason"));
      return;
    }
    setBusy(true);
    const { error: err } = await rejectTheoBoardPost(rejectId, reason);
    setBusy(false);
    setRejectId(null);
    setRejectReason("");
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    setNotice(t("ops.board.rejectedNotice"));
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
        <OpsBackLink />
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">
          {t("ops.board.title")}
        </h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {t("ops.board.noAccess")}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <OpsBackLink />
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">
        {t("ops.board.title")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500">{t("ops.board.lead")}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((ty) => (
          <FilterChip key={ty} active={tab === ty} onClick={() => setTab(ty)}>
            {t(`ops.board.tab.${ty}`)}
          </FilterChip>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          {t("ops.board.empty")}
        </div>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => {
            const author =
              post.author_display_name ||
              (post.author_username ? `@${post.author_username}` : post.author_id) ||
              "—";
            const preview = displaySummary(post);
            return (
              <li
                key={post.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TheoBoardTypeChip type={post.type} />
                  <span className="text-[11px] text-zinc-400">
                    {post.created_at?.slice(0, 10)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-zinc-900">{post.title}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("ops.board.author")}: {author}
                </p>
                {preview && (
                  <p className="mt-2 text-sm text-zinc-600">{preview}</p>
                )}
                {post.body_md && (
                  <p className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-zinc-500">
                    {post.body_md}
                  </p>
                )}
                {post.href && (
                  <a
                    href={post.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-zinc-700 underline decoration-zinc-300 underline-offset-2"
                  >
                    {post.href}
                  </a>
                )}
                {post.reject_reason && tab === "rejected" && (
                  <p className="mt-2 text-xs text-red-700">
                    {t("ops.board.rejectReason")}: {post.reject_reason}
                  </p>
                )}

                {tab === "pending" && (
                  <div className="mt-3">
                    {rejectId === post.id ? (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          maxLength={500}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder={t("ops.board.rejectReasonPlaceholder")}
                          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy || !rejectReason.trim()}
                            onClick={() => void handleReject()}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {t("ops.board.reject")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setRejectId(null);
                              setRejectReason("");
                            }}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setApproveId(post.id)}
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                        >
                          {t("ops.board.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectId(post.id);
                            setRejectReason("");
                          }}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                        >
                          {t("ops.board.reject")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmActionDialog
        open={!!approveId}
        title={t("ops.board.approveConfirmTitle")}
        description={t("ops.board.approveConfirmDesc")}
        confirmLabel={t("ops.board.approve")}
        cancelLabel={t("common.cancel")}
        tone="neutral"
        busy={busy}
        onConfirm={() => void handleApprove()}
        onCancel={() => (busy ? null : setApproveId(null))}
      />
    </main>
  );
}

export default function OpsBoardPage() {
  return (
    <AuthGate>
      <BoardQueueContent />
    </AuthGate>
  );
}

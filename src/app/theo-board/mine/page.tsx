"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { EmptyState } from "@/components/ds/EmptyState";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShell } from "@/components/ds/PageShell";
import { useT } from "@/lib/i18n/useT";
import {
  listMyTheoBoardPosts,
  theoBoardStatusChipClass,
  theoBoardStatusLabelKey,
  withdrawTheoBoardPost,
  type TheoBoardPost,
  type TheoBoardStatus,
} from "@/lib/supabase/theoBoard";
import { TheoBoardTypeChip } from "@/components/theo-board/TheoBoardTypeChip";

function statusOf(post: TheoBoardPost): TheoBoardStatus {
  if (
    post.status === "pending" ||
    post.status === "approved" ||
    post.status === "rejected" ||
    post.status === "withdrawn"
  ) {
    return post.status;
  }
  return post.published_at ? "approved" : "pending";
}

function MineContent() {
  const { t } = useT();
  const searchParams = useSearchParams();
  const submitted = searchParams.get("submitted") === "1";
  const [posts, setPosts] = useState<TheoBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await listMyTheoBoardPosts();
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      setPosts([]);
    } else {
      setError(null);
      setPosts(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleWithdraw() {
    if (!withdrawId) return;
    setBusy(true);
    const { error: err } = await withdrawTheoBoardPost(withdrawId);
    setBusy(false);
    setWithdrawId(null);
    if (err) {
      setError(String((err as { message?: string })?.message ?? err));
      return;
    }
    await refresh();
  }

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
        title={t("theoBoard.mine.title")}
        lead={t("theoBoard.mine.lead")}
        actions={
          <Link
            href="/theo-board/new"
            className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {t("theoBoard.submitCta")}
          </Link>
        }
      />

      {submitted && (
        <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {t("theoBoard.mine.submittedNotice")}
        </p>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      ) : posts.length === 0 ? (
        <EmptyState title={t("theoBoard.mine.empty")} size="sm" />
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => {
            const status = statusOf(post);
            return (
              <li
                key={post.id}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TheoBoardTypeChip type={post.type} />
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${theoBoardStatusChipClass(status)}`}
                  >
                    {t(theoBoardStatusLabelKey(status))}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-zinc-900">{post.title}</p>
                {post.summary && (
                  <p className="mt-1 text-xs text-zinc-500">{post.summary}</p>
                )}
                {status === "rejected" && post.reject_reason && (
                  <p className="mt-2 text-xs text-red-700">
                    {t("theoBoard.mine.rejectReason")}: {post.reject_reason}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {status === "pending" && (
                    <button
                      type="button"
                      onClick={() => setWithdrawId(post.id)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                    >
                      {t("theoBoard.mine.withdraw")}
                    </button>
                  )}
                  {status === "approved" && (
                    <Link
                      href={post.href || `/theo-board/${post.id}`}
                      {...(post.href
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                    >
                      {t("theoBoard.mine.viewPublic")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmActionDialog
        open={!!withdrawId}
        title={t("theoBoard.mine.withdrawConfirmTitle")}
        description={t("theoBoard.mine.withdrawConfirmDesc")}
        confirmLabel={t("theoBoard.mine.withdraw")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        busy={busy}
        onConfirm={() => void handleWithdraw()}
        onCancel={() => (busy ? null : setWithdrawId(null))}
      />
    </PageShell>
  );
}

export default function TheoBoardMinePage() {
  return (
    <AuthGate>
      <Suspense fallback={<p className="px-4 py-8 text-sm text-zinc-500">…</p>}>
        <MineContent />
      </Suspense>
    </AuthGate>
  );
}

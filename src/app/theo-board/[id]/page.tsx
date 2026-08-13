"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { useT } from "@/lib/i18n/useT";
import { SafeMd } from "@/lib/markdown/safeMd";
import {
  getTheoBoardPostById,
  type TheoBoardPost,
} from "@/lib/supabase/theoBoard";
import { TheoBoardPlaceholderRows, TheoBoardTypeChip } from "@/components/theo-board/TheoBoardTypeChip";

export default function TheoBoardDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { t, locale } = useT();
  const [post, setPost] = useState<TheoBoardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    getTheoBoardPostById(id).then(({ data, error }) => {
      if (!alive) return;
      setFailed(!!error);
      setPost(data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const dateLabel =
    post?.published_at &&
    new Date(post.published_at).toLocaleDateString(
      locale === "ko" ? "ko-KR" : "en-US",
      { year: "numeric", month: "short", day: "numeric" },
    );

  return (
    <PageShell variant="narrow">
      <Link
        href="/theo-board"
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {t("theoBoard.backToBoard")}
      </Link>

      {loading ? (
        <TheoBoardPlaceholderRows />
      ) : failed ? (
        <div>
          <p className="mb-3 text-sm text-zinc-500">
            {t("rail.theoBoard.placeholder")}
          </p>
          <TheoBoardPlaceholderRows />
        </div>
      ) : !post ? (
        <EmptyOrMissing />
      ) : (
        <article className="rounded-2xl border border-zinc-200 bg-white px-5 py-6 sm:px-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <TheoBoardTypeChip type={post.type} />
            {dateLabel && (
              <span className="text-[11px] text-zinc-400">
                {t("theoBoard.publishedAt")} · {dateLabel}
              </span>
            )}
          </div>
          <PageHeader
            variant="plain"
            title={post.title}
            lead={post.summary}
            density="tight"
            className="mb-4"
          />
          {post.href && (
            <p className="mb-4">
              <a
                href={post.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
              >
                {t("theoBoard.externalLink")}
              </a>
            </p>
          )}
          {post.body_md ? <SafeMd source={post.body_md} /> : null}
        </article>
      )}
    </PageShell>
  );
}

function EmptyOrMissing() {
  const { t } = useT();
  return (
    <p className="text-sm text-zinc-500">{t("theoBoard.empty")}</p>
  );
}

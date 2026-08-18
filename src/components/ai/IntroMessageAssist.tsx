"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { aiApi } from "@/lib/ai/browser";
import { markAiAccepted } from "@/lib/ai/accept";
import { copyToClipboard } from "./AiDraftPanel";
import { aiErrorKey } from "@/components/studio/intelligence/aiCardState";
import { follow as followUser } from "@/lib/supabase/follows";
import { sendConnectionMessage } from "@/lib/supabase/connectionMessages";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import type { IntroMessageDraftResult } from "@/lib/ai/types";
import type { IntroMessageInput } from "@/lib/ai/contexts";

type Props = {
  me: IntroMessageInput["me"];
  recipient: IntroMessageInput["recipient"] & { id?: string };
  /** Target profile id — required for the "Send" path. */
  recipientId?: string | null;
  /** Whether the sender currently follows the recipient. Drives which CTA label appears. */
  isFollowing?: boolean;
  /**
   * Incrementing signal from the parent that requests the sheet to open.
   * Used by `/people` so the Follow button can open the sheet after a
   * successful follow without routing through the local Draft button.
   */
  openSignal?: number;
  variant?: "button" | "inline";
  autoOpen?: boolean;
  /** Fires after a connection_message row is inserted. */
  onSent?: () => void;
  /** Fires after a follow insert — used so the parent can refresh isFollowing. */
  onFollowed?: () => void;
};

// ─── Icons ───────────────────────────────────────────────────────────────────

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2 9.5 9H2l6 4.4-2.3 7 6.3-4.5 6.3 4.5-2.3-7L22 9h-7.5Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ─── Draft item (selectable, editable, with copy button) ────────────────────
//
// When `selectable` is true (sheet variant) the card acts as a radio item:
//   - unselected → read-only preview, click anywhere to select
//   - selected   → inline <textarea> bound to the parent's edited value,
//                  so "보내기"/"복사" both use the live edited text.
// When `selectable` is false (inline variant, MatchmakerCard) the card is
// read-only and only the copy button interacts.

function DraftItem({
  text,
  onCopy,
  copyLabel,
  selected,
  onSelect,
  selectable,
  editable,
  onChange,
}: {
  text: string;
  onCopy: () => void;
  copyLabel: string;
  selected?: boolean;
  onSelect?: () => void;
  selectable?: boolean;
  editable?: boolean;
  onChange?: (next: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleCopy = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onCopy();
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2200);
  };

  const base =
    "relative rounded-xl border p-4 pr-[4.5rem] transition-colors text-left w-full";
  const stateClass = selected
    ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
    : "border-zinc-200 bg-white hover:border-zinc-300";

  const showEditor = Boolean(selectable && selected && editable);

  // When the card is acting as an editor we render a plain <div> instead
  // of a <button> so the textarea can receive focus and caret events
  // without the outer button hijacking them.
  const Wrapper = selectable && !showEditor ? "button" : "div";

  return (
    <Wrapper
      type={selectable && !showEditor ? "button" : undefined}
      onClick={selectable && !showEditor ? onSelect : undefined}
      className={`${base} ${stateClass}`}
      aria-pressed={selectable ? selected : undefined}
    >
      {selectable && (
        <span
          className={[
            "absolute left-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border",
            selected
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-300 bg-white text-transparent",
          ].join(" ")}
          aria-hidden="true"
        >
          <CheckIcon />
        </span>
      )}

      {showEditor ? (
        // CSS-grid mirror trick: the hidden <div> takes the intrinsic
        // height of the wrapped text, and the <textarea> occupies the
        // exact same grid cell. No scrollHeight measurement, no timing
        // race on mount — the editor always matches the full content.
        <div className="grid pl-6">
          <div
            aria-hidden="true"
            className="invisible col-start-1 row-start-1 text-sm leading-relaxed text-zinc-900 whitespace-pre-wrap break-words"
          >
            {text + "\u200B"}
          </div>
          <textarea
            value={text}
            onChange={(e) => onChange?.(e.target.value)}
            rows={1}
            spellCheck={false}
            className="col-start-1 row-start-1 block w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400"
            aria-label="소개 메시지 초안 편집"
          />
        </div>
      ) : (
        <p
          className={`text-sm leading-relaxed text-zinc-800 whitespace-pre-wrap ${selectable ? "pl-6" : ""}`}
        >
          {text}
        </p>
      )}

      <span
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCopy(e);
          }
        }}
        role="button"
        tabIndex={0}
        className={[
          "absolute right-3 top-3 flex cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
          copied
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700",
        ].join(" ")}
      >
        {copied ? <CheckIcon /> : null}
        {copied ? "복사됨" : copyLabel}
      </span>
    </Wrapper>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DraftSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 animate-pulse">
      <div className="h-3 bg-zinc-200 rounded w-full mb-2" />
      <div className="h-3 bg-zinc-200 rounded w-5/6 mb-2" />
      <div className="h-3 bg-zinc-200 rounded w-3/5" />
    </div>
  );
}

// ─── Send status UI (inline footer pill) ─────────────────────────────────────

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

// ─── Portal sheet ─────────────────────────────────────────────────────────────

/**
 * Entry mode determines the primary-intent framing of the sheet.
 *  - "message-first":  opened via the "Draft an intro" button. User's intent
 *                      is to write/send a message. Primary CTA is send-first
 *                      ("보내면서 팔로우하기" / "보내기").
 *  - "follow-first":   opened when the user clicked Follow but we intercepted
 *                      the click to propose "send + follow" first. The follow
 *                      has NOT been committed yet — the sheet is the review
 *                      surface. CTAs:
 *                        • primary   — "보내면서 팔로우하기" (send + follow)
 *                        • secondary — "메시지 없이 팔로우만" (follow only)
 *                        • X / Esc   — true cancel (no follow, no message)
 */
type EntryMode = "message-first" | "follow-first";

type SheetProps = {
  loading: boolean;
  result: IntroMessageDraftResult | null;
  recipientName: string | null | undefined;
  recipientId: string | null | undefined;
  isFollowing: boolean;
  entryMode: EntryMode;
  onRefresh: () => void;
  onClose: () => void;
  onSent?: () => void;
  onFollowed?: () => void;
};

function IntroSheet({
  loading,
  result,
  recipientName,
  recipientId,
  isFollowing,
  entryMode,
  onRefresh,
  onClose,
  onSent,
  onFollowed,
}: SheetProps) {
  const { t } = useT();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Per-draft user edits. Key is the draft index, value is the edited body.
  // An absent key means "use the original draft text as-is". Kept at the
  // sheet level (not per-DraftItem) so Send/Copy always read the live value.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sendState.kind !== "sending") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, sendState.kind]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const drafts = result?.drafts ?? [];
  const isDegraded = Boolean(result?.degraded);

  const errorKey = aiErrorKey(result ?? null);

  const hasError = isDegraded && drafts.length === 0 && Boolean(errorKey);

  // Derived effective selection: we default to index 0 when the user has
  // not explicitly chosen yet so "one tap to send" is possible. Computing
  // this at render time (instead of via an effect) avoids cascading
  // renders flagged by `react-hooks/set-state-in-effect`.
  const effectiveSelectedIdx =
    selectedIdx !== null && selectedIdx < drafts.length
      ? selectedIdx
      : drafts.length > 0
        ? 0
        : null;

  // Resolve the live text for a given draft index — user edits take
  // precedence over the AI-generated original.
  const textAt = (i: number) => edits[i] ?? drafts[i] ?? "";

  const selectedText =
    effectiveSelectedIdx !== null ? textAt(effectiveSelectedIdx).trim() : "";

  const canSend =
    Boolean(recipientId) &&
    effectiveSelectedIdx !== null &&
    selectedText.length > 0 &&
    !loading;
  // CTA label is driven by two orthogonal axes:
  //   • entryMode: which verb comes first ("send" or "follow")
  //   • isFollowing: whether the follow action is still pending
  //
  // message-first (user came here to write a message):
  //   - already following → "보내기"
  //   - not following yet → "보내면서 팔로우하기" (send verb leads)
  // follow-first (post-follow prompt, already followed by design):
  //   - always following at this point → "보내기"
  //   - (fallback if somehow not following → "팔로우하며 보내기")
  const sendLabel = isFollowing
    ? t("connection.sendOnly")
    : entryMode === "message-first"
      ? t("connection.sendAndFollow")
      : t("connection.sendCta");

  const handleSend = async () => {
    if (!recipientId || effectiveSelectedIdx === null) return;
    const text = textAt(effectiveSelectedIdx).trim();
    if (!text) return;
    setSendState({ kind: "sending" });

    // 1. Follow if needed. Failure here should not block the message send —
    // the user's clear intent is "send this note". We surface the error but
    // still try the message.
    if (!isFollowing) {
      const { error: followErr } = await followUser(recipientId);
      if (!followErr) {
        logBetaEventSync("profile_followed", { profile_id: recipientId });
        onFollowed?.();
      }
    }

    // 2. Send the message.
    const { error } = await sendConnectionMessage(recipientId, text);
    if (error) {
      setSendState({
        kind: "error",
        message: t("connection.sendError"),
      });
      return;
    }

    markAiAccepted(result?.aiEventId, {
      feature: "intro_message_draft",
      via: "send",
    });
    logBetaEventSync("connection_message_sent", { recipient_id: recipientId });

    setSendState({ kind: "sent" });
    onSent?.();
    const tid = setTimeout(() => {
      onClose();
    }, 1500);
    return () => clearTimeout(tid);
  };

  // Follow-only path (follow-first entry). Commits the follow without
  // sending any message, then closes. Used when the user reviews the
  // AI-suggested draft but decides not to send it.
  const handleFollowOnly = async () => {
    if (!recipientId || isFollowing) {
      onClose();
      return;
    }
    setSendState({ kind: "sending" });
    const { error } = await followUser(recipientId);
    if (error) {
      setSendState({ kind: "error", message: t("connection.sendError") });
      return;
    }
    logBetaEventSync("profile_followed", { profile_id: recipientId });
    onFollowed?.();
    setSendState({ kind: "idle" });
    onClose();
  };

  const sending = sendState.kind === "sending";
  const sent = sendState.kind === "sent";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px] animate-sheet-backdrop"
        onClick={sending ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ai.intro.panel.title")}
        className="relative z-10 w-full md:w-[480px] md:max-w-[90vw] flex flex-col bg-white rounded-t-3xl md:rounded-2xl shadow-2xl max-h-[82vh] md:max-h-[70vh] animate-sheet-slide-up md:[animation-name:sheet-fade-scale]"
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-200 md:hidden" />

        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
              <SparkleIcon />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-zinc-900 leading-tight">
                  {entryMode === "follow-first"
                    ? t("connection.postFollow.title")
                    : t("ai.intro.panel.title")}
                </p>
              </div>
              {recipientName && (
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {recipientName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="ml-2 shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors disabled:opacity-40"
            aria-label="닫기"
          >
            <XIcon />
          </button>
        </div>

        <p className="px-5 pb-3 text-xs text-zinc-400">
          {entryMode === "follow-first"
            ? t("connection.postFollow.body")
            : t("ai.intro.panel.hint")}
        </p>

        <div className="h-px bg-zinc-100" />

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {loading && (
            <>
              <DraftSkeleton />
              <DraftSkeleton />
            </>
          )}

          {!loading && hasError && errorKey && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-zinc-600">{t(errorKey)}</p>
            </div>
          )}

          {!loading && !hasError && drafts.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-400">
              {t("ai.state.empty")}
            </p>
          )}

          {!loading &&
            drafts.map((_draft, i) => {
              const live = textAt(i);
              return (
                <DraftItem
                  key={i}
                  text={live}
                  copyLabel={t("ai.action.copy")}
                  selectable={Boolean(recipientId)}
                  selected={effectiveSelectedIdx === i}
                  editable={Boolean(recipientId)}
                  onSelect={() => setSelectedIdx(i)}
                  onChange={(next) =>
                    setEdits((prev) => ({ ...prev, [i]: next }))
                  }
                  onCopy={() => {
                    copyToClipboard(live);
                    markAiAccepted(result?.aiEventId, {
                      feature: "intro_message_draft",
                      via: "copy",
                    });
                  }}
                />
              );
            })}
        </div>

        <div className="border-t border-zinc-100 px-5 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setEdits({});
              setSelectedIdx(null);
              onRefresh();
            }}
            disabled={loading || sending}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 transition-colors disabled:opacity-40"
          >
            <RefreshIcon />
            {t("ai.action.refresh")}
          </button>

          {recipientId ? (
            <div className="flex shrink-0 items-center gap-2">
              {entryMode === "follow-first" && !sent && !isFollowing && (
                <button
                  type="button"
                  onClick={handleFollowOnly}
                  disabled={sending}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors disabled:opacity-40"
                >
                  {t("connection.followOnly")}
                </button>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend || sending || sent}
                className={[
                  "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors",
                  sent
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-900 text-white hover:bg-zinc-800",
                  (!canSend || sending) && !sent ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {sent ? (
                  <>
                    <CheckIcon />
                    {t("connection.sent")}
                  </>
                ) : sending ? (
                  t("connection.sending")
                ) : (
                  <>
                    <SendIcon />
                    {sendLabel}
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-400 leading-tight max-w-[220px]">
              AI 생성 초안 · 전송 전 내용을 꼭 확인해 주세요.
            </p>
          )}
        </div>

        {sendState.kind === "error" && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
            {sendState.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline variant (used in MatchmakerCard with autoOpen) ───────────────────

function InlineDraftView({
  loading,
  result,
  onRefresh,
}: {
  loading: boolean;
  result: IntroMessageDraftResult | null;
  onRefresh: () => void;
}) {
  const { t } = useT();

  const drafts = result?.drafts ?? [];

  const errorKey = aiErrorKey(result ?? null);

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50/70">
        <SparkleIcon className="text-zinc-500" />
        <p className="text-xs font-medium text-zinc-600">{t("ai.intro.panel.title")}</p>
      </div>

      <div className="p-3 space-y-2">
        {loading && (
          <>
            <DraftSkeleton />
            <DraftSkeleton />
          </>
        )}

        {!loading && errorKey && (
          <p className="py-3 text-center text-xs text-zinc-500">{t(errorKey)}</p>
        )}

        {!loading &&
          !errorKey &&
          drafts.map((draft, i) => (
            <DraftItem
              key={i}
              text={draft}
              copyLabel={t("ai.action.copy")}
              onCopy={() => {
                copyToClipboard(draft);
                markAiAccepted(result?.aiEventId, {
                  feature: "intro_message_draft",
                  via: "copy",
                });
              }}
            />
          ))}
      </div>

      <div className="px-3 pb-3 flex justify-end">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 transition-colors disabled:opacity-40"
        >
          <RefreshIcon />
          {t("ai.action.refresh")}
        </button>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function IntroMessageAssist({
  me,
  recipient,
  recipientId,
  isFollowing = false,
  openSignal,
  variant = "button",
  autoOpen = false,
  onSent,
  onFollowed,
}: Props) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(autoOpen);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntroMessageDraftResult | null>(null);
  const [mounted, setMounted] = useState(false);
  // Tracks which entry path opened the sheet so the CTA framing matches
  // user intent. See EntryMode docs on the SheetProps type.
  const [entryMode, setEntryMode] = useState<EntryMode>("message-first");
  const lastOpenSignal = useRef<number | undefined>(openSignal);

  useEffect(() => {
    setMounted(true);
  }, []);

  const trigger = useCallback(async () => {
    setLoading(true);
    setResult(null);
    const res = await aiApi.introMessageDraft({ intro: { me, recipient, locale } });
    setResult(res);
    setLoading(false);
  }, [me, recipient, locale]);

  useEffect(() => {
    if (autoOpen) {
      void trigger();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to an incrementing `openSignal` from the parent — used by the
  // post-follow affordance so it can open the sheet without us exposing a
  // ref. Opens in "follow-first" mode because the parent only increments
  // the signal after a successful follow.
  useEffect(() => {
    if (openSignal === undefined) return;
    if (lastOpenSignal.current === openSignal) return;
    lastOpenSignal.current = openSignal;
    if (variant !== "button") return;
    setEntryMode("follow-first");
    setOpen(true);
    void trigger();
  }, [openSignal, variant, trigger]);

  const close = useCallback(() => {
    setOpen(false);
    setResult(null);
  }, []);

  if (variant === "inline") {
    return (
      <InlineDraftView loading={loading} result={result} onRefresh={trigger} />
    );
  }

  const recipientRow = recipient as {
    display_name?: string | null;
    display_name_ko?: string | null;
    display_name_en?: string | null;
    username?: string | null;
  };
  const localizedDisplayName =
    formatDisplayName(recipientRow, t, locale);
  const legacyDisplayName =
    typeof recipientRow.display_name === "string"
      ? recipientRow.display_name
      : null;
  const displayName = localizedDisplayName || legacyDisplayName;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setEntryMode("message-first");
          setOpen(true);
          void trigger();
        }}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 transition-colors"
        title={t("ai.disclosure.tooltip")}
      >
        <SparkleIcon className="text-zinc-400" />
        {t("ai.intro.draftCta")}
      </button>

      {open && mounted &&
        createPortal(
          <IntroSheet
            loading={loading}
            result={result}
            recipientName={displayName}
            recipientId={recipientId ?? null}
            isFollowing={isFollowing}
            entryMode={entryMode}
            onRefresh={trigger}
            onClose={close}
            onSent={onSent}
            onFollowed={onFollowed}
          />,
          document.body,
        )}
    </>
  );
}

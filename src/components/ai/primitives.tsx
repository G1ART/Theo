"use client";

/**
 * Theo AI Surface primitives — single-file, low-ceremony building
 * blocks shared across every AI panel/card so the studio feels like one
 * coherent product system. Designed per
 * `Abstract_AI_Layer_UX_Design_Unification_2026-04-27.md` §4.
 *
 * Design intent (read before editing):
 * - Visual language is muted, editorial, premium. No neon AI styling,
 *   no chatbox UI, no robot/sparkle iconography.
 * - All copy is humble: 초안 / 제안 / 검토 / 다음에 할 일 — never 정답 /
 *   최적 / AI가 판단.
 * - AI never auto-acts. Copy / link / dismiss / regenerate only.
 * - Telemetry (`markAiAccepted`) is best-effort and never blocks UX.
 * - Primitives are deliberately small. Resist adding props; if a panel
 *   needs something custom, render markup directly inside `AiSurfaceFrame`
 *   instead of bloating the API.
 */

import { useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { aiErrorKey } from "@/components/studio/intelligence/aiCardState";
import { copyToClipboard } from "@/components/ai/AiDraftPanel";
import { markAiAccepted } from "@/lib/ai/accept";
import type { AiDegradation, AiFeatureKey } from "@/lib/ai/types";

// --------------------------------------------------------------------
// AiSurfaceFrame — common collapsible frame
// --------------------------------------------------------------------

type AiSurfaceFrameProps = {
  /**
   * Render-prop body. Receives `open` so the consumer can decide what
   * to render in the collapsed vs expanded state. The frame owns the
   * disclosure chevron and outer chrome.
   */
  children: (open: boolean) => ReactNode;
  /** Title shown in the always-visible header row. */
  title: string;
  /** Optional one-line subtitle directly under the title. */
  subtitle?: string;
  /** Optional small uppercase eyebrow above the title (use sparingly). */
  eyebrow?: string;
  /**
   * Force the initial collapsed/open state. Default false to keep AI
   * surfaces below-the-fold by default per UX density rules (§3.1).
   */
  defaultOpen?: boolean;
  /**
   * Render the frame as a denser variant (used inside dialog/drawer).
   * Compact removes the gradient and tightens padding.
   */
  compact?: boolean;
  className?: string;
};

export function AiSurfaceFrame({
  children,
  title,
  subtitle,
  eyebrow,
  defaultOpen = false,
  compact = false,
  className,
}: AiSurfaceFrameProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={[
        "rounded-xl border border-zinc-200",
        compact ? "bg-white p-3" : "bg-gradient-to-b from-white to-zinc-50/60 p-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              {eyebrow}
            </p>
          )}
          <p className="text-sm font-medium text-zinc-900">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
        </div>
        <span
          className="shrink-0 text-xs text-zinc-500"
          aria-hidden="true"
        >
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="mt-3 space-y-3">{children(open)}</div>}
    </section>
  );
}

// --------------------------------------------------------------------
// AiStateBlock — loading / error / empty / degraded notices
// --------------------------------------------------------------------

type AiStateBlockProps = {
  loading?: boolean;
  /** AI response (may be degraded). */
  result?: AiDegradation | null;
  /**
   * Optional override message key for the error state. When a route
   * returns degraded with a deterministic fallback body, callers may
   * prefer a softer "showing offline checklist" line instead of the
   * generic error copy.
   */
  degradedKey?: MessageKey;
  /**
   * When true and there is no error / loading, render nothing so the
   * caller can render its own empty content instead. Default true.
   */
  silentWhenIdle?: boolean;
  /**
   * Custom empty state. Rendered only if no error/loading and the
   * caller passes `isEmpty=true`.
   */
  isEmpty?: boolean;
  emptyKey?: MessageKey;
};

export function AiStateBlock({
  loading,
  result,
  degradedKey,
  silentWhenIdle = true,
  isEmpty,
  emptyKey,
}: AiStateBlockProps) {
  const { t } = useT();

  if (loading) {
    return <p className="text-xs text-zinc-500">{t("ai.common.loading")}</p>;
  }

  const errorKey = aiErrorKey(result ?? null);
  if (errorKey) {
    // Soften when caller signals a deterministic fallback body is also
    // being rendered alongside this notice.
    const key = degradedKey ?? errorKey;
    return (
      <p className="text-xs text-amber-700" role="alert">
        {t(key)}
      </p>
    );
  }

  if (isEmpty) {
    return (
      <p className="text-xs text-zinc-500">
        {t(emptyKey ?? "ai.common.empty")}
      </p>
    );
  }

  if (silentWhenIdle) return null;
  return null;
}

// --------------------------------------------------------------------
// AiCopyButton — copy text + mark accepted (best-effort telemetry)
// --------------------------------------------------------------------

type AiCopyButtonProps = {
  text: string;
  feature: AiFeatureKey;
  aiEventId?: string | null;
  /** Free-form metadata recorded with `markAiAccepted` for analytics. */
  meta?: Record<string, unknown>;
  /**
   * Optional surface label. Defaults to `ai.common.copy`. Caller-supplied
   * keys must be valid MessageKey entries.
   */
  labelKey?: MessageKey;
  copiedLabelKey?: MessageKey;
  /** Visual size. Default "sm". */
  size?: "sm" | "md";
  /** Visual variant. Default "outline". */
  variant?: "outline" | "ghost";
  className?: string;
};

export function AiCopyButton({
  text,
  feature,
  aiEventId,
  meta,
  labelKey = "ai.common.copy",
  copiedLabelKey = "ai.common.copied",
  size = "sm",
  variant = "outline",
  className,
}: AiCopyButtonProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const onClick = () => {
    if (!text) return;
    copyToClipboard(text);
    setCopied(true);
    void markAiAccepted(aiEventId ?? null, {
      feature,
      via: "copy",
      ...(meta ?? {}),
    });
    setTimeout(() => setCopied(false), 1500);
  };

  const sizeCls =
    size === "md" ? "px-3 py-1.5 text-xs" : "px-2 py-0.5 text-[11px]";
  const variantCls =
    variant === "ghost"
      ? "border border-transparent text-zinc-600 hover:bg-zinc-100"
      : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!text}
      className={[
        "shrink-0 rounded font-medium transition-colors disabled:opacity-50",
        sizeCls,
        variantCls,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {copied ? t(copiedLabelKey) : t(labelKey)}
    </button>
  );
}

// --------------------------------------------------------------------
// AiResultSection — labeled subsection inside an AI panel
// --------------------------------------------------------------------

type AiResultSectionProps = {
  title: string;
  description?: string;
  /** When true the section is collapsible. Default false. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  /**
   * Renders the body inside a soft amber box (for warnings / missing
   * info checklists). Default false → neutral.
   */
  tone?: "neutral" | "warn";
};

export function AiResultSection({
  title,
  description,
  collapsible = false,
  defaultOpen = true,
  children,
  tone = "neutral",
}: AiResultSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const headerCls =
    tone === "warn"
      ? "text-[11px] font-medium uppercase tracking-wide text-amber-700"
      : "text-[11px] font-medium uppercase tracking-wide text-zinc-500";

  return (
    <div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mb-1 flex w-full items-center justify-between gap-2 text-left"
        >
          <span className={headerCls}>{title}</span>
          <span className="text-xs text-zinc-500" aria-hidden="true">
            {open ? "▲" : "▼"}
          </span>
        </button>
      ) : (
        <p className={`mb-1 ${headerCls}`}>{title}</p>
      )}
      {description && (
        <p className="mb-2 text-xs text-zinc-500">{description}</p>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}

// --------------------------------------------------------------------
// AiDisclosureNote — single-line humble disclosure
// --------------------------------------------------------------------

type AiDisclosureNoteProps = {
  /** Override key for the disclosure copy. Defaults to ai.common.disclosure. */
  messageKey?: MessageKey;
};

export function AiDisclosureNote({
  messageKey = "ai.common.disclosure",
}: AiDisclosureNoteProps = {}) {
  const { t } = useT();
  return <span className="text-[11px] text-zinc-500">{t(messageKey)}</span>;
}

// --------------------------------------------------------------------
// AiStatusChip — small label chip (severity / kind / state)
// --------------------------------------------------------------------

type AiStatusChipTone =
  | "neutral" // default — info / generic kind
  | "suggest" // soft blue — improvement suggestion
  | "warn" // soft amber — needs attention but not destructive
  | "ok" // calm green — complete / passed
  | "draft"; // zinc — generic "draft" label

type AiStatusChipProps = {
  label: string;
  tone?: AiStatusChipTone;
  className?: string;
};

const TONE_CLS: Record<AiStatusChipTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  suggest: "bg-blue-50 text-blue-700",
  warn: "bg-amber-50 text-amber-800",
  ok: "bg-emerald-50 text-emerald-700",
  draft: "bg-zinc-100 text-zinc-600",
};

export function AiStatusChip({
  label,
  tone = "neutral",
  className,
}: AiStatusChipProps) {
  return (
    <span
      className={[
        "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TONE_CLS[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </span>
  );
}

// --------------------------------------------------------------------
// Re-export for convenience: the canonical reason→i18n mapper.
// Callers can keep importing from primitives without remembering the
// studio/intelligence path. Internal source of truth stays in
// `aiCardState.ts` for backwards compatibility.
// --------------------------------------------------------------------

export { aiErrorKey } from "@/components/studio/intelligence/aiCardState";

"use client";

/**
 * ErrorBoundary
 * -------------
 * QA 2026-07-28 — Client-side error containment for AI surfaces and
 * exhibition-edit widgets. Prior to this component the whole page would
 * white-screen whenever a nested component threw (e.g. malformed AI
 * responses, transient supabase decode errors), because Next.js's default
 * `error.tsx` catches only route-level errors. This boundary keeps the
 * failure local: a small "다시 시도" card renders in place of the broken
 * subtree so the rest of the page (title fields, save button, dates) stays
 * usable.
 *
 * Design intent:
 * - Do NOT reset on prop changes. That would let a broken subtree flap
 *   on every rerender and drown out the retry button.
 * - Reset explicitly via the "retry" button; children get a chance to
 *   re-mount with a fresh key.
 * - Fallback copy is deliberately calm — never scary — because the AI
 *   assist is optional and a broken assist should not read as "the app
 *   is broken." See `docs/DESIGN.md` §5 (tone).
 * - Never log through non-console channels here; this is a defensive
 *   layer, not telemetry. Actual crash reporting belongs to route-level
 *   `error.tsx`.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type FallbackProps = {
  error: Error;
  reset: () => void;
};

type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * Custom fallback renderer. When omitted, an inline neutral error card
   * is rendered with a retry button labelled by `retryLabel`.
   */
  fallback?: (props: FallbackProps) => ReactNode;
  /** Retry button label. Defaults to the KO string when omitted. */
  retryLabel?: string;
  /** Short apology / status line above the retry button. */
  message?: string;
  /**
   * Optional hook so parents can log or emit telemetry when a subtree
   * fails. Called after React commits the fallback UI so it is safe to
   * be async.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary]", error, info);
    }
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        // ignore — telemetry hooks must never re-throw here or we'd
        // loop back into componentDidCatch on the next render.
      }
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }

    const retryLabel = this.props.retryLabel ?? "다시 시도";
    const message =
      this.props.message ??
      "이 영역에서 예기치 못한 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";

    return (
      <div
        role="alert"
        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        <p className="mb-2 leading-relaxed">{message}</p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded border border-amber-300 bg-white px-3 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
        >
          {retryLabel}
        </button>
      </div>
    );
  }
}

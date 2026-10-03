"use client";

import { useCallback, useEffect, useState } from "react";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { logFeedEvent, type FeedSort, type FeedTab } from "@/lib/feed/telemetry";
import {
  follow,
  unfollow,
  cancelFollowRequest,
  type FollowStatus,
} from "@/lib/supabase/follows";
import { useT } from "@/lib/i18n/useT";

/** Surface attribution for telemetry. See `LikeButton` for the same pattern. */
export type FollowSurface = "feed" | "profile" | "people_page" | "other";

type Props = {
  targetProfileId: string;
  /**
   * Initial relationship of the viewer toward the target.
   *   - "none"     → viewer is not following / no pending request
   *   - "pending"  → viewer has sent a request to a private account, awaiting approval
   *   - "accepted" → viewer is following / mutual
   *
   * For backwards compatibility, callers may still pass `boolean` for
   * `initialFollowing` — this maps to `accepted` / `none`.
   */
  initialStatus?: FollowStatus;
  initialFollowing?: boolean;
  /**
   * When the target's `is_public = false`, clicking "Follow" sends a
   * follow REQUEST instead of an immediate follow. The button still uses
   * the same handler — the SQL RPC handles the public/private decision.
   */
  isPrivateTarget?: boolean;
  size?: "sm" | "md";
  /**
   * Fires after a follow becomes `accepted` (the only state that opens
   * the existing "send a note" sheet). Never fires for `pending` or for
   * the unfollow flow — preserves the legacy contract.
   */
  onFollowed?: () => void;
  /**
   * Opt-in: defer the follow insert to the parent. When provided, clicking
   * the (not-yet-following) button simply calls this handler instead of
   * executing `follow()`. The parent is then responsible for eventually
   * committing the follow (e.g. after a confirmation sheet) and updating
   * `initialStatus` / `initialFollowing`.
   *
   * Unfollow flow is untouched — hover-to-unfollow still works as before.
   * Pages that don't pass this prop keep the original "click → immediate
   * follow / request" behaviour.
   *
   * NOTE: `interceptFollow` only fires when the *would-be* action is a
   * direct follow against a public account. Pending requests and the
   * cancel-request path always go through `follow()` / `cancelFollowRequest()`
   * so the parent doesn't have to know about that branch.
   */
  interceptFollow?: () => void;
  /** Optional surface tag so telemetry can split feed-driven follows. */
  surface?: FollowSurface;
  /** Required when surface === "feed" so we can log feed-side context. */
  feedContext?: {
    tab: FeedTab;
    sort?: FeedSort;
    position: number;
  };
  /** Feed artist card uses an outline, full-width control. Defaults keep every other surface solid. */
  appearance?: "solid" | "outline";
  block?: boolean;
  /** Replaces the idle follow label. Pending and following labels stay the product copy. */
  idleLabel?: string;
};

function getIsTouch(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(hover: none)").matches ||
    "ontouchstart" in window
  );
}

function deriveInitialStatus(
  initialStatus: FollowStatus | undefined,
  initialFollowing: boolean | undefined
): FollowStatus {
  if (initialStatus) return initialStatus;
  if (initialFollowing) return "accepted";
  return "none";
}

export function FollowButton({
  targetProfileId,
  initialStatus,
  initialFollowing,
  isPrivateTarget = false,
  size = "md",
  onFollowed,
  interceptFollow,
  surface,
  feedContext,
  appearance = "solid",
  block = false,
  idleLabel,
}: Props) {
  const { t } = useT();
  const [status, setStatus] = useState<FollowStatus>(() =>
    deriveInitialStatus(initialStatus, initialFollowing)
  );
  const [hovered, setHovered] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch(getIsTouch());
  }, []);

  useEffect(() => {
    setStatus(deriveInitialStatus(initialStatus, initialFollowing));
  }, [initialStatus, initialFollowing]);

  const handleClick = useCallback(async () => {
    if (status === "none") {
      // Parent intercept → defer to parent regardless of target privacy.
      // Originally only public targets honored intercept (private targets
      // skipped the intro sheet to avoid wasting drafts on a recipient
      // who hadn't accepted yet). Beta QA found that visitors arriving
      // at a private profile *do* want to attach a note to their follow
      // request — the principal then has more context when reviewing
      // the request in their inbox. Parents that still want the
      // legacy "no sheet for private" behaviour just pass
      // `interceptFollow={undefined}` for private rows.
      if (interceptFollow) {
        interceptFollow();
        return;
      }
      const previous = status;
      setStatus(isPrivateTarget ? "pending" : "accepted");
      const { data: nextStatus, error } = await follow(targetProfileId);
      if (error) {
        setStatus(previous);
        return;
      }
      const resolved: FollowStatus = nextStatus ?? "accepted";
      setStatus(resolved);
      if (resolved === "accepted") {
        logBetaEventSync("profile_followed", {
          profile_id: targetProfileId,
          surface: surface ?? "other",
        });
        if (surface === "feed" && feedContext) {
          logFeedEvent("feed_item_follow", {
            tab: feedContext.tab,
            sort: feedContext.sort,
            item_kind: "people",
            item_id: targetProfileId,
            position: feedContext.position,
            action: "follow",
          });
        }
        onFollowed?.();
      } else {
        logBetaEventSync("profile_follow_requested", {
          profile_id: targetProfileId,
          surface: surface ?? "other",
        });
        if (surface === "feed" && feedContext) {
          logFeedEvent("feed_item_follow", {
            tab: feedContext.tab,
            sort: feedContext.sort,
            item_kind: "people",
            item_id: targetProfileId,
            position: feedContext.position,
            action: "follow_request",
          });
        }
      }
      return;
    }

    if (status === "pending") {
      const confirmMsg = t("follow.cancelRequest.confirm");
      if (!window.confirm(confirmMsg)) return;
      setStatus("none");
      const { error } = await cancelFollowRequest(targetProfileId);
      if (error) setStatus("pending");
      return;
    }

    // status === "accepted"
    if (isTouch) {
      if (window.confirm(t("follow.unfollow.confirm"))) {
        setStatus("none");
        await unfollow(targetProfileId);
      }
      return;
    }

    if (hovered) {
      if (window.confirm(t("follow.unfollow.confirm"))) {
        setStatus("none");
        await unfollow(targetProfileId);
      }
    }
  }, [
    status,
    isPrivateTarget,
    interceptFollow,
    targetProfileId,
    isTouch,
    hovered,
    onFollowed,
    surface,
    feedContext,
    t,
  ]);

  const label =
    status === "none"
      ? isPrivateTarget
        ? t("follow.cta.request")
        : idleLabel ?? t("follow.cta.follow")
      : status === "pending"
        ? t("follow.cta.requested")
        : isTouch
          ? t("follow.cta.following")
          : hovered
            ? t("follow.cta.unfollow")
            : t("follow.cta.following");

  const isUnfollowWarning = status === "accepted" && !isTouch && hovered;
  const isPendingPill = status === "pending";

  const sizeClasses = block
    ? "w-full px-3 py-2 text-sm font-normal"
    : size === "sm"
      ? "px-2 py-1 text-xs"
      : "px-3 py-1.5 text-sm";

  let toneClasses: string;
  if (isUnfollowWarning) {
    toneClasses =
      "border border-red-500 bg-transparent text-red-600 hover:bg-red-50";
  } else if (isPendingPill || appearance === "outline") {
    toneClasses =
      "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50";
  } else {
    toneClasses =
      "border border-zinc-300 bg-zinc-900 text-white hover:bg-zinc-800";
  }

  const radius = appearance === "outline" || block ? "rounded-sm" : "rounded";

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => !isTouch && setHovered(true)}
      onMouseLeave={() => !isTouch && setHovered(false)}
      className={`${radius} font-medium ${sizeClasses} ${toneClasses}`}
    >
      {label}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createAccessRequest } from "@/lib/supabase/relationshipAccess";
import type {
  AccessRequestType,
  VisibilitySubjectType,
} from "@/lib/visibility/types";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { logBetaEventSync } from "@/lib/beta/logEvent";

type Props = {
  open: boolean;
  onClose: () => void;
  ownerProfileId: string;
  subjectType: VisibilitySubjectType;
  subjectId: string | null;
  fieldKey: string;
  /** Default request type. Will still be selectable in the modal. */
  defaultRequestType?: AccessRequestType;
  /** Source surface (e.g. "artwork", "room") for analytics. */
  sourceSurface?: string | null;
};

const TYPE_OPTIONS: AccessRequestType[] = [
  "price_inquiry",
  "availability_request",
  "room_access",
  "vip_preview",
  "studio_note_access",
  "general_access",
];

function inferDefaultType(fieldKey: string): AccessRequestType {
  switch (fieldKey) {
    case "price":
      return "price_inquiry";
    case "availability":
      return "availability_request";
    case "studio_note":
    case "description":
      return "studio_note_access";
    case "room":
      return "room_access";
    default:
      return "general_access";
  }
}

export function AccessRequestModal({
  open,
  onClose,
  ownerProfileId,
  subjectType,
  subjectId,
  fieldKey,
  defaultRequestType,
  sourceSurface,
}: Props) {
  const { t } = useT();
  const [message, setMessage] = useState("");
  const [requestType, setRequestType] = useState<AccessRequestType>(
    defaultRequestType ?? inferDefaultType(fieldKey)
  );
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"success" | "error" | "duplicate" | null>(
    null
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) return;
    // Defer reset to the next frame to avoid the react-hooks
    // set-state-in-effect warning (cascading-render guard).
    const handle = requestAnimationFrame(() => {
      setMessage("");
      setStatusMessage(null);
      setStatusKind(null);
      setRequestType(defaultRequestType ?? inferDefaultType(fieldKey));
    });
    return () => cancelAnimationFrame(handle);
  }, [open, defaultRequestType, fieldKey]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setStatusMessage(null);
    setStatusKind(null);
    const { data, duplicate, error } = await createAccessRequest({
      ownerProfileId,
      subjectType,
      subjectId,
      fieldKey,
      requestType,
      message: message.trim() || null,
      sourceSurface: sourceSurface ?? null,
    });
    setSubmitting(false);
    if (error || !data) {
      setStatusKind("error");
      setStatusMessage(t("accessRequest.failed"));
      return;
    }
    // Telemetry — DO NOT include the message body. The work-order red line
    // (§15) and tests/privacy-token-audit guarantee this stays clean.
    logBetaEventSync("access_request_created", {
      subject_type: subjectType,
      subject_id: subjectId ?? undefined,
      field_key: fieldKey,
      request_type: requestType,
      surface: sourceSurface ?? undefined,
      status: data.status,
    });
    if (requestType === "room_access") {
      logBetaEventSync("room_access_requested", {
        subject_type: subjectType,
        subject_id: subjectId ?? undefined,
        field_key: fieldKey,
        request_type: requestType,
        surface: sourceSurface ?? undefined,
        status: data.status,
      });
    }
    if (requestType === "vip_preview") {
      logBetaEventSync("vip_access_requested", {
        subject_type: subjectType,
        subject_id: subjectId ?? undefined,
        field_key: fieldKey,
        request_type: requestType,
        surface: sourceSurface ?? undefined,
        status: data.status,
      });
    }
    // Sprint 5.2 — duplicate signal now comes from the RPC explicitly.
    // The previous timestamp-comparison heuristic was unreliable for
    // freshly-defaulted rows (created_at == updated_at).
    if (duplicate) {
      setStatusKind("duplicate");
      setStatusMessage(t("accessRequest.duplicatePending"));
      return;
    }
    setStatusKind("success");
    setStatusMessage(t("accessRequest.success"));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("accessRequest.title")}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("accessRequest.subtitle")}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs font-medium text-zinc-700">
            {t("visibility.requestMode.label")}
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as AccessRequestType)}
              disabled={submitting}
              className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(`accessRequest.requestType.${opt}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
            disabled={submitting}
            placeholder={t("accessRequest.messagePlaceholder")}
            rows={4}
            className="w-full rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400"
          />
          <div className="text-right text-[11px] text-zinc-400">
            {message.length}/1000
          </div>
        </div>

        {statusMessage && (
          <p
            className={[
              "mt-3 text-xs",
              statusKind === "error"
                ? "text-red-600"
                : statusKind === "duplicate"
                ? "text-amber-700"
                : "text-emerald-700",
            ].join(" ")}
          >
            {statusMessage}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {t("accessRequest.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {submitting ? t("common.loading") : t("accessRequest.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

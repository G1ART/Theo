"use client";

/**
 * Host/venue picker for exhibition create + edit.
 *
 * Feed credits prefer a linked host profile when present, otherwise the
 * typed host_name snapshot. Offering "my account" and previously used
 * names keeps those two sources from drifting (The GREEN vs The Green
 * Gallery).
 */

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  listMyHostVenueSuggestions,
  type HostVenueSuggestion,
} from "@/lib/supabase/exhibitions";

type Props = {
  forProfileId?: string | null;
  onPick: (suggestion: HostVenueSuggestion) => void;
};

export function HostVenueSuggest({ forProfileId, onPick }: Props) {
  const { t } = useT();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HostVenueSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMyHostVenueSuggestions({ forProfileId }).then(({ data }) => {
      if (!cancelled) setItems(data);
    });
    return () => {
      cancelled = true;
    };
  }, [forProfileId]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative mb-3">
      <p className="mb-1.5 text-xs text-zinc-500">{t("exhibition.hostSuggest.hint")}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-full border border-zinc-300 bg-white px-4 py-2 text-left text-sm text-zinc-700 hover:border-zinc-500"
      >
        <span>{t("exhibition.hostSuggest.placeholder")}</span>
        <span aria-hidden className="text-zinc-400">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-2xl border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.key} role="option">
              <button
                type="button"
                onClick={() => {
                  onPick(item);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-4 py-2 text-left hover:bg-zinc-50"
              >
                <span className="text-sm text-zinc-900">{item.label}</span>
                <span className="text-[11px] text-zinc-500">
                  {item.kind === "me"
                    ? t("exhibition.hostSuggest.me")
                    : t("exhibition.hostSuggest.prior")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

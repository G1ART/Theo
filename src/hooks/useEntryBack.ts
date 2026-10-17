"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  ENTRY_TRAIL_EVENT,
  armEntryReturn,
  backLabelKeyForPath,
  entryReturnRestores,
  resolveEntryPath,
} from "@/lib/nav/entryTrail";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(ENTRY_TRAIL_EVENT, onChange);
  return () => window.removeEventListener(ENTRY_TRAIL_EVENT, onChange);
}

export type EntryBack = {
  path: string;
  labelKey: MessageKey;
  /** True when `path` is where this screen was opened from, not the fallback. */
  fromEntry: boolean;
  linkProps: { scroll?: false; onClick?: () => void };
};

/**
 * Back target of the current screen: the screen it was opened from, with
 * its scroll; `fallback` only when there is none (opened by a link).
 */
export function useEntryBack(input: {
  fallback: string;
  skip?: (path: string) => boolean;
}): EntryBack {
  const pathname = usePathname() ?? "";
  const { fallback, skip } = input;
  const entry = useSyncExternalStore(
    subscribe,
    () => resolveEntryPath({ pathname, skip }),
    () => null,
  );
  const path = entry ?? fallback;
  const linkProps: EntryBack["linkProps"] = {};
  if (entry) {
    if (entryReturnRestores(entry)) linkProps.scroll = false;
    linkProps.onClick = () => armEntryReturn(entry);
  }
  return { path, labelKey: backLabelKeyForPath(path), fromEntry: entry != null, linkProps };
}

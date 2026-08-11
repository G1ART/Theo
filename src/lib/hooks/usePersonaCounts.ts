"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import {
  getPersonaCounts,
  type PersonaCounts,
} from "@/lib/supabase/personaCounts";

// Poll fallback in case the realtime channel is dropped or the table is
// not broadcasting for a given client. Cheap at our scale; realtime is
// still the primary signal.
const POLL_MS = 60_000;
// Coalesce bursts of profile changes into a single refetch.
const REFETCH_DEBOUNCE_MS = 700;

const EMPTY: PersonaCounts = {
  artist: 0,
  curator: 0,
  gallerist: 0,
  collector: 0,
};

/**
 * Shared live persona-slot counter.
 *
 * Wires up:
 *   • one-shot fetch on mount
 *   • realtime subscription on `profiles` (debounced refetch)
 *   • 60s polling fallback
 *   • window-focus refetch
 *
 * Each hook instance owns its own `persona-counts` channel; two
 * consumers on the same page double-subscribe intentionally — the
 * RPC is cheap and we favour local self-containment over global
 * dedupe during beta.
 */
export function usePersonaCounts(): {
  counts: PersonaCounts;
  ready: boolean;
} {
  const [counts, setCounts] = useState<PersonaCounts>(EMPTY);
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      const { data, error } = await getPersonaCounts();
      if (cancelled || error) return;
      setCounts(data);
      setReady(true);
    }

    function scheduleRefetch() {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void refetch();
      }, REFETCH_DEBOUNCE_MS);
    }

    void refetch();

    const channel: RealtimeChannel = supabase
      .channel("persona-counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => scheduleRefetch(),
      )
      .subscribe();

    const poll = window.setInterval(() => void refetch(), POLL_MS);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, []);

  return { counts, ready };
}

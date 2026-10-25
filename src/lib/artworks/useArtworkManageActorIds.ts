"use client";

import { useEffect, useState } from "react";
import { useActingAs } from "@/context/ActingAsContext";
import {
  actingProfileMayManageArtworks,
  artworkManageActorIds,
} from "@/lib/artworks/manageAccess";
import { getSession } from "@/lib/supabase/auth";
import { listMyDelegations } from "@/lib/supabase/delegations";

let cachedKey: string | null = null;
let cachedPromise: Promise<string[]> | null = null;

export function loadArtworkManageActorIds(
  actingAsProfileId: string | null,
): Promise<string[]> {
  const key = actingAsProfileId ?? "";
  if (cachedPromise && cachedKey === key) return cachedPromise;
  cachedKey = key;
  cachedPromise = (async () => {
    const {
      data: { session },
    } = await getSession();
    const sessionId = session?.user?.id ?? null;
    let actingMayManage = false;
    if (sessionId && actingAsProfileId && actingAsProfileId !== sessionId) {
      const { data } = await listMyDelegations();
      actingMayManage = actingProfileMayManageArtworks(
        data?.received ?? [],
        actingAsProfileId,
      );
    }
    return artworkManageActorIds({
      sessionUserId: sessionId,
      actingAsProfileId,
      actingMayManage,
    });
  })().catch(() => [] as string[]);
  return cachedPromise;
}

export function useArtworkManageActorIds(): { ids: string[]; ready: boolean } {
  const { actingAsProfileId } = useActingAs();
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void loadArtworkManageActorIds(actingAsProfileId).then((next) => {
      if (cancelled) return;
      setIds(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [actingAsProfileId]);

  return { ids, ready };
}

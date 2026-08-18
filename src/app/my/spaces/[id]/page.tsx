"use client";

/**
 * `/my/spaces/[id]` — Chunk C editor route.
 *
 * The brief calls for a server component that hydrates the space via
 * `getSpaceById(id)` and hands it to a client editor. In practice, the
 * rest of the `/my/*` tree in this codebase uses client components
 * with `AuthGate` because the shared Supabase client (`@/lib/supabase/
 * client.ts`) is browser-first — there is no cookie-backed server
 * client wired up, so an SSR read would run anonymously and RLS would
 * hide the row from its own owner.
 *
 * We follow the existing precedent (see `/my/shortlists/[id]`) and let
 * `SpaceEditor` fetch its own data client-side. `AuthGate` inside
 * `SpaceEditor` guards the auth precondition.
 */

import { useParams } from "next/navigation";
import { SpaceEditor } from "@/components/simulation/SpaceEditor";

export default function SpaceEditorRoute() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <SpaceEditor id={id} />;
}

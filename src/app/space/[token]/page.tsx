"use client";

/**
 * `/space/[token]` — Chunk C public share view (read-only).
 *
 * Renders the same `renderScene2D` output as the editor, without
 * interactivity or a sign-in prompt. The viewer sees just the room
 * photo + placed artworks + a discreet Theo credit footer.
 *
 * Loader:
 *   • Uses Chunk B's `getSpaceByShareToken`, which filters to
 *     `is_active = true` and unexpired share tokens, and projects
 *     public-only artwork columns (no pricing, ownership, or story).
 *
 * RLS caveat (flagged to parent):
 *   The current `spaces` RLS grant is `to authenticated` with
 *   `owner_id = auth.uid()`. Anonymous share-link viewers hit an
 *   empty result set. A follow-up migration must add a
 *   share-token-based read policy (or a SECURITY DEFINER RPC) for
 *   this route to work for anon. Until then the view still works
 *   for the owner (they see their own space via the same URL).
 *
 * Metadata:
 *   Next.js `metadata` / `generateMetadata` are server-only. This
 *   route intentionally ships as a client component to reuse the
 *   same client-side lib helpers as the editor. Metadata (og:title,
 *   og:image) can be added by promoting the page to a `layout.tsx`
 *   metadata export once the RLS story is resolved — noted in the
 *   report as a deferred item.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { getSpaceByShareToken, type SpaceScene } from "@/lib/supabase/spaces";
import { renderScene2D } from "@/lib/simulation/renderer2d";
import { spacePhotoUrl } from "@/components/simulation/spacePhotoUrl";

export default function SharedSpacePage() {
  const params = useParams();
  const { t, locale } = useT();
  const token = typeof params.token === "string" ? params.token : "";
  const [state, setState] = useState<SpaceScene | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageBox, setImageBox] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void getSpaceByShareToken(token, { locale }).then(({ data }) => {
      if (cancelled) return;
      setState(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, locale]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => {
      const r = img.getBoundingClientRect();
      setImageBox({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(img);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [state?.space.photoStoragePath]);

  const rendered = useMemo(() => {
    if (!state || imageBox.w === 0 || imageBox.h === 0) return [];
    return renderScene2D(state.space, imageBox, state.artworks);
  }, [state, imageBox]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-zinc-100" />
      </main>
    );
  }

  if (!state) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-zinc-700">
          {t("simulation.share.notFound")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-xs text-zinc-400 hover:text-zinc-600"
        >
          Theo
        </Link>
      </main>
    );
  }

  const { space } = state;
  const photoUrl = spacePhotoUrl(space.photoStoragePath);
  const title = space.title?.trim() || t("simulation.editor.titlePlaceholder");

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
      </header>
      <div className="relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={photoUrl}
            alt={title}
            className="block h-auto w-full"
            draggable={false}
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-xs text-zinc-400">
            {t("simulation.share.notFound")}
          </div>
        )}
        {/*
          Mirrors the editor's overlay style (P1 render-quality
          patch, 2026-08-19): `object-contain` + mounting shadow
          stack + hairline outline + top highlight so shared views
          also render with faithful aspect and a "hanging object"
          affordance, not the previous flat-sticker look.
        */}
        {rendered.map((rp) => (
          <div
            key={rp.placement.id}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: `${rp.css.widthPx}px`,
              height: `${rp.css.heightPx}px`,
              transformOrigin: "0 0",
              transform: rp.css.matrix3d,
              zIndex: rp.css.zIndex + 1,
              outline: "1px solid rgba(0,0,0,0.10)",
              boxShadow:
                "0 2px 6px rgba(0,0,0,0.18), 0 12px 28px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {rp.artwork.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rp.artwork.imageUrl}
                alt={rp.artwork.title}
                className="pointer-events-none h-full w-full select-none object-contain"
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>
      <footer className="mt-6 border-t border-zinc-100 pt-3 text-center text-xs text-zinc-400">
        <Link href="/" className="hover:text-zinc-700">
          {t("simulation.share.footer").replace("{title}", title)}
        </Link>
      </footer>
    </main>
  );
}

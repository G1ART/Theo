/**
 * Translucent size pill used on artwork thumbnails.
 * Same placement as the main-feed walk thumb: inside the image,
 * bottom-left, one line. Callers pass a label from
 * `formatArtworkSizeOverlay` and omit the pill when that is null.
 */
export function ArtworkSizeCapsule({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <span className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate whitespace-nowrap rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight text-zinc-800 shadow-sm backdrop-blur-sm sm:bottom-2 sm:left-2 sm:text-[11px]">
      {label}
    </span>
  );
}

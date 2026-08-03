import Image from "next/image";

/**
 * Theo brand mark (Aug-2026, from official brand guideline).
 *
 * The mark is a single continuous stroke: an arch on the left rising
 * from the baseline (representing the T + O merger) with a short vertical
 * accent at the peak, then a flowing wave extending outward to the right
 * (representing "새로운 발견 — 아직 발견되지 않은 예술가·작품·기회를 찾아가는
 * 능동적인 연결"), sitting above the lowercase "theo" wordmark.
 *
 * We ship the designer's rasterised asset (`/public/theo-logo.png`) rather
 * than a hand-traced SVG so the geometry matches the brand book pixel-for-
 * pixel. The white background has been alpha-processed into a transparency
 * ramp so the mark sits cleanly on any surface (sidebar, drawer, header).
 *
 * If we ever get an official SVG from the designer, swap the asset here
 * and every caller updates automatically.
 */
export function TheoLogo({
  className = "",
  priority = false,
}: {
  className?: string;
  /** Set `priority` on above-the-fold nav slots (Header, AppSidebar). */
  priority?: boolean;
}) {
  return (
    <Image
      src="/theo-logo.png"
      alt="Theo"
      width={984}
      height={675}
      priority={priority}
      className={className}
      // Canvas is tight-cropped (1.46:1) so callers set only the height
      // and let width flow.
      draggable={false}
    />
  );
}

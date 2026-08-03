/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Inline React SVG so we can use JSX attribute names and skip Next.js'
 * `next/image` SVG allowlist (which blocks unknown SVGs by default and
 * was surfacing as a broken "?" placeholder in the wireframe screenshots).
 *
 * The mark is a thin arch/tent silhouette sitting over the lowercase
 * `theo` wordmark from the wireframe. Everything strokes/fills with
 * `currentColor` so a parent element can flip the tone with a single
 * `color:` change (e.g. dark-mode wrapper).
 *
 * `viewBox` is 120x80. Use Tailwind height classes (`h-9`, `h-12`, …)
 * and `w-auto` on the caller to control size.
 */
export function TheoLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 80"
      role="img"
      aria-label="Theo"
      className={className}
      fill="none"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path
          d="M18 44 C 26 12, 44 8, 56 28 C 66 44, 84 42, 100 34"
          strokeWidth={2.6}
        />
        <path d="M56 30 L 56 44" strokeWidth={2.2} />
      </g>
      <text
        x={16}
        y={70}
        fontFamily="'SUIT','Geist','Helvetica Neue',Arial,sans-serif"
        fontSize={26}
        fontWeight={500}
        letterSpacing={0.5}
        fill="currentColor"
      >
        theo
      </text>
    </svg>
  );
}

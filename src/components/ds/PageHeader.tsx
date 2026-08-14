import type { ReactNode } from "react";

/**
 * Page-level header. Keeps the kicker / h1 / lead rhythm consistent
 * across surfaces so the salon tone reads as a *promise*, not as random
 * decoration.
 *
 * Two variants:
 *  - `editorial` — kicker (uppercase tracking-[0.22em] + 2px accent) +
 *    h1 + optional lead. Reserved for surfaces whose identity benefits
 *    from a category label (e.g. People). The kicker should appear at
 *    most ONCE per surface — child sections must use `SectionLabel`
 *    instead, not another kicker.
 *  - `plain` — h1 + optional lead. The default for surfaces whose
 *    identity is already obvious from navigation (Feed / Upload / My
 *    Studio / public profile).
 *
 * `actions` slot mounts inline with the title row (right-aligned),
 * used for tour help buttons or peripheral owner links.
 */

type Variant = "editorial" | "plain";

type Props = {
  variant?: Variant;
  title: string;
  /** Required when `variant="editorial"`, ignored otherwise. */
  kicker?: string;
  lead?: string | null;
  actions?: ReactNode;
  /** Default `mb-8`. Pass `tight` for `mb-6` when stacked above a chip rail. */
  density?: "default" | "tight";
  /** Used to wire `aria-labelledby` on the parent `<section>`/`<main>`. */
  titleId?: string;
  className?: string;
};

export function PageHeader({
  variant = "plain",
  title,
  kicker,
  lead,
  actions,
  density = "default",
  titleId,
  className,
}: Props) {
  const isEditorial = variant === "editorial" && kicker;
  const wrapperCls = [
    density === "tight" ? "mb-6" : "mb-8",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={wrapperCls}>
      {isEditorial ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-700">
              <span aria-hidden className="h-3 w-[2px] bg-zinc-900" />
              {kicker}
            </p>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>
          <h1
            id={titleId}
            className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900"
          >
            {title}
          </h1>
          {lead && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
              {lead}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1
              id={titleId}
              className="text-2xl font-semibold tracking-tight text-zinc-900"
            >
              {title}
            </h1>
            {lead && (
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-500">
                {lead}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:pt-1">
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

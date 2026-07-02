"use client";

import { useT } from "@/lib/i18n/useT";

export type ExploreTab = "foryou" | "artworks" | "artists" | "exhibitions" | "all";
type Sort = "latest" | "popular";

type Props = {
  tab: ExploreTab;
  sort: Sort;
  isSignedIn: boolean;
  onTabChange: (tab: ExploreTab) => void;
  onSortChange: (sort: Sort) => void;
  /**
   * When false the sort control row (New works / Resonating) is omitted.
   * Sort only makes sense on personalized/mixed surfaces (For you, All),
   * so type-filtered tabs (Artworks, Artists, Exhibitions) hide it.
   */
  showSortControls?: boolean;
};

const TAB_ORDER: ExploreTab[] = [
  "foryou",
  "artworks",
  "artists",
  "exhibitions",
  "all",
];

/**
 * Explore/Feed header. Matches the wireframe layout: a single left-aligned
 * cluster with "For you" followed by a spacer, then Artworks / Artists /
 * Exhibitions / All. "For you" requires sign-in — for anon visitors it
 * still renders but the click routes to /login (handled upstream in
 * FeedClient.handleTabChange).
 */
export function FeedHeader({
  tab,
  sort,
  isSignedIn,
  onTabChange,
  onSortChange,
  showSortControls = true,
}: Props) {
  const { t } = useT();

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {TAB_ORDER.map((key, idx) => {
          const active = tab === key;
          const isForYou = key === "foryou";
          const dimmed = isForYou && !isSignedIn;
          return (
            <div key={key} className="flex items-center">
              {idx === 1 && <span className="hidden pr-4 lg:inline" aria-hidden />}
              <button
                type="button"
                onClick={() => onTabChange(key)}
                aria-pressed={active}
                className={`transition-colors ${
                  active
                    ? "font-semibold text-zinc-900"
                    : dimmed
                      ? "text-zinc-300 hover:text-zinc-500"
                      : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {t(`feed.tab.${labelKey(key)}`)}
              </button>
            </div>
          );
        })}
      </div>

      {showSortControls && (
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-500">
          <SortButton
            active={sort === "latest"}
            onClick={() => onSortChange("latest")}
          >
            {t("feed.sortNewWorks")}
          </SortButton>
          <span aria-hidden className="text-zinc-300">·</span>
          <SortButton
            active={sort === "popular"}
            onClick={() => onSortChange("popular")}
          >
            {t("feed.sortResonating")}
          </SortButton>
        </div>
      )}
    </div>
  );
}

function labelKey(key: ExploreTab): string {
  switch (key) {
    case "foryou":
      return "forYou";
    case "artworks":
      return "artworks";
    case "artists":
      return "artists";
    case "exhibitions":
      return "exhibitions";
    case "all":
    default:
      return "all";
  }
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`transition-colors ${
        active
          ? "font-medium text-zinc-900"
          : "font-normal text-zinc-500 hover:text-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

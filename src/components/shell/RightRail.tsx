"use client";

import { MyConnectionRail } from "./rail/MyConnectionRail";
import { TheoBoardRail } from "./rail/TheoBoardRail";

/**
 * Default right rail (Aug-2026 wireframe redesign).
 *
 * Two stacked widgets:
 *   1. `MyConnectionRail` — search bar + Invitations + Suggestions.
 *   2. `TheoBoardRail`    — news/announcements placeholder.
 *
 * Per-page context rails (LibraryRail, ShortlistsRail, PeopleRail,
 * NetworkRail) still override this via `<AppShell rightRail={…}>`,
 * so this composition only ships on pages that opt into the default
 * (feed, workspace hub, notifications, settings, upload, artwork,
 * exhibitions, profiles).
 */
export function RightRail() {
  return (
    <div className="flex flex-col gap-8 py-8 pl-2">
      <MyConnectionRail />
      <TheoBoardRail />
    </div>
  );
}

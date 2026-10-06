import type { ArtworkImageViewType } from "@/lib/supabase/artworks";

/** Roles artists pick while registering. Existing view_type values, no new column. */
export const REGISTRATION_VIEW_ROLES: {
  value: ArtworkImageViewType;
  labelKey: string;
}[] = [
  { value: "wall_mounted", labelKey: "bulk.view.full" },
  { value: "in_situ", labelKey: "bulk.view.inSitu" },
  { value: "detail", labelKey: "bulk.view.detail" },
];

const KNOWN: ReadonlySet<string> = new Set([
  "wall_mounted",
  "detail",
  "angle",
  "in_situ",
  "other",
]);

/** Map a stored or picked role onto a real view_type. Unknown values become detail. */
export function extraViewType(value: string | null | undefined): ArtworkImageViewType {
  if (value && KNOWN.has(value)) return value as ArtworkImageViewType;
  return "detail";
}

export type RegistrationViewRole = "full" | "install" | "detail" | "other";

/** 전체 / 설치 / 디테일, plus the older angle and other tags. */
export function registrationViewRole(
  value: string | null | undefined,
): RegistrationViewRole {
  const view = extraViewType(value);
  if (view === "wall_mounted") return "full";
  if (view === "in_situ") return "install";
  if (view === "detail") return "detail";
  return "other";
}

/** Existing 전체 / 설치 / 디테일 labels. No new view type. */
export function registrationViewLabelKey(value: string | null | undefined): string {
  const view = extraViewType(value);
  if (view === "wall_mounted") return "bulk.view.full";
  if (view === "in_situ") return "bulk.view.inSitu";
  if (view === "detail") return "bulk.view.detail";
  if (view === "angle") return "bulk.view.angle";
  return "bulk.view.other";
}

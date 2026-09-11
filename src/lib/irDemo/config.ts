/**
 * IR demo is a separate Vercel Preview + Supabase preview branch.
 * Production must leave NEXT_PUBLIC_IR_DEMO unset/false.
 */

export const IR_DEMO_COOKIE = "theo_ir";

export function isIrDemo(): boolean {
  return process.env.NEXT_PUBLIC_IR_DEMO === "true";
}

export const IR_PERSONAS = [
  {
    key: "artist",
    profileId: "8b4dc6e1-d9f7-4ac9-a626-ef61566af657",
    username: "heimyunghyun",
    email: "ir-artist@theo.demo",
    home: "/u/heimyunghyun",
  },
  {
    key: "curator",
    profileId: "93f4f934-8296-40a0-9d3d-a3667ea2b71a",
    username: "thegreen_oc",
    email: "ir-curator@theo.demo",
    home: "/my/exhibitions",
  },
  {
    key: "collector",
    profileId: "d4b84e70-3b10-4da9-a6da-ad7830fc7519",
    username: "g1art_founder",
    email: "ir-collector@theo.demo",
    home: "/feed?tab=all&sort=latest",
  },
] as const;

export type IrPersonaKey = (typeof IR_PERSONAS)[number]["key"];

export function irPersona(key: string | null | undefined) {
  return IR_PERSONAS.find((p) => p.key === key) ?? null;
}

export const IR_PATH = "/ir";

/** Same-origin proxy so cloned DB paths can fall back to production blobs. */
export function irDemoAssetUrl(path: string, bucket = "artworks"): string {
  const q = new URLSearchParams({ p: path, b: bucket });
  return `/api/ir/asset?${q.toString()}`;
}

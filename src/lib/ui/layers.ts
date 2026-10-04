/**
 * One stacking scale for the shell. Low → high.
 *
 * A widget does not get its own z-index to climb over a neighbor.
 * Full-viewport layers are portaled to `document.body` (`BodyPortal`)
 * because the center column is `overflow-x: clip` and `z-0`: a
 * `fixed` descendant stays clipped to that column and paints under
 * the sidebar and the right rail.
 *
 *   content          center column
 *   badge            a dot on its own trigger. Local to that trigger.
 *                    Never a viewport layer — a dimmed sidebar keeps
 *                    its dot dimmed.
 *   chrome           left sidebar and right rail
 *   stickyBar        top header, back-to-top, notification catcher
 *   mobileNavScrim   dimmer under the open mobile menu
 *   menu             chrome panels: notification drawer, open mobile
 *                    sheet. An account menu that lives inside the
 *                    header stays inside that bar.
 *   scrim            full-viewport dimmer (modal, viewer, lightbox)
 *   dialog           a dialog painted as a sibling above its scrim
 *   toast            notices above dialogs
 *
 * When the dimmer and the dialog are one element, use `scrim`. The
 * dialog is a child of that element, so it stays bright on the dim
 * fill. Use `dialog` only when the panel is a sibling of the scrim
 * at the viewport.
 *
 * The enhance dialog is already portaled and spells the scrim class
 * literally (`z-[80]`). Keep `scrim` equal to that string.
 *
 * Tour coachmarks and the migration guard sit above this scale.
 */
export const layer = {
  content: "z-0",
  badge: "z-10",
  chrome: "z-30",
  stickyBar: "z-40",
  mobileNavScrim: "z-[45]",
  menu: "z-50",
  scrim: "z-[80]",
  dialog: "z-[90]",
  toast: "z-[100]",
} as const;

export type LayerName = keyof typeof layer;

/** Numeric stack level. Used by tests to keep the order honest. */
export function layerLevel(name: LayerName): number {
  const token = layer[name];
  const arbitrary = /^z-\[(\d+)\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  const plain = /^z-(\d+)$/.exec(token);
  if (plain) return Number(plain[1]);
  throw new Error(`unreadable layer token: ${name} ${token}`);
}

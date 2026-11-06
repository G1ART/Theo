/**
 * Where the desktop account card sits. It opens beside the account
 * row, inside the page, and does not navigate.
 */
export type AccountMenuAnchor = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function placeAccountMenu(
  anchor: AccountMenuAnchor,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  let left = anchor.right + margin;
  if (left + panel.width > viewport.width - margin) {
    left = Math.max(margin, anchor.left - panel.width - margin);
  }
  // Sit the card on the row, growing upward so a bottom-aligned
  // account line still shows the whole card.
  let top = anchor.bottom - panel.height;
  if (top < margin) top = margin;
  if (top + panel.height > viewport.height - margin) {
    top = Math.max(margin, viewport.height - panel.height - margin);
  }
  return { left, top };
}

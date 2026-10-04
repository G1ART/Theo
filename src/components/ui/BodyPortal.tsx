"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Paint `children` on `document.body`.
 *
 * The shell's center column clips and traps `position: fixed`
 * descendants, so a modal that stays in the column cannot cover the
 * sidebar or the right rail. Portaling out of that column is the
 * layer fix. The extra render happens in layout, before paint and
 * before the parent's passive effects, so a dialog can still focus
 * its button on open.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

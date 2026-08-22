/**
 * Upload 이미지 보정 wizard is on screen. The upload tour must not
 * sit on top of crop / lighting — and must not steal sidebar clicks.
 */

export const ENHANCE_WIZARD_EVENT = "theo:enhance-wizard";

const FLAG = "__theoEnhanceWizardActive";
const COUNT = "__theoEnhanceWizardCount";

type WizardWindow = Window & {
  [FLAG]?: boolean;
  [COUNT]?: number;
};

function win(): WizardWindow | null {
  if (typeof window === "undefined") return null;
  return window as WizardWindow;
}

export function isEnhanceWizardActive(): boolean {
  return win()?.[FLAG] === true;
}

export function setEnhanceWizardActive(active: boolean): void {
  const w = win();
  if (!w) return;
  const next = Math.max(0, (w[COUNT] ?? 0) + (active ? 1 : -1));
  w[COUNT] = next;
  const on = next > 0;
  w[FLAG] = on;
  w.dispatchEvent(
    new CustomEvent(ENHANCE_WIZARD_EVENT, { detail: { active: on } }),
  );
}

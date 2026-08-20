/**
 * Signup v2 primitives (Phase 1, 2026-08-19). Barrel export for the
 * five wireframe primitives used across `/signup`, `/login` (v2), and
 * future brand-facing auth surfaces.
 */

export {
  OvalInput,
  type OvalInputLabelStyle,
  type OvalInputProps,
} from "./OvalInput";
export {
  OvalSelect,
  type OvalSelectLabelStyle,
  type OvalSelectOption,
  type OvalSelectProps,
} from "./OvalSelect";
export {
  PillRadio,
  type PillRadioLabelStyle,
  type PillRadioOption,
  type PillRadioProps,
  type PillRadioVariant,
} from "./PillRadio";
export {
  PillButton,
  type PillButtonProps,
  type PillButtonVariant,
} from "./PillButton";
export {
  AuthShell,
  type AuthShellContentWidth,
  type AuthShellProps,
} from "./AuthShell";

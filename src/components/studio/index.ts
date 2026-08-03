export { StudioHero } from "./StudioHero";
export { StudioHeroPanel } from "./StudioHeroPanel";
export { StudioSignals, type StudioSignal } from "./StudioSignals";
export { StudioNextActions, type NextAction } from "./StudioNextActions";
export { StudioNextStepsRail } from "./StudioNextStepsRail";
export { FirstValuePathPanel } from "./FirstValuePathPanel";
export { StudioSectionNav, type StudioSection } from "./StudioSectionNav";
export {
  StudioOperationGrid,
  type OperationTile,
  type OperationTileKey,
} from "./StudioOperationGrid";
export { StudioViewsInsights } from "./StudioViewsInsights";
export { StudioPortfolioPanel } from "./StudioPortfolioPanel";
export { StudioIntelligenceSurface } from "./StudioIntelligenceSurface";
export { StudioMaterialsPanel } from "./StudioMaterialsPanel";
// Aug-2026 redesign — new Workspace hub tile grid. Lives next to the
// legacy StudioOperationGrid so both can coexist while other surfaces
// (e.g. an eventual rich profile page) continue to reuse the older
// components.
export {
  WorkspaceOperationGrid,
  type WorkspaceTile,
  type WorkspaceTileKey,
} from "./WorkspaceOperationGrid";

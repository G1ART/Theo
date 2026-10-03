import { isFilledSlot } from "./fill";
import type {
  FeedModule,
  WalkCopy,
  WalkExhibitionView,
  WalkPersonView,
  WalkWorkView,
} from "./types";

/**
 * A module is sent to the feed only when its cards and reason slots are
 * real. Placeholder exhibition titles ("title") and empty lists stay here
 * so the client never paints a header over a blank frame.
 */

function reasonIsReal(reason: WalkCopy | null | undefined): boolean {
  if (!reason || typeof reason.key !== "string" || reason.key.trim().length === 0) return false;
  if (!reason.params || typeof reason.params !== "object") return false;
  for (const value of Object.values(reason.params)) {
    if (typeof value !== "string" || !isFilledSlot(value)) return false;
  }
  return true;
}

function personIsReal(person: WalkPersonView | null | undefined): boolean {
  return Boolean(person && person.id && isFilledSlot(person.name));
}

function workIsReal(work: WalkWorkView | null | undefined): boolean {
  if (!work || !work.id) return false;
  const image = typeof work.imagePath === "string" && work.imagePath.trim().length > 0;
  return image || isFilledSlot(work.title);
}

function exhibitionIsReal(exhibition: WalkExhibitionView | null | undefined): boolean {
  return Boolean(exhibition && exhibition.id && isFilledSlot(exhibition.title));
}

function realWorks(works: WalkWorkView[] | null | undefined): WalkWorkView[] {
  if (!Array.isArray(works)) return [];
  return works.filter(workIsReal);
}

function realPeople(people: WalkPersonView[] | null | undefined): WalkPersonView[] {
  if (!Array.isArray(people)) return [];
  return people.filter(personIsReal);
}

/** Drop a shell. Returns the same module when every card is already real. */
export function visibleModule(module: FeedModule | null | undefined): FeedModule | null {
  if (!module || !reasonIsReal(module.reason)) return null;
  switch (module.type) {
    case "artwork_gallery":
    case "curators_view":
    case "related_artwork": {
      const works = realWorks(module.works);
      if (works.length === 0) return null;
      return works.length === module.works.length ? module : { ...module, works };
    }
    case "artist_card": {
      if (!personIsReal(module.person)) return null;
      const works = realWorks(module.works);
      if (works.length === 0) return null;
      return works.length === module.works.length ? module : { ...module, works };
    }
    case "exhibition_card":
      return exhibitionIsReal(module.exhibition) ? module : null;
    case "related_network": {
      const people = realPeople(module.people);
      if (people.length === 0) return null;
      return people.length === module.people.length ? module : { ...module, people };
    }
    default:
      return null;
  }
}

export function keepVisibleModules(modules: readonly FeedModule[]): FeedModule[] {
  const kept: FeedModule[] = [];
  for (const module of modules) {
    const next = visibleModule(module);
    if (next) kept.push(next);
  }
  return kept;
}

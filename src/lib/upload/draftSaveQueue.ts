/**
 * Run draft saves for one artwork in the order the user committed them.
 * An earlier blur must not land after the save that already has both sides.
 */
export function chainAfter<T>(previous: Promise<unknown>, run: () => Promise<T>): Promise<T> {
  return previous.then(run, run);
}

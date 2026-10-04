/**
 * Photoroom `/v1/segment` quality fields for the silhouette cutout.
 *
 * The endpoint's default `size` is `preview` (about 0.25 megapixels).
 * A rectangular canvas then comes back with a coarse matte even when
 * the upload was sharp. `full` keeps the upload's own resolution
 * (we cap the long edge before the call). `channels=rgba` keeps the
 * alpha we fit a quad to. No background color — a flat fill would
 * erase the matte before that fit.
 */

export const PHOTOROOM_SEGMENT_MAX_EDGE = 4096;

export const PHOTOROOM_SEGMENT_QUALITY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["format", "png"],
  ["channels", "rgba"],
  ["size", "full"],
];

export function appendPhotoroomQualityFields(form: FormData): void {
  for (const [key, value] of PHOTOROOM_SEGMENT_QUALITY_FIELDS) {
    form.append(key, value);
  }
}

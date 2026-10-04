/** Stored fields only. Empty values are omitted. Footer is always Theo. */

export type CaptionInput = {
  title: string | null;
  year: string | null;
  medium: string | null;
  size: string | null;
  artistName: string | null;
  handle: string | null;
  role: string | null;
};

export type CaptionModel = {
  title: string | null;
  artistName: string | null;
  lines: string[];
  footer: "Theo";
};

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function buildCaption(input: CaptionInput): CaptionModel {
  const lines = [input.year, input.medium, input.size, input.handle, input.role]
    .map(clean)
    .filter((line): line is string => !!line);
  return {
    title: clean(input.title),
    artistName: clean(input.artistName),
    lines,
    footer: "Theo",
  };
}

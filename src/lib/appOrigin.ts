/** Canonical site origin for links we email to people. */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return configured || "https://withtheo.art";
}

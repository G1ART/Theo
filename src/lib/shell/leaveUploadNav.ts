/**
 * Leave the upload wizard without waiting on a hung App Router.
 *
 * Sidebar items are Next `<Link>`s. Crop/enhance is local React state,
 * so if `router.refresh()` or an RSC request is stuck, those Links
 * look dead while crop still works. Hard-navigating off `/upload*`
 * abandons the in-memory draft — that is what the artist asked for.
 *
 * Client navigation is kept for `/upload` ↔ `/upload/bulk` ↔
 * `/upload/exhibition`.
 */

export function isUploadAppPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "").trim();
  return path === "/upload" || path.startsWith("/upload/");
}

export function hrefPathname(href: string): string {
  const raw = href.trim();
  if (!raw) return "";
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw).pathname;
    }
  } catch {
    // fall through to query-strip
  }
  return raw.split("?")[0] ?? raw;
}

export function shouldHardLeaveUpload(
  currentPath: string,
  href: string,
): boolean {
  if (typeof window === "undefined") return false;
  if (!isUploadAppPath(currentPath)) return false;
  return !isUploadAppPath(hrefPathname(href));
}

/** Full-page leave. Returns true when the caller must not `router.push`. */
export function leaveUploadOrAssign(
  currentPath: string,
  href: string,
): boolean {
  if (!shouldHardLeaveUpload(currentPath, href)) return false;
  window.location.assign(href);
  return true;
}

/** For `<Link onClick>`. Returns true when default was prevented. */
export function onUploadLeaveClick(
  currentPath: string,
  href: string,
  event: { preventDefault: () => void },
): boolean {
  if (!shouldHardLeaveUpload(currentPath, href)) return false;
  event.preventDefault();
  window.location.assign(href);
  return true;
}

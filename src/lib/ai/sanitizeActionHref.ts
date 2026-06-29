/**
 * AI suggestion `actionHref` sanitizer.
 *
 * The profile / portfolio copilots let the LLM emit an `actionHref` for
 * each suggestion ("작가 소개문 추가" → some link). The model is only
 * *asked* to reference a real Theo surface — nothing stops it from
 * hallucinating a path that does not exist (e.g. `/settings/bio`,
 * `/profile/edit`, `/settings/location`). Those rendered straight into a
 * `<Link>` produce a 404 (QA 2026-05-28).
 *
 * We never trust the model's URL. This validates an href against an
 * allowlist of *real* internal routes (static set + dynamic patterns
 * derived from `src/app/**`). Anything external, protocol-relative, or
 * unknown is rejected so the caller can fall back to a known-good route
 * (or hide the button).
 *
 * Returns the original href (query/hash preserved) when valid, else null.
 */

// Static routes that exist under src/app/**/page.tsx.
const STATIC_ROUTES = new Set<string>([
  "/",
  "/feed",
  "/settings",
  "/me",
  "/my",
  "/my/claims",
  "/my/access-requests",
  "/my/delegations",
  "/my/exhibitions",
  "/my/exhibitions/new",
  "/my/followers",
  "/my/following",
  "/my/network",
  "/my/relationships",
  "/my/shortlists",
  "/my/library",
  "/my/library/import",
  "/my/profile/cv",
  "/my/alerts",
  "/my/inquiries",
  "/my/messages",
  "/my/visibility",
  "/upload",
  "/upload/bulk",
  "/upload/exhibition",
  "/artists",
  "/people",
  "/people/invite",
  "/notifications",
  "/onboarding",
  "/onboarding/identity",
]);

// Dynamic routes — `[param]` segments matched as a single non-empty,
// non-slash segment.
const DYNAMIC_ROUTES: RegExp[] = [
  /^\/u\/[^/]+$/,
  /^\/artwork\/[^/]+$/,
  /^\/artwork\/[^/]+\/edit$/,
  /^\/e\/[^/]+$/,
  /^\/room\/[^/]+$/,
  /^\/my\/exhibitions\/[^/]+$/,
  /^\/my\/exhibitions\/[^/]+\/edit$/,
  /^\/my\/exhibitions\/[^/]+\/add$/,
  /^\/my\/shortlists\/[^/]+$/,
  /^\/my\/messages\/[^/]+$/,
];

function isAllowedPathname(pathname: string): boolean {
  // Normalize a trailing slash (except root) so `/settings/` matches `/settings`.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (STATIC_ROUTES.has(normalized)) return true;
  return DYNAMIC_ROUTES.some((re) => re.test(normalized));
}

/**
 * Validate an AI-supplied href. Returns the href (preserving query/hash)
 * if it points at a real internal route, otherwise null.
 */
export function sanitizeActionHref(
  href: string | null | undefined
): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  // Internal absolute paths only. Reject protocol-relative (`//host`),
  // absolute URLs (`http://`, `mailto:`, `javascript:`), and bare paths.
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;

  // Split off query/hash for route matching but keep them in the result.
  const queryIdx = trimmed.search(/[?#]/);
  const pathname = queryIdx === -1 ? trimmed : trimmed.slice(0, queryIdx);

  if (!isAllowedPathname(pathname)) return null;
  return trimmed;
}

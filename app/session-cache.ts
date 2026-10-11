// One /api/session request per page load, shared by everything that renders on load.
//
// SiteHeader asks who you are so it can draw the right account controls and the role links beside
// them. HomeClient asks the same question for the saved list, the radius unit and the Pro state.
// Both mount on every homepage view, so both fired, and each one is a D1 read on the server for an
// answer that cannot differ between them a few milliseconds apart.
//
// The promise is cached rather than the value, so two callers mounting in the same tick share the
// single in-flight request instead of racing to start a second one.

export type SessionUser = Record<string, unknown> | null;

let inFlight: Promise<SessionUser> | null = null;

// Whether the browser holds Clerk's session cookie, read the way the Worker reads it (isSignedIn in
// worker/index.ts). Clerk's frontend script sets __session itself, so it is never HttpOnly and a
// page can see it. Without it /api/session can only answer null - app/auth.ts has nothing to verify
// - so asking was a Worker request per page view, and the header's Sign in and Create account
// buttons waited out that round trip before they drew, on every page a signed-out reader opened.
function hasSessionCookie(): boolean {
  return typeof document === "undefined" || document.cookie.includes("__session=");
}

/**
 * The signed-in user, or null.
 *
 * Never rejects: callers use this to decide what to draw, and a failed request means "we cannot
 * know", which every caller already treats the same as signed out.
 */
export function fetchSession(): Promise<SessionUser> {
  if (!inFlight) {
    inFlight = !hasSessionCookie()
      ? Promise.resolve(null)
      : fetch("/api/session")
        .then((response) => response.json() as Promise<{ user: SessionUser }>)
        .then((body) => body.user ?? null)
        .catch(() => null);
  }
  return inFlight;
}

/**
 * Drops the cached answer so the next caller asks again.
 *
 * For the places that change who the reader is - signing out, or a profile save that renames them.
 * Not called on navigation: within one page load the answer is fixed, and a client-side route
 * change does not make the reader someone else.
 */
export function clearSessionCache() {
  inFlight = null;
}

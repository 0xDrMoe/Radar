// The one place the public site asks for @clerk/react's client bindings, so app/ClerkClientProvider.tsx
// and app/SiteHeader.tsx share one request and one chunk.
//
// Started at module evaluation for a reader whose page was rendered with a session cookie (RootShell
// marks <html data-signed-in> for exactly them), so the chunk downloads alongside the rest of the
// page's scripts instead of being discovered when hydration reaches the provider. Everyone else -
// every signed-out reader, every crawler - never requests it.
let pending: Promise<typeof import("@clerk/react")> | null = null;

export function loadClerkReact(): Promise<typeof import("@clerk/react")> {
  pending ??= import("@clerk/react").catch((cause) => {
    // Let a later mount try again rather than keeping a failed download forever.
    pending = null;
    throw cause;
  });
  return pending;
}

if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-signed-in")) {
  void loadClerkReact().catch(() => {});
}

import { notFound } from "next/navigation";

// Any path under a locale that no other route claims. Without this the framework answers it
// itself, with a plain-text "Not Found" and none of the site; claiming it here means it reaches
// the locale's own not-found page instead (app/[locale]/not-found.tsx).
export default function UnknownPath() {
  notFound();
}

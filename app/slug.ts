// The one slug format Radar uses.
//
// Lifted out of app/api/admin/route.ts unchanged, because it is now needed outside the Worker too:
// scripts/backfill-deal-slugs.mjs fills in the deals that never got one, and a second copy of this
// regex in a script is a second slug format waiting to drift from the first.
//
// A deal's slug is also its URL, and app/[locale]/deals/[slug]/page.tsx looks a deal up by
// `d.slug=? OR d.id=?`. That means a slug must not collide with any OTHER deal's id either, or the
// lookup's LIMIT 1 silently decides which of the two a URL resolves to - see uniqueSlug below.

/** Lowercase, unaccented, hyphen-separated, capped at 100 characters. */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/**
 * `slugify(parts)`, with a numeric suffix if something already claims it.
 *
 * `taken` must hold every existing deal slug AND every existing deal id, for the reason in the
 * header: the page lookup matches either column, so a slug equal to another row's id makes one of
 * the two URLs unreachable, and nothing announces which.
 */
export function uniqueSlug(parts: string, taken: Set<string>) {
  const base = slugify(parts) || "deal";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    // Trim the base so the suffix cannot push the result past the 100-character cap and collide
    // with the very slug it was meant to differ from.
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}

import { permanentRedirect } from "next/navigation";
import { LEGACY_CITY, cityPath, citySlug } from "../../city-pages";

// The guide began as Ottawa alone, at /en/ottawa. It is one city guide among several now
// (app/[locale]/cities), and this address sends links and search results already out there to it.
export default function OldOttawaGuide() {
  permanentRedirect(`/en${cityPath({ slug: citySlug(LEGACY_CITY.name, LEGACY_CITY.region) })}`);
}

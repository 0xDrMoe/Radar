import { permanentRedirect } from "next/navigation";
import { LEGACY_CITY, cityPath, citySlug } from "../../../city-pages";

// An old Ottawa topic address (/en/ottawa/wings), sent on to the same topic in the Ottawa guide.
export default async function OldOttawaTopic({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  permanentRedirect(`/en${cityPath({ slug: citySlug(LEGACY_CITY.name, LEGACY_CITY.region) }, encodeURIComponent(topic))}`);
}

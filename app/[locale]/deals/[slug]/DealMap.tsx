import { MapPin } from "lucide-react";

// OpenStreetMap's own embed export, not Mapbox GL — Mapbox is already wired up but only for
// geocoding (see app/geocode.ts); pulling in mapbox-gl just to render one static pin on a page
// that already links out to Google Maps for directions would be a lot of client JS for very
// little. The OSM embed needs no API key, no client bundle, and is an <iframe>, so it costs
// nothing on pages where a deal has no coordinates (OfferLocations renders no map at all for a
// branch with no coordinates).
//
// The pin follows the branch a reader picks, which is why the iframe carries a `key`. Writing a new
// `src` onto a live iframe navigates it, and a nested navigation goes into the session history the
// browser's Back button walks: choosing four branches would leave four entries to press Back
// through before leaving the page. Keying on the URL makes React throw the old iframe away and
// mount a new one, and a fresh iframe's first load replaces its initial entry rather than adding
// one.
//
// An approximate coordinate (approximateNote set) is the city's centre standing in for an address
// the geocoder could not place. A marker there is a specific, checkable falsehood - a pin on a
// street the restaurant is not on - so the map drops the marker, frames the wider area, and says
// why; the link opens the same area rather than a door-level view of the wrong block.
export default function DealMap({ latitude, longitude, label, approximateNote = null }: { latitude: number; longitude: number; label: string; approximateNote?: string | null }) {
  const approximate = Boolean(approximateNote);
  const delta = approximate ? 0.04 : 0.006;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join("%2C");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${approximate ? "" : `&marker=${latitude}%2C${longitude}`}`;
  const href = approximate
    ? `https://www.openstreetmap.org/#map=13/${latitude}/${longitude}`
    : `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
  return (
    <div className={`deal-map${approximate ? " approximate" : ""}`}>
      <iframe key={src} title={label} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <a className="deal-map-link" href={href} target="_blank" rel="noreferrer">
        <MapPin /> {label}
      </a>
      {approximateNote && <p className="deal-map-note">{approximateNote}</p>}
    </div>
  );
}

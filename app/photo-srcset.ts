// Responsive sources for the photos Radar stores in R2 (/api/photo/<key>).
//
// A card's photo slot is about 362x170 CSS px, and the stored files run to 2,560 px wide and 740 KB,
// so a phone downloads several times the pixels it can show. The browser can pick a smaller file on
// its own, but only once there is a smaller file to pick: srcset needs the photo route to answer
// `?w=<width>` with a resized copy, and today it serves the stored object whole.
//
// So everything a card needs is here and switched off in one place. When /api/photo learns `?w=`
// (the photo route belongs to another part of the tree), setting PHOTO_ROUTE_SERVES_WIDTHS to true
// is the whole change on this side: every card, the detail modal and the deal page's art pick it up
// through CardMedia. Until then this returns nothing and the markup is exactly what it was, because
// a srcset pointing at widths the route ignores would make the browser treat one file as several
// and fetch it more than once.
export const PHOTO_ROUTE_SERVES_WIDTHS = false;

// Twice the slot for a 2x screen, and the slot itself for everyone else.
export const CARD_PHOTO_WIDTHS = [400, 800] as const;

// The deal grid is three columns inside 1,120 px, two below 800 px and one below 570 px
// (globals.css), with gutters the browser does not need to be exact about.
export const CARD_PHOTO_SIZES = "(max-width: 570px) 100vw, (max-width: 800px) 50vw, 380px";

// Only stored photos: the live /api/restaurant-photo proxy and external URLs cannot resize either.
export function responsivePhotoProps(src: string, sizes: string = CARD_PHOTO_SIZES): { srcSet?: string; sizes?: string } {
  if (!PHOTO_ROUTE_SERVES_WIDTHS || !src.startsWith("/api/photo/")) return {};
  const joiner = src.includes("?") ? "&" : "?";
  return { srcSet: CARD_PHOTO_WIDTHS.map((width) => `${src}${joiner}w=${width} ${width}w`).join(", "), sizes };
}

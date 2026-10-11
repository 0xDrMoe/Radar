// The share card for one deal: a 1200 x 630 PNG that says what the deal is, where, and when.
//
// Before this every deal page shared as the same site-wide image (or, for a restaurant with a photo,
// the photo), so a link to "50c wings Mondays and Thursdays" previewed as a generic picture and the
// offer itself was nowhere in it. The card puts the offer in the preview.
//
// Rendered at deploy time by scripts/prerender-deals.mjs, in plain Node, and written beside the
// baked pages as dist/client/og/deals/<slug>.png - a file the asset layer serves without running the
// Worker. Drawing a PNG in a Worker would cost more than a request's CPU allowance, which is the
// whole reason deal pages are baked in the first place (see that script's header).
//
// satori and resvg come with @vercel/og, which vinext already depends on; its bundled font is Noto
// Sans Latin, so text the font has no glyph for is dropped by `printable` rather than drawn as a box.
import { ImageResponse } from "@vercel/og";

export const WIDTH = 1200;
export const HEIGHT = 630;

const INK = "#f7f3e9";
const MUTED = "#a9a396";
const CORAL = "#ff6f4a";
const BACKGROUND = "#0b0b0b";

// What Noto Sans Latin draws: Basic Latin, Latin-1 (accents, the cent sign), and the general
// punctuation block (dashes, curly quotes, bullets). Anything else is removed, not replaced, so a
// stray emoji in a title leaves no gap.
export function printable(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[^\u0020-\u007e\u00a0-\u00ff\u2010-\u2022\u2026\u20ac]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `text` cut to at most `max` characters on a word boundary, with an ellipsis when it was cut. */
export function clip(text, max) {
  const clean = printable(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:\-–—]+$/, "")}…`;
}

// A title's size is chosen by its length so a short one fills the card and a long one still fits in
// two lines.
function titleSize(title) {
  if (title.length <= 24) return 92;
  if (title.length <= 40) return 76;
  return 62;
}

const box = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const text = (style, value) => box(style, value);

/**
 * The element satori draws, as a plain object tree (no JSX in a .mjs script).
 * @param {{ restaurant: string, title: string, price?: string, schedule?: string, category?: string, city?: string }} deal
 */
export function dealCard(deal) {
  const title = clip(deal.title, 72);
  const restaurant = clip(deal.restaurant, 48);
  const detail = clip([deal.price, deal.schedule].filter(Boolean).join("  ·  "), 78);
  const where = clip(deal.city, 40);
  const label = deal.category === "Happy hour" ? "HAPPY HOUR" : "FOOD DEAL";
  return box({ flexDirection: "column", justifyContent: "space-between", width: WIDTH, height: HEIGHT, padding: "56px 72px", background: BACKGROUND, color: INK, fontFamily: "Noto Sans" }, [
    box({ justifyContent: "space-between", alignItems: "center" }, [
      box({ alignItems: "baseline", fontSize: 44 }, [text({}, "Radar"), text({ color: CORAL }, ".")]),
      text({ fontSize: 24, letterSpacing: 4, color: BACKGROUND, background: CORAL, padding: "8px 20px", borderRadius: 999 }, label),
    ]),
    box({ flexDirection: "column" }, [
      text({ fontSize: titleSize(title), lineHeight: 1.08, color: INK }, title),
      text({ fontSize: 42, marginTop: 22, color: CORAL }, `at ${restaurant}`),
      ...(detail ? [text({ fontSize: 32, marginTop: 20, color: MUTED }, detail)] : []),
    ]),
    box({ justifyContent: "space-between", alignItems: "center", fontSize: 28, color: MUTED }, [
      text({}, where),
      text({}, "radar.cheap"),
    ]),
  ]);
}

/** The card as PNG bytes. */
export async function renderDealImage(deal) {
  const response = new ImageResponse(dealCard(deal), { width: WIDTH, height: HEIGHT });
  return Buffer.from(await response.arrayBuffer());
}

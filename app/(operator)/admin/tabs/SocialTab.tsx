"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Images, X } from "lucide-react";
import { PanelHeader, StatePanel } from "../ui";
import { useTabState } from "../workspace";

// Social slides: turns live deals into 1080×1350 carousel images for TikTok and Instagram.
//
// Everything is read from the public deals API, the same answer a visitor gets for the city, so a
// slide can only ever show a deal that is live and passed the drink rules; there is no staff-only
// read behind this tab and nothing here writes. Drawing happens on a canvas in the browser, so the
// Worker does no more work than one ordinary city search per page of deals.
//
// Photos are the poster's own uploads, or the restaurant's photo Radar already shows on its card.
// The second is offered, never chosen for you: Radar shows that photo beside the deal it came
// with, and putting it in an advert is a different use the restaurant has to agree to.

const W = 1080;
const H = 1350;
const ACCENT = "#ff6b3d";
const MAX_SLIDES = 8;
const PAGES = 3;

interface SocialDeal {
  id: string;
  restaurant: string;
  title: string;
  price: string | null;
  schedule: string | null;
  restrictions: string | null;
  city: string | null;
  neighborhood: string | null;
  verified_at: string | null;
  photo_url: string | null;
  restaurant_photo_url: string | null;
}

interface SlideText {
  tag: string;
  venue: string;
  deal: string;
  fine: string;
  credit: string;
}

type Slide =
  | { key: string; kind: "hook"; headline: string; sub: string; credit: string }
  | ({ key: string; kind: "deal"; dealId: string } & SlideText)
  | { key: string; kind: "end"; headline: string; sub: string; credit: string };

interface CityOption { value: string; total: number }

const sameCity = (a: string | null | undefined, b: string) => Boolean(a) && (a as string).trim().toLowerCase() === b.trim().toLowerCase();
const sameOrigin = (url: string | null) => (url && url.startsWith("/") && !url.startsWith("//") ? url : null);
const radarPhoto = (deal: SocialDeal | undefined) => (deal ? sameOrigin(deal.photo_url) || sameOrigin(deal.restaurant_photo_url) : null);

function checkedLabel(deals: SocialDeal[]) {
  const dates = deals.map((deal) => deal.verified_at).filter(Boolean).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
  const when = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : new Date();
  return when.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

function dealSlide(deal: SocialDeal): Slide {
  return {
    key: `deal-${deal.id}`,
    kind: "deal",
    dealId: deal.id,
    tag: deal.schedule || "",
    venue: deal.restaurant,
    deal: deal.price || deal.title,
    fine: deal.restrictions || deal.neighborhood || "",
    credit: "",
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) {
  ctx.font = font;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawSlide(canvas: HTMLCanvasElement, slide: Slide, photo: HTMLImageElement | undefined, n: number, total: number, family: string, checked: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;
  const X = 88;
  const maxWidth = W - 2 * X;
  ctx.clearRect(0, 0, W, H);

  if (photo) {
    const scale = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
    const width = photo.naturalWidth * scale;
    const height = photo.naturalHeight * scale;
    ctx.drawImage(photo, (W - width) / 2, (H - height) / 2, width, height);
    const fade = ctx.createLinearGradient(0, 0, 0, H);
    fade.addColorStop(0, "rgba(10,8,7,.55)");
    fade.addColorStop(0.18, "rgba(10,8,7,0)");
    fade.addColorStop(0.42, "rgba(10,8,7,0)");
    fade.addColorStop(0.7, "rgba(10,8,7,.82)");
    fade.addColorStop(1, "rgba(10,8,7,.96)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
  } else {
    const ground = ctx.createLinearGradient(0, 0, W, H);
    ground.addColorStop(0, "#0d0d0d");
    ground.addColorStop(0.55, "#0d0d0d");
    ground.addColorStop(1, "#2a1810");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,107,61,.09)";
    ctx.lineWidth = 2;
    for (let radius = 150; radius <= 750; radius += 150) {
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.42, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // The Radar mark and wordmark, top left.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 4.2;
  const [cx, cy] = [X + 28, 108];
  ctx.beginPath(); ctx.arc(cx, cy, 21, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(cx, cy, 11.5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 3.7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 11.5, cy - 12, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.font = font(900, 44);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("Radar", X + 72, cy + 2);
  ctx.fillStyle = ACCENT;
  ctx.fillText(".", X + 72 + ctx.measureText("Radar").width, cy + 2);
  ctx.restore();

  // The text block is measured first and placed bottom-up, so it always clears the footer.
  type Block = { height: number; draw: (top: number) => void };
  const blocks: Block[] = [];
  const lines = (list: string[], top: number, size: number, weight: number, color: string, leading: number) => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    list.forEach((line, index) => ctx.fillText(line, X, top + index * leading));
  };
  if (slide.kind === "hook") {
    const head = wrap(ctx, slide.headline, maxWidth, font(900, 120));
    blocks.push({ height: head.length * 118, draw: (top) => head.forEach((line, index) => lines([line], top + 104 + index * 118, 120, 900, index === head.length - 1 ? ACCENT : "#fff", 0)) });
    const sub = wrap(ctx, slide.sub, maxWidth, font(500, 44));
    blocks.push({ height: 30 + sub.length * 56, draw: (top) => lines(sub, top + 70, 44, 500, "#e8e2de", 56) });
  } else if (slide.kind === "end") {
    const head = wrap(ctx, slide.headline, maxWidth, font(900, 76));
    blocks.push({ height: head.length * 84, draw: (top) => lines(head, top + 68, 76, 900, "#fff", 84) });
    const sub = wrap(ctx, slide.sub, maxWidth, font(500, 44));
    blocks.push({ height: 40 + sub.length * 56, draw: (top) => lines(sub, top + 80, 44, 500, "#e8e2de", 56) });
    blocks.push({ height: 120, draw: (top) => lines(["radar.cheap"], top + 100, 92, 900, ACCENT, 0) });
  } else {
    if (slide.tag) {
      blocks.push({
        height: 100,
        draw: (top) => {
          ctx.font = font(900, 36);
          const label = slide.tag.toUpperCase();
          const width = Math.min(maxWidth, ctx.measureText(label).width + 60);
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.roundRect(X, top, width, 68, 34);
          ctx.fill();
          ctx.fillStyle = "#140a06";
          ctx.textBaseline = "middle";
          ctx.fillText(label, X + 30, top + 36, maxWidth - 60);
        },
      });
    }
    const venue = wrap(ctx, slide.venue, maxWidth, font(900, 84));
    blocks.push({ height: venue.length * 88 + 10, draw: (top) => lines(venue, top + 72, 84, 900, "#fff", 88) });
    const deal = wrap(ctx, slide.deal, maxWidth, font(700, 60));
    blocks.push({ height: 20 + deal.length * 70, draw: (top) => lines(deal, top + 70, 60, 700, ACCENT, 70) });
    if (slide.fine) {
      const fine = wrap(ctx, slide.fine, maxWidth, font(500, 36));
      blocks.push({ height: 30 + fine.length * 48, draw: (top) => lines(fine, top + 70, 36, 500, "#d8d0cb", 48) });
    }
  }
  const height = blocks.reduce((sum, block) => sum + block.height, 0);
  let top = photo ? Math.max(200, H - 150 - height) : Math.max(200, (H - height) / 2 - 20);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = photo ? 18 : 0;
  for (const block of blocks) {
    block.draw(top);
    top += block.height;
  }
  ctx.restore();

  ctx.font = font(500, 27);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = photo ? "rgba(255,255,255,.75)" : "#9a8f88";
  ctx.fillText(slide.credit ? `Photo: ${slide.credit}` : `Checked against each venue's own site · ${checked}`, X, H - 80, maxWidth - 120);
  const count = `${n}/${total}`;
  ctx.fillText(count, W - X - ctx.measureText(count).width, H - 80);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That photo could not be opened."));
    image.src = src;
  });
}

/** A label above its control, with an optional line of help under it. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="sw-social-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────────────────────

export default function SocialTab() {
  const [city, setCity] = useTabState("social.city", "Ottawa");
  const [cityInput, setCityInput] = useState(city);
  const [deals, setDeals] = useTabState<SocialDeal[]>("social.deals", []);
  const [loadedCity, setLoadedCity] = useTabState("social.loadedCity", "");
  const [state, setState] = useState<{ loading: boolean; error: string }>({ loading: false, error: "" });
  const [filter, setFilter] = useState("");
  // Every city Radar has a live deal in, from the same facets the phone's place picker reads
  // (mobile/lib/places.ts). Empty until it answers, and the city box stays typeable without it.
  const [cities, setCities] = useTabState<CityOption[]>("social.cities", []);
  // A city search reaches nearby towns too; this narrows the list to one of them.
  const [onlyCity, setOnlyCity] = useTabState("social.onlyCity", "");
  const [slides, setSlides] = useTabState<Slide[]>("social.slides", []);
  const [current, setCurrent] = useState(0);
  const [photos, setPhotos] = useState<Map<string, HTMLImageElement>>(() => new Map());
  const [exported, setExported] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState("");
  const preview = useRef<HTMLCanvasElement>(null);
  // The slides use the site's own typeface. Read once in the browser; it never reaches the markup.
  const [family] = useState(() => (typeof document === "undefined" ? "" : getComputedStyle(document.body).fontFamily) || "system-ui, sans-serif");

  const load = useCallback(async (place: string) => {
    const name = place.trim();
    if (!name) return;
    setState({ loading: true, error: "" });
    try {
      const found: SocialDeal[] = [];
      let cursor: string | null = "0";
      for (let page = 0; page < PAGES && cursor != null; page += 1) {
        const response = await fetch(`/api/deals?city=${encodeURIComponent(name)}&limit=50&cursor=${cursor}`, { headers: { accept: "application/json" } });
        const body = (await response.json().catch(() => null)) as { results?: SocialDeal[]; nextCursor?: string | null; error?: { message?: string } } | null;
        if (!response.ok || !body?.results) throw new Error(body?.error?.message || "Deals could not be loaded for that city.");
        found.push(...body.results);
        cursor = body.nextCursor ?? null;
      }
      setDeals(found);
      setLoadedCity(name);
      setCity(name);
      setOnlyCity(found.some((deal) => sameCity(deal.city, name)) ? name : "");
      setFilter("");
      setState({ loading: false, error: "" });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Deals could not be loaded for that city." });
    }
  }, [setCity, setDeals, setLoadedCity, setOnlyCity]);

  useEffect(() => {
    // Only the first visit loads on its own; after that the button does. The fetch is the
    // external system this effect syncs with, and its state updates land after it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loadedCity) void load(city);
    if (!cities.length) {
      fetch("/api/deals?limit=1&view=compact", { headers: { accept: "application/json" } })
        .then((response) => (response.ok ? (response.json() as Promise<{ facets?: { cities?: CityOption[] } }>) : null))
        .then((body) => {
          const list = (body?.facets?.cities || []).filter((option) => option.value && option.value !== "Unknown");
          setCities(list.sort((a, b) => a.value.localeCompare(b.value)));
        })
        .catch(() => { /* the box still takes any city typed into it */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);
  const chosen = slides.filter((slide): slide is Extract<Slide, { kind: "deal" }> => slide.kind === "deal");
  const chosenIds = new Set(chosen.map((slide) => slide.dealId));
  const checked = checkedLabel(chosen.map((slide) => byId.get(slide.dealId)).filter((deal): deal is SocialDeal => Boolean(deal)));
  // The towns this search reached, with how many deals each, for the "Only show" picker.
  const nearby = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deal of deals) if (deal.city) counts.set(deal.city, (counts.get(deal.city) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [deals]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return deals.filter((deal) =>
      (!onlyCity || sameCity(deal.city, onlyCity))
      && (!needle || [deal.restaurant, deal.title, deal.price, deal.schedule, deal.neighborhood, deal.city].join(" ").toLowerCase().includes(needle)));
  }, [deals, filter, onlyCity]);

  // The hook and the closing slide are built around whatever deals are chosen, in order.
  const rebuild = (dealSlides: Extract<Slide, { kind: "deal" }>[]) => {
    if (!dealSlides.length) return setSlides([]);
    const hook = slides.find((slide) => slide.kind === "hook") as Extract<Slide, { kind: "hook" }> | undefined;
    const end = slides.find((slide) => slide.kind === "end") as Extract<Slide, { kind: "end" }> | undefined;
    setSlides([
      hook ?? { key: "hook", kind: "hook", headline: `${dealSlides.length} deals worth\nknowing in\n${loadedCity}`, sub: "Save this for your next night out.", credit: "" },
      ...dealSlides,
      end ?? { key: "end", kind: "end", headline: "Every deal checked against the venue's own site.", sub: "See what's on near you right now, free:", credit: "" },
    ]);
  };

  const toggle = (deal: SocialDeal) => {
    if (chosenIds.has(deal.id)) rebuild(chosen.filter((slide) => slide.dealId !== deal.id) as Extract<Slide, { kind: "deal" }>[]);
    else if (chosen.length < MAX_SLIDES) rebuild([...chosen, dealSlide(deal) as Extract<Slide, { kind: "deal" }>]);
    setExported([]);
  };

  const move = (index: number, by: number) => {
    const next = [...chosen];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    rebuild(next);
  };

  const safeCurrent = Math.min(current, Math.max(0, slides.length - 1));
  const slide = slides[safeCurrent];

  const edit = (patch: Partial<SlideText & { headline: string; sub: string }>) => {
    setSlides(slides.map((item, index) => (index === safeCurrent ? ({ ...item, ...patch } as Slide) : item)));
    setExported([]);
  };

  useEffect(() => {
    if (preview.current && slide) drawSlide(preview.current, slide, photos.get(slide.key), safeCurrent + 1, slides.length, family, checked);
  }, [slide, photos, safeCurrent, slides.length, family, checked]);

  const setPhoto = async (src: string | null) => {
    if (!slide) return;
    setPhotoError("");
    const next = new Map(photos);
    if (!src) next.delete(slide.key);
    else {
      try {
        next.set(slide.key, await loadImage(src));
      } catch (error) {
        setPhotoError(error instanceof Error ? error.message : "That photo could not be opened.");
        return;
      }
    }
    setPhotos(next);
    setExported([]);
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setPhotoError("Choose an image file (JPEG, PNG or WebP).");
    const reader = new FileReader();
    reader.onload = () => void setPhoto(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setPhotoError("That photo could not be read.");
    reader.readAsDataURL(file);
  };

  const exportAll = () => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    setExported(slides.map((item, index) => {
      drawSlide(canvas, item, photos.get(item.key), index + 1, slides.length, family, checked);
      return canvas.toDataURL("image/png");
    }));
  };

  const currentDeal = slide?.kind === "deal" ? byId.get(slide.dealId) : undefined;
  const offeredPhoto = radarPhoto(currentDeal);

  return (
    <>
      <section className="portal-card sw-social">
        <PanelHeader title="1. Pick the deals">
          Live deals for a city, exactly as visitors see them. Choose up to {MAX_SLIDES}; the order you pick them in is the slide order.
        </PanelHeader>
        <form className="sw-social-controls" onSubmit={(event) => { event.preventDefault(); void load(cityInput); }}>
          <div className="sw-social-field">
            <label htmlFor="social-city">City</label>
            <input id="social-city" type="text" list="social-city-options" value={cityInput} onChange={(event) => setCityInput(event.target.value)} placeholder="Start typing a city" autoComplete="off" />
            <datalist id="social-city-options">
              {cities.map((option) => <option key={option.value} value={option.value}>{`${option.total} deal${option.total === 1 ? "" : "s"}`}</option>)}
            </datalist>
            <small>{cities.length ? `Pick from ${cities.length} cities with live deals, or type one.` : "Type a city Radar covers."}</small>
          </div>
          <button type="submit" className="primary" disabled={state.loading || !cityInput.trim()}>{state.loading ? "Loading…" : "Load deals"}</button>
        </form>
        {deals.length > 0 && !state.error && (
          <div className="sw-social-controls">
            {nearby.length > 1 && (
              <div className="sw-social-field">
                <label htmlFor="social-only-city">Only show deals in</label>
                <select id="social-only-city" value={onlyCity} onChange={(event) => setOnlyCity(event.target.value)}>
                  <option value="">All {nearby.length} nearby cities ({deals.length})</option>
                  {nearby.map(([name, total]) => <option key={name} value={name}>{`${name} (${total})`}</option>)}
                </select>
              </div>
            )}
            <div className="sw-social-field">
              <label htmlFor="social-filter">Search these deals</label>
              <input id="social-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="wings, Tuesday, sushi…" />
            </div>
            <p className="sw-social-count" aria-live="polite">Showing {shown.length} of {deals.length} · {chosen.length} of {MAX_SLIDES} picked</p>
          </div>
        )}
        {state.error ? (
          <StatePanel kind="error" title="No deals loaded">{state.error}</StatePanel>
        ) : state.loading && !deals.length ? (
          <StatePanel kind="loading" title={`Loading deals for ${cityInput}`} />
        ) : !deals.length ? (
          <StatePanel kind="empty" title="No live deals here yet">Try a city Radar covers, such as Ottawa or Toronto.</StatePanel>
        ) : !shown.length ? (
          <StatePanel kind="empty" title="Nothing matches">Clear the search or choose another city above.</StatePanel>
        ) : (
          <ul className="sw-social-deals" aria-label={`Live deals in ${loadedCity}`}>
            {shown.map((deal) => {
              const on = chosenIds.has(deal.id);
              return (
                <li key={deal.id}>
                  <label className={on ? "on" : undefined}>
                    <input type="checkbox" checked={on} disabled={!on && chosen.length >= MAX_SLIDES} onChange={() => toggle(deal)} />
                    <span>
                      <b>{deal.restaurant}</b> · {deal.title}
                      <small>{[deal.price, deal.schedule, deal.city].filter(Boolean).join(" · ")}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {slides.length > 0 && slide && (
        <section className="portal-card sw-social">
          <PanelHeader title="2. Edit, add photos, export" actions={<button type="button" className="primary" onClick={exportAll}><Images size={16} aria-hidden="true" /> Export all slides</button>}>
            Your own photos from the venue work best. A restaurant&apos;s photo needs the restaurant&apos;s OK before it goes in an advert.
          </PanelHeader>
          <div className="sw-social-strip" role="tablist" aria-label="Slides">
            {slides.map((item, index) => (
              <button key={item.key} type="button" role="tab" aria-selected={index === safeCurrent} className={index === safeCurrent ? "active" : undefined} onClick={() => setCurrent(index)}>
                {index + 1}. {item.kind === "hook" ? "Hook" : item.kind === "end" ? "Closing" : item.venue}
                {photos.has(item.key) && <ImagePlus size={13} aria-label="has a photo" />}
              </button>
            ))}
          </div>
          <div className="sw-social-work">
            <div className="sw-social-fields">
              <fieldset>
                <legend>Slide {safeCurrent + 1} text</legend>
                {slide.kind === "deal" ? (
                  <>
                    <Field id="social-tag" label="Day or time" hint="Shown in the orange pill, e.g. Wednesday or Mon to Fri, 3 to 6pm.">
                      <input id="social-tag" type="text" value={slide.tag} onChange={(event) => edit({ tag: event.target.value })} />
                    </Field>
                    <Field id="social-venue" label="Restaurant">
                      <input id="social-venue" type="text" value={slide.venue} onChange={(event) => edit({ venue: event.target.value })} />
                    </Field>
                    <Field id="social-deal" label="Deal" hint="The offer in a few words. For a chain, leave the city out.">
                      <input id="social-deal" type="text" value={slide.deal} onChange={(event) => edit({ deal: event.target.value })} />
                    </Field>
                    <Field id="social-fine" label="Small print" hint="Conditions people need to know, such as dine-in only.">
                      <input id="social-fine" type="text" value={slide.fine} onChange={(event) => edit({ fine: event.target.value })} />
                    </Field>
                    <div className="sw-social-row">
                      <button type="button" className="tool-button" onClick={() => move(safeCurrent - 1, -1)} disabled={safeCurrent <= 1}><ArrowUp size={14} aria-hidden="true" /> Move earlier</button>
                      <button type="button" className="tool-button" onClick={() => move(safeCurrent - 1, 1)} disabled={safeCurrent >= chosen.length}><ArrowDown size={14} aria-hidden="true" /> Move later</button>
                      <button type="button" className="tool-button" onClick={() => currentDeal && toggle(currentDeal)}><X size={14} aria-hidden="true" /> Remove this deal</button>
                    </div>
                  </>
                ) : (
                  <>
                    <Field id="social-headline" label="Headline" hint="Each line you type is a line on the slide. The last line is orange.">
                      <textarea id="social-headline" rows={4} value={slide.headline} onChange={(event) => edit({ headline: event.target.value })} />
                    </Field>
                    <Field id="social-sub" label="Line underneath">
                      <input id="social-sub" type="text" value={slide.sub} onChange={(event) => edit({ sub: event.target.value })} />
                    </Field>
                  </>
                )}
              </fieldset>
              <fieldset>
                <legend>Photo</legend>
                <div className="sw-social-row">
                  <label className="tool-button sw-social-upload">
                    <ImagePlus size={14} aria-hidden="true" /> {photos.has(slide.key) ? "Replace photo" : "Upload your photo"}
                    <input type="file" accept="image/*" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
                  </label>
                  {offeredPhoto && <button type="button" className="tool-button" onClick={() => void setPhoto(offeredPhoto)}>Use the restaurant&apos;s Radar photo</button>}
                  {photos.has(slide.key) && <button type="button" className="tool-button" onClick={() => void setPhoto(null)}>Remove photo</button>}
                </div>
                {offeredPhoto && <p className="sw-social-hint">Only post the restaurant&apos;s photo once they have said yes, and credit them below.</p>}
                {photoError && <p className="sw-social-hint sw-social-error" role="alert">{photoError}</p>}
                <Field id="social-credit" label="Photo credit (optional)" hint="Replaces the footer, e.g. @thebridgepub.">
                  <input id="social-credit" type="text" value={slide.credit} onChange={(event) => edit({ credit: event.target.value })} />
                </Field>
              </fieldset>
            </div>
            <canvas ref={preview} width={W} height={H} className="sw-social-canvas" aria-label={`Preview of slide ${safeCurrent + 1}`} />
          </div>
        </section>
      )}

      {exported.length > 0 && (
        <section className="portal-card">
          <PanelHeader title="3. Save the images">
            Full size, 1080×1350. Right-click and choose Save Image, or long-press on a phone. Post them in order as an Instagram carousel or a TikTok photo post.
          </PanelHeader>
          <div className="sw-social-export">
            {exported.map((src, index) => (
              <a key={index} href={src} download={`radar-${loadedCity.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(index + 1).padStart(2, "0")}.png`}>
                {/* A data: URL drawn in this browser; next/image has nothing to optimize. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Slide ${index + 1}`} />
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

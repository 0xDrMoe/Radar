"use client";
import { useEffect, useRef, useState } from "react";

// A curated set grouped by relevance to deals (food/drink first, since most listings are
// restaurants, then retail/shopping and general reaction emoji for the newer non-food
// verticals). Each entry carries a few search keywords so the filter box can match on intent
// ("coffee", "spicy") rather than requiring the admin to already know the exact glyph.
const EMOJI_GROUPS: { label: string; items: { emoji: string; keywords: string }[] }[] = [
  {
    label: "Food & drink",
    items: [
      { emoji: "🍽️", keywords: "plate dining restaurant" },
      { emoji: "🍕", keywords: "pizza" },
      { emoji: "🍔", keywords: "burger" },
      { emoji: "🌮", keywords: "taco mexican" },
      { emoji: "🌯", keywords: "burrito wrap mexican" },
      { emoji: "🍜", keywords: "noodles ramen soup" },
      { emoji: "🍣", keywords: "sushi japanese" },
      { emoji: "🍱", keywords: "bento japanese lunch" },
      { emoji: "🍤", keywords: "shrimp seafood fried" },
      { emoji: "🦞", keywords: "lobster seafood" },
      { emoji: "🦪", keywords: "oyster seafood" },
      { emoji: "🍝", keywords: "pasta italian" },
      { emoji: "🍲", keywords: "stew hotpot" },
      { emoji: "🥘", keywords: "paella skillet" },
      { emoji: "🍛", keywords: "curry rice indian" },
      { emoji: "🥗", keywords: "salad healthy" },
      { emoji: "🥪", keywords: "sandwich deli" },
      { emoji: "🌭", keywords: "hot dog" },
      { emoji: "🍗", keywords: "chicken wings" },
      { emoji: "🥩", keywords: "steak meat" },
      { emoji: "🥓", keywords: "bacon breakfast" },
      { emoji: "🍳", keywords: "eggs breakfast brunch" },
      { emoji: "🥞", keywords: "pancakes breakfast brunch" },
      { emoji: "🧇", keywords: "waffle breakfast brunch" },
      { emoji: "🥐", keywords: "croissant bakery pastry" },
      { emoji: "🍞", keywords: "bread bakery" },
      { emoji: "🥖", keywords: "baguette bakery french" },
      { emoji: "🧀", keywords: "cheese" },
      { emoji: "🍰", keywords: "cake dessert" },
      { emoji: "🧁", keywords: "cupcake dessert bakery" },
      { emoji: "🍩", keywords: "donut dessert bakery" },
      { emoji: "🍪", keywords: "cookie dessert bakery" },
      { emoji: "🍦", keywords: "ice cream dessert" },
      { emoji: "🍨", keywords: "sundae ice cream dessert" },
      { emoji: "🍫", keywords: "chocolate dessert" },
      { emoji: "🥟", keywords: "dumpling chinese" },
      { emoji: "🍢", keywords: "skewer spanish tapas" },
      { emoji: "🥙", keywords: "pita mediterranean middle eastern" },
      { emoji: "🫓", keywords: "flatbread mediterranean" },
      { emoji: "🍕", keywords: "pizza slice" },
      { emoji: "☕", keywords: "coffee cafe" },
      { emoji: "🍵", keywords: "tea cafe" },
      { emoji: "🧋", keywords: "bubble tea boba" },
      { emoji: "🍺", keywords: "beer bar pub" },
      { emoji: "🍻", keywords: "cheers beer bar pub" },
      { emoji: "🍷", keywords: "wine bar" },
      { emoji: "🍸", keywords: "cocktail bar" },
      { emoji: "🍹", keywords: "cocktail tropical bar" },
      { emoji: "🥃", keywords: "whiskey spirits bar" },
      { emoji: "🌶️", keywords: "spicy pepper hot" },
    ],
  },
  {
    label: "Retail & shopping",
    items: [
      { emoji: "🛍️", keywords: "shopping bags retail" },
      { emoji: "🛒", keywords: "cart grocery retail" },
      { emoji: "👗", keywords: "clothing fashion apparel" },
      { emoji: "👟", keywords: "shoes sneakers fashion" },
      { emoji: "💄", keywords: "beauty cosmetics" },
      { emoji: "💇", keywords: "salon hair beauty" },
      { emoji: "💅", keywords: "nails beauty spa" },
      { emoji: "🧴", keywords: "spa wellness beauty" },
      { emoji: "📱", keywords: "electronics tech" },
      { emoji: "💻", keywords: "electronics tech computer" },
      { emoji: "📚", keywords: "books" },
      { emoji: "🎁", keywords: "gift" },
      { emoji: "💐", keywords: "flowers florist" },
      { emoji: "🏠", keywords: "home goods" },
      { emoji: "🚗", keywords: "auto car service" },
      { emoji: "🏋️", keywords: "gym fitness" },
      { emoji: "🎫", keywords: "tickets entertainment" },
    ],
  },
  {
    label: "General",
    items: [
      { emoji: "⭐", keywords: "star featured" },
      { emoji: "🔥", keywords: "fire hot trending" },
      { emoji: "🎉", keywords: "celebration party" },
      { emoji: "💯", keywords: "deal best" },
      { emoji: "⏰", keywords: "time limited hour" },
      { emoji: "📍", keywords: "location pin" },
      { emoji: "❤️", keywords: "favorite love" },
      { emoji: "✨", keywords: "sparkle new special" },
    ],
  },
];

export default function EmojiPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("");
  // Fixed-position coordinates computed from the trigger button's live position, recalculated
  // every time the panel opens. Anchoring via `position: fixed` (rather than absolute, relative
  // to this field) means the panel floats freely on top of the page instead of being clipped by
  // the editor modal's own `overflow: auto`, and it never needs the modal itself to scroll to
  // reveal it — which used to visibly yank every other field in the form upward the instant the
  // picker opened.
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Focuses the search box whenever the panel opens — an imperative ref-based effect instead of
  // the autoFocus prop, since autoFocus fires on every mount regardless of context and trips
  // jsx-a11y/no-autofocus; this only steals focus for this popover's own open transition.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const PANEL_HEIGHT_ESTIMATE = 420, PANEL_WIDTH = 340, MARGIN = 6;
    function place() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const openUp = rect.bottom + PANEL_HEIGHT_ESTIMATE > window.innerHeight && rect.top > PANEL_HEIGHT_ESTIMATE;
      const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - MARGIN);
      const top = openUp ? rect.top - MARGIN : rect.bottom + MARGIN;
      setPos({ top, left: Math.max(MARGIN, left), openUp });
    }
    place();
    // The panel is anchored to the button's on-screen position, not to any scroll container's
    // content — if the page or the modal beneath it scrolls while the panel is open, the button
    // moves out from under it. Closing on scroll (rather than re-tracking it on every scroll
    // event) keeps this simple and matches how most floating pickers behave. But the panel and
    // its emoji grid are themselves scrollable, and those scroll events bubble up to this same
    // capture-phase listener — skip them, or scrolling the grid immediately closes it.
    function onScroll(e: Event) {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const groups = EMOJI_GROUPS.map((group) => ({
    ...group,
    items: needle ? group.items.filter((item) => item.keywords.includes(needle) || item.emoji === filter) : group.items,
  })).filter((group) => group.items.length > 0);

  // Escape closes the panel from anywhere inside it. Picking or closing unmounts whatever had
  // focus, so focus goes back to the trigger rather than falling to the page.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, pos]);

  function pick(emoji: string) {
    onChange(emoji);
    setOpen(false);
    setFilter("");
    triggerRef.current?.focus();
  }

  return (
    <div className="emoji-picker" ref={containerRef}>
      <button
        type="button"
        id="admin-emoji"
        ref={triggerRef}
        className="emoji-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value || "🍽️"}</span> Change
      </button>
      {/* Hidden field is what actually reaches FormData/handleEditorSubmit under name="emoji";
          the visible control above is a button, not an input, so it can't carry the name itself. */}
      <input type="hidden" name="emoji" value={value} readOnly />
      {open && pos && (
        <div
          className="emoji-picker-panel"
          role="dialog"
          aria-label="Choose an emoji"
          ref={panelRef}
          style={{ top: pos.openUp ? "auto" : pos.top, bottom: pos.openUp ? window.innerHeight - pos.top : "auto", left: pos.left }}
        >
          <input
            ref={searchRef}
            type="text"
            className="emoji-picker-search"
            aria-label="Search emoji"
            placeholder="Search emoji (e.g. coffee, spicy)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="emoji-picker-grid">
            {groups.length === 0 && <p className="emoji-picker-empty">No matches — try a different word, or paste your own below.</p>}
            {groups.map((group) => (
              <div key={group.label}>
                <span className="emoji-picker-group-label">{group.label}</span>
                <div className="emoji-picker-row">
                  {group.items.map((item) => (
                    <button
                      type="button"
                      key={item.emoji + item.keywords}
                      className="emoji-picker-item"
                      title={item.keywords}
                      aria-label={`${item.emoji} ${item.keywords.split(" ")[0]}`}
                      onClick={() => pick(item.emoji)}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="emoji-picker-custom">
            <input
              type="text"
              aria-label="Custom emoji"
              placeholder="Or paste your own emoji"
              value={custom}
              maxLength={8}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="button" disabled={!custom.trim()} onClick={() => { pick(custom.trim()); setCustom(""); }}>
              Use
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

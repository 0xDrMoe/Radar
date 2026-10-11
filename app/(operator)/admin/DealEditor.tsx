"use client";
import { useMemo, useRef, useState } from "react";
import {
  Eye,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { DialogFocus } from "../DialogFocus";
import { CUISINES, isKnownCuisine } from "../../cuisines";
import { describeWindows, parseScheduleText } from "../../schedule-text";
import EmojiPicker from "./EmojiPicker";
import {
  DAYS,
  EDITOR_STEPS,
  EMPTY_ITEM,
  EMPTY_LOCATION,
  EMPTY_WINDOW,
  editorTimeZone,
  FIELD_STEP,
  parseEditorItems,
  parseEditorLocations,
  parseEditorWindows,
  parseKeywords,
  PRESET_KEYWORDS,
  toLocalInput,
  toStoredTimestamp,
  type EditorItem,
  type EditorLocation,
  type EditorWindow,
} from "./format";
import type { AdminDeal } from "./types";
import { useWorkspace } from "./workspace";

/**
 * The deal editor: four steps, the publishing readiness rail, and the discard prompt.
 *
 * The shell mounts a fresh one, keyed, every time openEditor runs (see AdminClient.tsx), so the
 * state below starts from the deal being opened — the same values openEditor used to reset by
 * hand. Closing hands control back to the shell through onClose, which unmounts it.
 */
export default function DealEditor({ initial, onClose }: { initial: Partial<AdminDeal>; onClose: () => void }) {
  const { busy, action, fieldErrors, setFieldErrors, setPreview } = useWorkspace();
  const [editor, setEditorValue] = useState<Partial<AdminDeal>>(initial),
    [editorStep, setEditorStep] = useState(0),
    [maxStep, setMaxStep] = useState(initial.id ? EDITOR_STEPS.length - 1 : 0),
    [editorWindows, setEditorWindows] = useState<EditorWindow[]>(() => parseEditorWindows(initial)),
    [editorLocations, setEditorLocations] = useState<EditorLocation[]>(() => parseEditorLocations(initial)),
    [editorItems, setEditorItems] = useState<EditorItem[]>(() => parseEditorItems(initial)),
    [cuisineIsOther, setCuisineIsOther] = useState(!!initial.cuisine && !isKnownCuisine(initial.cuisine)),
    [emojiValue, setEmojiValue] = useState(initial.emoji || "🍽️"),
    [noExpiration, setNoExpiration] = useState(!initial.expires_at),
    [keywords, setKeywords] = useState<string[]>(() => parseKeywords(initial.curated_keywords)),
    [keywordsSuggested, setKeywordsSuggested] = useState(false),
    [editorDirty, setEditorDirty] = useState(false),
    [discardDialog, setDiscardDialog] = useState(false);
  const editorFormRef = useRef<HTMLFormElement>(null);
  // null closes the editor, as it did when the editor was a piece of the shell's state.
  function setEditor(value: Partial<AdminDeal> | null) {
    if (value) setEditorValue(value);
    else onClose();
  }
  function requestEditorClose() { if (editorDirty) setDiscardDialog(true); else setEditor(null); }
  function enterStep(step: number) {
    setEditorStep(step);
    // One-time auto-suggest the first time the admin reaches the keywords step with nothing
    // picked yet: pre-check any preset that matches the cuisine they already typed. Basics is
    // an uncontrolled field, so on a brand-new draft `editor.cuisine` is still stale until the
    // first real save — read the live DOM value instead.
    if (step === 3 && !keywordsSuggested && keywords.length === 0) {
      const cuisineInput = editorFormRef.current?.elements.namedItem("cuisine") as HTMLInputElement | null;
      const cuisine = (cuisineInput?.value || editor?.cuisine || "").trim().toLowerCase();
      setKeywordsSuggested(true);
      if (cuisine) {
        const match = PRESET_KEYWORDS.find((preset) => preset.toLowerCase() === cuisine || cuisine.includes(preset.toLowerCase()));
        if (match) setKeywords([match]);
      }
    }
  }
  async function persistDeal(values: Record<string, FormDataEntryValue>) {
    const resolvedCuisine = values.cuisine === "Other" ? String(values.cuisine_other || "").trim() : values.cuisine;
    // Both inputs hold the admin's local time and the columns hold UTC; see toStoredTimestamp.
    // They are set after `...values` below, which would otherwise put the raw input back.
    const publishAt = toStoredTimestamp(values.publish_at, editor?.publish_at);
    const expiresAt = noExpiration ? "" : toStoredTimestamp(values.expires_at, editor?.expires_at);
    if (publishAt === null || expiresAt === null) {
      setFieldErrors({
        ...(publishAt === null ? { publish_at: "Pick a date and time" } : {}),
        ...(expiresAt === null ? { expires_at: "Pick a date and time" } : {}),
      });
      return null;
    }
    const result = await action({
      action: "save_deal",
      id: editor?.id,
      deal: {
        ...editor,
        ...values,
        cuisine: resolvedCuisine,
        emoji: emojiValue,
        sponsored: values.sponsored === "on",
        schedule_windows: editorWindows.map((w) => ({ days: w.days, start_time: w.start, end_time: w.end })),
        locations: editorLocations.map((l) => ({ id: l.id, address: l.address, city: l.city, postal: l.postal })),
        items: editorItems.map((it) => ({ name: it.name, original_price: it.original, discounted_price: it.discounted })),
        curated_keywords: keywords.join(", "),
        publish_at: publishAt,
        expires_at: expiresAt,
      },
    });
    if (!result) return null;
    const savedId = editor?.id || result.id;
    return result.data?.deals.find((row) => row.id === savedId) || null;
  }
  async function verifyLocationInEditor(locationId: string) {
    if (!editor?.id) return;
    const result = await action({ action: "verify", id: editor.id, locationId });
    if (result) {
      const updated = result.data?.deals.find((row) => row.id === editor.id);
      if (updated) setEditor(updated);
    }
  }
  // One click has to leave the deal publishable, which means the verification event and every
  // offer location's eligibility, not one of the two — a multi-location deal used to need a
  // separate Verify per address before "Location verified" would go green. allLocations tells the
  // API to confirm them all; the per-location rows below stay for the partial case.
  async function verifyInEditor() {
    if (!editor?.id) return;
    const result = await action({ action: "verify", id: editor.id, allLocations: true });
    if (result) {
      const updated = result.data?.deals.find((row) => row.id === editor.id);
      if (updated) setEditor(updated);
    }
  }
  function jumpToField(field: string) {
    const step = FIELD_STEP[field] ?? 0;
    setMaxStep((s) => Math.max(s, step));
    enterStep(step);
    // The field sits in a step panel that is still `hidden` until this render commits.
    requestAnimationFrame(() => document.getElementById(`admin-${field}`)?.focus());
  }
  async function handleEditorSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A submit button's name/value is only captured via the SubmitEvent's `submitter` —
    // plain `new FormData(form)` after preventDefault() never includes it.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value || "save";
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (intent === "next") {
      // A brand-new draft can't be persisted a step at a time: restaurant/city/postal_prefix/
      // address/schedule are all NOT NULL columns with no defaults, so the first save needs
      // every step's data at once. Steps 0-2 just advance locally; nothing is lost since every
      // field stays mounted (only visually hidden) across steps.
      setMaxStep((s) => Math.max(s, editorStep + 1));
      enterStep(Math.min(editorStep + 1, EDITOR_STEPS.length - 1));
      return;
    }
    const updated = await persistDeal(values);
    if (!updated) return;
    setEditorDirty(false);
    if (intent === "publish") {
      const publishResult = await action({ action: "lifecycle", id: updated.id, status: "live" });
      if (publishResult) { setEditor(null); return; }
      setEditor(updated);
      setMaxStep(EDITOR_STEPS.length - 1);
      enterStep(EDITOR_STEPS.length - 1);
      return;
    }
    setEditor(null);
  }
  const isNewDraft = editor ? !editor.id : false;
  // Data completeness (did the admin fill in an address?) is deliberately separate from
  // location verification (did a human confirm it via the Verify action?) — save_deal always
  // inserts deal_locations at eligibility='needs_review', so locationOk can only ever flip via
  // the verify action. Without this split, a perfectly complete address reads as "incomplete"
  // forever until someone clicks Verify, which is what this fixes.
  const addressOk = editorLocations.length > 0 && editorLocations.every((l) => l.address.trim() && l.city.trim() && l.postal.trim());
  const locationOk = !!(editor && Number(editor.confirmed_locations || 0) > 0);
  // Saved offer locations, not the ones being typed: the verify button acts on what the API has,
  // so an address added in the form but not yet saved must not be counted in what it claims.
  const editorLocationCount = editor?.locations?.length || 0;
  const sourceOk = !!(editor && String(editor.source_url || "").trim());
  const scheduleOk = !!(editor && Number(editor.schedules || 0) > 0);
  const verifiedOk = !!(editor && editor.verification_status === "verified");
  const editorZone = editor ? editorTimeZone() : "";
  function toggleWindowDay(windowIndex: number, dayKey: string) {
    setEditorWindows((current) => current.map((w, i) => i !== windowIndex ? w : { ...w, days: w.days.includes(dayKey) ? w.days.filter((d) => d !== dayKey) : [...w.days, dayKey] }));
    setEditorDirty(true);
  }
  function setWindowTime(windowIndex: number, field: "start" | "end", value: string) {
    setEditorWindows((current) => current.map((w, i) => i !== windowIndex ? w : { ...w, [field]: value }));
    setEditorDirty(true);
  }
  function addWindow() {
    setEditorWindows((current) => [...current, { ...EMPTY_WINDOW }]);
    setEditorDirty(true);
  }
  function removeWindow(windowIndex: number) {
    setEditorWindows((current) => current.length > 1 ? current.filter((_, i) => i !== windowIndex) : current);
    setEditorDirty(true);
  }
  // The days and times the deal's own free-text schedule states, if it states them readably.
  //
  // Every imported deal carries a sentence like "Sun-Thu 10 PM-12 AM" and an empty set of
  // checkboxes, and the editor was already printing that sentence in the note beside them. Of 77
  // imported drafts, 76 had the sentence and one had the structure, because crossing that gap meant
  // a person reading it and re-entering it by hand, five checkboxes and two clock fields at a time.
  const parsedFromText = useMemo(
    () => (editor && !editor.schedule_windows?.length && !editor.schedule_days ? parseScheduleText(editor.schedule) : []),
    [editor],
  );
  // Fills the form and stops. Nothing is saved, the days simply light up and the times populate,
  // and the reviewer looks at them against the source before pressing save — which is the whole
  // reason this is safe to offer. "The hours are right and dated" is the one claim Radar makes that
  // its competitors do not, and it is not worth spending to save two clicks.
  function fillFromScheduleText() {
    if (!parsedFromText.length) return;
    setEditorWindows(parsedFromText.map((w) => ({ days: w.days, start: w.start, end: w.end })));
    setEditorDirty(true);
  }
  function setLocationField(locationIndex: number, field: "address" | "city" | "postal", value: string) {
    setEditorLocations((current) => current.map((l, i) => i !== locationIndex ? l : { ...l, [field]: value }));
    setEditorDirty(true);
  }
  function addLocation() {
    setEditorLocations((current) => [...current, { ...EMPTY_LOCATION }]);
    setEditorDirty(true);
  }
  function removeLocation(locationIndex: number) {
    setEditorLocations((current) => current.length > 1 ? current.filter((_, i) => i !== locationIndex) : current);
    setEditorDirty(true);
  }
  function setItemField(itemIndex: number, field: "name" | "original" | "discounted", value: string) {
    setEditorItems((current) => current.map((it, i) => i !== itemIndex ? it : { ...it, [field]: value }));
    setEditorDirty(true);
  }
  function addItem() {
    setEditorItems((current) => [...current, { ...EMPTY_ITEM }]);
    setEditorDirty(true);
  }
  function removeItem(itemIndex: number) {
    setEditorItems((current) => current.filter((_, i) => i !== itemIndex));
    setEditorDirty(true);
  }
  function toggleKeyword(term: string) {
    setKeywords((current) =>
      current.some((k) => k.toLowerCase() === term.toLowerCase())
        ? current.filter((k) => k.toLowerCase() !== term.toLowerCase())
        : [...current, term],
    );
    setEditorDirty(true);
  }
  return (
    <>
      {/* Backdrop click-to-dismiss is a mouse-only convenience; the visible close button
          below remains the fully keyboard-accessible way to dismiss this dialog. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="overlay admin-editor-overlay"
        onMouseDown={requestEditorClose}
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
        <section
          className="modal deal-editor"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-editor-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Escape goes through the same dirty check as the close button. While the
              discard prompt is open it holds focus, so Escape is handled there instead. */}
          <DialogFocus onClose={requestEditorClose} />
          <button
            className="close"
            aria-label="Close deal editor"
            onClick={requestEditorClose}
          >
            <X />
          </button>
          <span className="kicker">
            {editor.id ? "EDIT DEAL" : "NEW DRAFT"}
          </span>
          <h2 id="deal-editor-title">{editor.id ? editor.restaurant : "Create a deal draft"}</h2>
          {/* A stepper, not tabs: the steps are buttons that swap the panel below, without the
              arrow-key roving a tablist promises. aria-current marks the step on screen. */}
          <nav className="editor-steps" aria-label="Deal editor steps">
            {EDITOR_STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-current={editorStep === i ? "step" : undefined}
                className={editorStep === i ? "active" : ""}
                disabled={isNewDraft && i > maxStep}
                onClick={() => enterStep(i)}
              >
                <span>{i + 1}</span> {label}
              </button>
            ))}
          </nav>
          {/* THE FIVE CONDITIONS FOR PUBLISHING, each its own chip and its own jump.
              The tooltip follows the chip's state. It used to be one static sentence per chip
              describing only the finished state, so a deal with no address at all was telling
              whoever hovered it that the address was "all filled in" — the reader most likely
              to hover is the one looking at a red chip and wondering what it wants. */}
          <div className="readiness-rail">
            {([
              ["Address entered", addressOk, "address",
                "Address, city and postal/ZIP are filled in.",
                "Missing an address, city or postal/ZIP. Click to fill them in."],
              ["Location verified", locationOk, "verification",
                "Somebody confirmed this address against the source — separate from typing it in.",
                "Nobody has confirmed this address yet. Click to verify it against the source."],
              ["Source URL added", sourceOk, "source_url",
                "The page this offer was taken from.",
                "No source link yet. Click to add the page this offer was taken from."],
              ["Schedule saved", scheduleOk, "schedule",
                "The days and hours this offer runs.",
                "No schedule yet. Click to set the days and hours this offer runs."],
              ["Verified", verifiedOk, "verification",
                "Checked against the source. On a single-location deal this confirms the address too.",
                "Not checked against the source yet. Click to verify it."],
            ] as const).map(([label, ok, field, whenMet, whenNot]) => (
              <button
                key={label}
                type="button"
                className={`status ${ok ? "on" : ""}`}
                title={ok ? whenMet : whenNot}
                onClick={() => jumpToField(field)}
              >
                {label}
                {/* The chip's color is the only other sign of its state. */}
                <span className="sr-only">{ok ? ": done" : ": missing"}</span>
              </button>
            ))}
          </div>
          <form ref={editorFormRef} onSubmit={handleEditorSubmit} onChangeCapture={() => setEditorDirty(true)}>
            {Object.keys(fieldErrors).length > 0 && (
              <div className="field-error-summary" role="alert">
                <b>Review the highlighted requirements:</b>
                <ul>
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <a href={`#admin-${field}`} onClick={(e) => { e.preventDefault(); jumpToField(field); }}>
                        {field.replaceAll("_", " ")}: {message}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="editor-grid" hidden={editorStep !== 0}>
              <label>
                Restaurant
                <input
                  id="admin-restaurant"
                  name="restaurant"
                  defaultValue={editor.restaurant || ""}
                  required={editorStep === 0}
                />
              </label>
              <label>
                Deal title
                <input
                  id="admin-title"
                  name="title"
                  defaultValue={editor.title || ""}
                  required={editorStep === 0}
                />
              </label>
              <label>
                Category
                <select
                  id="admin-category"
                  name="category"
                  defaultValue={editor.category || "Happy hour"}
                >
                  <option>Happy hour</option>
                  <option>Food deal</option>
                  {/* "Tonight" is worked out from the schedule now, not filed (see `tonight` in
                      app/api/deals/route.ts). Offered only to a row still holding it, so saving
                      one does not quietly re-file it as the first option, Happy hour, which the
                      alcohol filter hides outright. */}
                  {editor.category === "Tonight" && <option>Tonight</option>}
                </select>
              </label>
              <label>
                Cuisine
                <select
                  id="admin-cuisine"
                  name="cuisine"
                  defaultValue={editor.cuisine && isKnownCuisine(editor.cuisine) ? editor.cuisine : editor.cuisine ? "Other" : ""}
                  required={editorStep === 0}
                  onChange={(e) => setCuisineIsOther(e.target.value === "Other")}
                >
                  <option value="" disabled>
                    Select a cuisine
                  </option>
                  {CUISINES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {cuisineIsOther && (
                <label>
                  Specify cuisine
                  <input
                    id="admin-cuisine_other"
                    name="cuisine_other"
                    defaultValue={editor.cuisine && !isKnownCuisine(editor.cuisine) ? editor.cuisine : ""}
                    required={editorStep === 0}
                  />
                </label>
              )}
              <label>
                Price / savings
                <input
                  id="admin-price"
                  name="price"
                  defaultValue={editor.price || ""}
                  required={editorStep === 0}
                />
              </label>
              <label>
                Dining
                {/* This one field edits the RESTAURANT, not the deal. It is here because the
                    deal editor is the only place restaurants get created, and a restaurant with
                    no answer here appears under neither half of the public Fast food /
                    Sit-down filter. A new restaurant is classified automatically on save
                    (app/service-style.ts, the same rule the catalog-wide script runs), so
                    "Decide automatically" is the right default and this field is for
                    overruling it. */}
                <select
                  id="admin-service_style"
                  name="service_style"
                  defaultValue={editor.service_style === "quick" || editor.service_style === "sit_down" ? editor.service_style : ""}
                >
                  <option value="">{editor.service_style ? "Leave as is" : "Decide automatically"}</option>
                  <option value="quick">Fast food — you order at a counter</option>
                  <option value="sit_down">Sit-down — a table and a server</option>
                  {/* Distinct from the blank option above, which changes nothing: this one
                      writes NULL, the honest state for a restaurant nobody can classify. */}
                  <option value="none">Unclassified — matches neither filter</option>
                </select>
              </label>
              <label>
                Price tier
                <select id="admin-price_tier" name="price_tier" defaultValue={editor.price_tier ? String(editor.price_tier) : ""}>
                  <option value="">Not set</option>
                  {/* Three, matching the public filter row. The five-tier version asked staff to
                      tell "Moderate" from "Upscale" on a catalog whose median deal is $8.50,
                      and two of the five tiers held 32 of 310 priced deals between them. A row
                      still carrying an old 4 or 5 is narrowed to $$$ on save rather than being
                      cleared - see parsePriceTier in app/api/admin/route.ts. */}
                  <option value="1">$ — under $10</option>
                  <option value="2">$$ — $10 to $25</option>
                  <option value="3">$$$ — $25 and up</option>
                </select>
              </label>
              <div className="editor-field">
                <label htmlFor="admin-emoji">Card emoji</label>
                <EmojiPicker value={emojiValue} onChange={setEmojiValue} />
              </div>
              <div className="wide items-picker">
                <span className="schedule-picker-label">
                  Items in this deal
                  <small className="schedule-unstructured-note">
                    Optional — list what&rsquo;s actually discounted (&ldquo;Nachos: was $14, now $9&rdquo;) so shoppers see it on the deal page.
                  </small>
                </span>
                {editorItems.map((it, itemIndex) => (
                  <div className="editor-location" key={itemIndex}>
                    <label className="wide">
                      Item name
                      <input
                        value={it.name}
                        onChange={(e) => setItemField(itemIndex, "name", e.target.value)}
                        placeholder="Nachos"
                      />
                    </label>
                    <label>
                      Original price
                      <input
                        value={it.original}
                        onChange={(e) => setItemField(itemIndex, "original", e.target.value)}
                        placeholder="$14"
                      />
                    </label>
                    <label>
                      Deal price
                      <input
                        value={it.discounted}
                        onChange={(e) => setItemField(itemIndex, "discounted", e.target.value)}
                        placeholder="$9"
                      />
                    </label>
                    <button type="button" className="schedule-window-remove wide" onClick={() => removeItem(itemIndex)}>
                      Remove item
                    </button>
                  </div>
                ))}
                <button type="button" className="schedule-window-add" onClick={addItem}>
                  <Plus /> Add another item
                </button>
              </div>
            </div>
            <div className="editor-grid" hidden={editorStep !== 1}>
              <div className="wide location-picker">
                <span className="schedule-picker-label">Locations</span>
                {editorLocations.map((l, locationIndex) => (
                  <div className="editor-location" key={locationIndex}>
                    {editorLocations.length > 1 && <span className="schedule-window-label wide">Location {locationIndex + 1}</span>}
                    <label>
                      City
                      <input
                        id={locationIndex === 0 ? "admin-city" : undefined}
                        value={l.city}
                        onChange={(e) => setLocationField(locationIndex, "city", e.target.value)}
                        required={editorStep === 1}
                      />
                    </label>
                    <label>
                      Postal / ZIP code
                      <input
                        id={locationIndex === 0 ? "admin-postal_prefix" : undefined}
                        value={l.postal}
                        onChange={(e) => setLocationField(locationIndex, "postal", e.target.value)}
                        placeholder="A1A 1A1 or 90210"
                        // Accepts a full postal/ZIP, but also a bare 3-character prefix — a
                        // legacy deal's stored postal_prefix (deals.postal_prefix/full_postal
                        // fallback, see parseEditorLocations) is only ever that 3-char/3-digit
                        // prefix unless someone has since retyped the full code. Rejecting that
                        // as :invalid here used to silently break the whole "Save deal" submit
                        // whenever it was clicked from any OTHER step (the browser can't show a
                        // validation bubble for a field hidden on a different step, so it just
                        // aborts the submit with no visible error at all).
                        pattern="^([A-Za-z]\d[A-Za-z](\s?\d[A-Za-z]\d)?|\d{3}|\d{5}(-?\d{4})?)$"
                        required={editorStep === 1}
                      />
                    </label>
                    <label className="wide">
                      Address
                      <input
                        id={locationIndex === 0 ? "admin-address" : undefined}
                        value={l.address}
                        onChange={(e) => setLocationField(locationIndex, "address", e.target.value)}
                        required={editorStep === 1}
                      />
                    </label>
                    {editorLocations.length > 1 && (
                      <button type="button" className="schedule-window-remove wide" onClick={() => removeLocation(locationIndex)}>
                        Remove location
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="schedule-window-add" onClick={addLocation}>
                  <Plus /> Add another location
                </button>
              </div>
              <div className="wide schedule-picker" id="admin-schedule">
                <span className="schedule-picker-label">
                  Schedule
                  {!editor.schedule_windows?.length && !editor.schedule_days && editor.schedule && (
                    <small className="schedule-unstructured-note">
                      This deal&rsquo;s current schedule (&ldquo;{editor.schedule}&rdquo;) came in as free text from a
                      suggestion and has no days/times yet — set at least one window below.
                      {parsedFromText.length > 0 && (
                        <>
                          {" "}
                          <button type="button" className="schedule-parse-fill" onClick={fillFromScheduleText}>
                            Fill in {describeWindows(parsedFromText)}
                          </button>{" "}
                          — check it against the source before saving.
                        </>
                      )}
                    </small>
                  )}
                </span>
                {editorWindows.map((w, windowIndex) => (
                  <div className="schedule-window" key={windowIndex}>
                    {editorWindows.length > 1 && <span className="schedule-window-label">Window {windowIndex + 1}</span>}
                    <div role="group" aria-label={`Days for time window ${windowIndex + 1}`} className={`schedule-days ${w.days.length && w.start && w.end && w.start < w.end ? "filled" : editorStep === 1 ? "empty" : ""}`}>
                      {DAYS.map((day) => (
                        <label key={day.key} className="day-check">
                          <input
                            type="checkbox"
                            checked={w.days.includes(day.key)}
                            onChange={() => toggleWindowDay(windowIndex, day.key)}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                    <div className="schedule-times">
                      <label>
                        Start time
                        <input
                          id={windowIndex === 0 ? "admin-start_time" : undefined}
                          type="time"
                          value={w.start}
                          onChange={(e) => setWindowTime(windowIndex, "start", e.target.value)}
                        />
                      </label>
                      <label>
                        End time
                        <input
                          id={windowIndex === 0 ? "admin-end_time" : undefined}
                          type="time"
                          value={w.end}
                          onChange={(e) => setWindowTime(windowIndex, "end", e.target.value)}
                        />
                      </label>
                      {editorWindows.length > 1 && (
                        <button type="button" className="schedule-window-remove" onClick={() => removeWindow(windowIndex)}>
                          Remove window
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" className="schedule-window-add" onClick={addWindow}>
                  <Plus /> Add another time window
                </button>
              </div>
            </div>
            <div className="editor-grid" hidden={editorStep !== 2}>
              <label className="wide">
                Source URL
                <input
                  id="admin-source_url"
                  type="url"
                  name="source_url"
                  defaultValue={editor.source_url || ""}
                />
              </label>
              <label className="editor-check">
                <input
                  type="checkbox"
                  name="sponsored"
                  defaultChecked={!!editor.sponsored}
                />{" "}
                Sponsored placement
              </label>
              <div className="wide verify-inline">
                {editor.id ? (
                  <>
                    <button
                      type="button"
                      disabled={!sourceOk || busy === `verify-${editor.id}`}
                      title={!sourceOk ? "Add a source URL first." : undefined}
                      onClick={verifyInEditor}
                    >
                      <RefreshCw /> {verifiedOk ? "Re-verify" : "Verify"} source{editorLocationCount > 1 ? ` and confirm all ${editorLocationCount} locations` : ""}
                    </button>
                    <small>
                      {editorLocationCount > 1
                        ? "Only if the source says the deal runs at every one of them — otherwise confirm them individually below."
                        : "This also confirms the deal’s address, since it only has one location."}
                    </small>
                  </>
                ) : (
                  <small>Save this draft once to enable verification.</small>
                )}
              </div>
              {editor.id && editorLocationCount > 1 && (
                <div className="wide location-verify-list">
                  <span className="schedule-picker-label">Or confirm one address at a time</span>
                  {editor.locations!.map((l) => (
                    <div key={l.id} className="location-verify-row">
                      <span>{l.address}, {l.city}</span>
                      <span className={`status ${l.eligibility === "confirmed" ? "on" : ""}`}>{l.eligibility === "confirmed" ? "Confirmed" : "Needs review"}</span>
                      <button
                        type="button"
                        disabled={!sourceOk || busy === `verify-location-${l.id}`}
                        onClick={() => verifyLocationInEditor(l.id)}
                      >
                        <RefreshCw /> {l.eligibility === "confirmed" ? "Re-verify" : "Verify"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="editor-grid" hidden={editorStep !== 3}>
              <label>
                Lifecycle
                <select id="admin-status" name="status" defaultValue={editor.status || "draft"}>
                  <option>draft</option>
                  <option>scheduled</option>
                  <option>live</option>
                  <option>paused</option>
                  <option>expired</option>
                  <option>archived</option>
                </select>
              </label>
              {/* Local time in, local time shown; the column is UTC. See toLocalInput. */}
              <label>
                Publish at (your local time)
                <input
                  id="admin-publish_at"
                  type="datetime-local"
                  name="publish_at"
                  defaultValue={toLocalInput(editor.publish_at)}
                />
                {editorZone && <small>Time zone: {editorZone}</small>}
              </label>
              <div>
                <label>
                  Expires at (your local time)
                  <input
                    id="admin-expires_at"
                    type="datetime-local"
                    name="expires_at"
                    defaultValue={toLocalInput(editor.expires_at)}
                    disabled={noExpiration}
                  />
                  {editorZone && <small>Time zone: {editorZone}</small>}
                </label>
                <label className="editor-check inline-check">
                  <input
                    type="checkbox"
                    checked={noExpiration}
                    onChange={(e) => { setNoExpiration(e.target.checked); setEditorDirty(true); }}
                  />{" "}
                  No expiration
                </label>
              </div>
              <label className="wide">
                Terms
                <textarea name="terms" defaultValue={editor.terms || ""} />
              </label>
              <label className="wide">
                Restrictions
                <textarea
                  name="restrictions"
                  defaultValue={editor.restrictions || ""}
                />
              </label>
              <label className="wide">
                Internal notes
                <textarea
                  name="internal_notes"
                  defaultValue={editor.internal_notes || ""}
                />
              </label>
              <label className="wide">
                Curated search keywords
                <textarea
                  name="curated_keywords"
                  value={keywords.join(", ")}
                  onChange={(e) => { setKeywords(parseKeywords(e.target.value)); setEditorDirty(true); }}
                  placeholder="oysters, terrasse, date night, cocktails"
                />
                <small>Comma-separated, factual terms only. These improve search but are not displayed publicly.</small>
                {/* The restaurant's own terms, which search adds to every one of its deals
                    (drizzle/0059 filed the first: "tex-mex", "rotisserie", "brewpub"). Nothing
                    else showed them, so a term finding a deal could not be traced from here.
                    Read-only: this form saves only the deal's own terms. */}
                {editor.restaurant_keywords && <small>Also found by the restaurant&rsquo;s own terms, on all its deals: {editor.restaurant_keywords}</small>}
              </label>
              <div className="wide keyword-chips">
                {PRESET_KEYWORDS.map((preset) => {
                  const active = keywords.some((k) => k.toLowerCase() === preset.toLowerCase());
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={`chip ${active ? "active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleKeyword(preset)}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="editor-actions">
              <button type="button" onClick={() => setPreview({ ...editor })}>
                <Eye />
                Preview
              </button>
              {isNewDraft && editorStep > 0 && (
                <button type="button" onClick={() => setEditorStep((s) => s - 1)}>
                  Back
                </button>
              )}
              {isNewDraft && editorStep < EDITOR_STEPS.length - 1 && (
                <button
                  type="submit"
                  name="intent"
                  value="next"
                  className="primary"
                  disabled={busy.startsWith("save_deal-")}
                >
                  {busy.startsWith("save_deal-") ? "Saving…" : "Save & continue"}
                </button>
              )}
              {(!isNewDraft || editorStep === EDITOR_STEPS.length - 1) && (
                <button
                  type="submit"
                  name="intent"
                  value="save"
                  className="primary"
                  disabled={busy.startsWith("save_deal-")}
                >
                  {busy.startsWith("save_deal-") ? "Saving…" : isNewDraft ? "Save as draft" : "Save deal"}
                </button>
              )}
              {editor.status !== "live" && (!isNewDraft || editorStep === EDITOR_STEPS.length - 1) && (
                <button
                  type="submit"
                  name="intent"
                  value="publish"
                  className="publish-action"
                  disabled={busy.startsWith("save_deal-") || busy.startsWith("lifecycle-")}
                >
                  {isNewDraft ? "Save & publish" : "Publish"}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
      {discardDialog && <div className="overlay discard-overlay" onMouseDown={() => setDiscardDialog(false)}><section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title" onMouseDown={(event) => event.stopPropagation()}><DialogFocus onClose={() => setDiscardDialog(false)} /><button className="close" aria-label="Keep editing" onClick={() => setDiscardDialog(false)}><X/></button><span className="kicker">UNSAVED CHANGES</span><h2 id="discard-title">Discard your edits?</h2><p>Your unsaved deal changes will be lost.</p><div className="editor-actions"><button onClick={() => setDiscardDialog(false)}>Keep editing</button><button className="destructive" onClick={() => {setDiscardDialog(false);setEditorDirty(false);setEditor(null);}}>Discard changes</button></div></section></div>}{/* eslint-disable-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-dismiss is a mouse convenience; the close button above is the keyboard-accessible dismissal */}
    </>
  );
}

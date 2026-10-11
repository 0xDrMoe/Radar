"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { BRANCH_RESULT_LIMIT, indexBranches, matchBranches, type BranchOption } from "./branch-search";

// A type-to-filter branch list, for the chains where the <select> it replaces had become
// unusable — see app/branch-search.ts for the 120-option case that prompted it. Shared by the
// deal card on the homepage and the locations section of a deal page so the two cannot drift
// apart; both hand it the same `BranchOption` shape and read back a value.
//
// The list renders in flow rather than floating over the page. Both callers sit inside something
// that scrolls and clips — `.modal` is `max-height:92vh;overflow:auto` — so an absolutely
// positioned panel gets cut off exactly when the field is near the bottom of the dialog, which is
// where a picker below a fold of offer copy usually is. Pushing the content down is the less
// clever arrangement and the one that cannot be clipped.
//
// The options are not focusable. This is the ARIA combobox arrangement: focus stays in the input,
// arrow keys move `aria-activedescendant`, and Enter takes the active option. Making each row a
// real button instead would put fifty stops into the dialog's Tab cycle, and the focus trap in
// HomeClient walks exactly that list to decide where Tab wraps.
export default function BranchPicker({
  options,
  value,
  onChange,
  caption,
  note,
}: {
  options: BranchOption[];
  value: string;
  onChange: (value: string) => void;
  /** What the field is for. Composed by the caller, which owns the wording either way. */
  caption: string;
  /**
   * Quieter text after the caption — how many there are, how they are ordered. It carries its own
   * separator, because the two callers separate differently and a flex `gap` is a space the label
   * reads without: `textContent` (and a screen reader) would run "…location" straight into "14".
   */
  note?: string;
}) {
  const t = useTranslations("branchPicker");
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const indexed = useMemo(() => indexBranches(options), [options]);
  const { shown, total } = useMemo(() => matchBranches(indexed, query, BRANCH_RESULT_LIMIT), [indexed, query]);
  // Clamped on read rather than corrected in an effect: typing shortens the list under whatever
  // was active, and an effect to fix it would render the out-of-range state first.
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  function openList() {
    if (open) return;
    // Opens on the branch that is already chosen, not at the top. On a 120-branch chain the top of
    // the list is a different city.
    const at = shown.findIndex((option) => option.value === value);
    setActive(at < 0 ? 0 : at);
    setOpen(true);
  }

  function choose(option: BranchOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // The deal card's dialog listens for Escape on `document` to close itself. While this list is
      // open, Escape means the list — so it is swallowed here and a second press, with nothing left
      // to dismiss, reaches the dialog and closes the card.
      //
      // stopImmediatePropagation, not just stopPropagation, and the difference is the whole fix.
      // The App Router hydrates the entire document, so React's delegated listener sits on
      // `document` — the same node the dialog put its own keydown listener on. stopPropagation
      // stops an event moving *up* to the next ancestor; it does nothing about another listener
      // already attached to the node the event is on. The first Escape closed the list and the
      // card together, which is not what a reader who opened a list means by it.
      if (open || query) {
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        setQuery("");
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(activeIndex + step, 0), Math.max(shown.length - 1, 0)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : Math.max(shown.length - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const option = shown[activeIndex];
      if (option) choose(option);
    }
  }

  return (
    <div
      className="branch-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label className="branch-picker-caption" htmlFor={inputId}>
        {caption}
        {note && <span>{note}</span>}
      </label>
      <div className="branch-picker-field">
        <Search aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[activeIndex] ? optionId(activeIndex) : undefined}
          placeholder={t("placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <>
          <p className="branch-picker-status" role="status" aria-live="polite">
            {total === 0
              ? t("noMatches")
              : total > shown.length
                ? t("showingSome", { shown: shown.length, total })
                : t("showingAll", { count: total })}
          </p>
          <ul className="branch-picker-list" id={listId} role="listbox" aria-label={caption} ref={listRef}>
            {shown.map((option, index) => (
              /* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- an ARIA option is not a focusable control, so it has no keyboard events of its own; the keyboard path is the combobox input's onKeyDown above, which is where the pattern puts it. */
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                data-active={index === activeIndex ? "true" : undefined}
                className={index === activeIndex ? "active" : undefined}
                // Keeps focus in the input, so the wrapper's blur handler does not close the list
                // out from under the click that was about to choose something.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="branch-picker-check">{option.value === value ? <Check aria-hidden="true" /> : null}</span>
                <b>{option.label}</b>
                {option.hint && <small>{option.hint}</small>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

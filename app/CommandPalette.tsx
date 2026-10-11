"use client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  keywords?: string;
  /** Listed only once something is typed: records (a deal, a person) rather than places to go. */
  onlyWhenSearching?: boolean;
  run: () => void;
}

// The shortcut as this machine spells it. The server cannot know, so it renders "Ctrl K" and a Mac
// swaps in "⌘K" after hydrating; reading navigator during render made the two disagree on every
// page for every Mac reader, which React reports as a hydration error.
const noSubscription = () => () => {};
const clientShortcut = () => (navigator.platform?.startsWith("Mac") ? "⌘K" : "Ctrl K");
const serverShortcut = () => "Ctrl K";

// A generic Ctrl/Cmd+K launcher shared by the public site (SiteHeader) and the admin workspace
// (AdminClient) — each side just hands it a different `commands` list, so the fuzzy-match/
// keyboard-nav logic below only has to exist once instead of twice. Its words come from the caller
// too: the admin workspace is English-only, while the public header passes its translations.
export default function CommandPalette({
  commands,
  placeholder,
  noMatches = "No matches",
  limit,
  triggerLabel,
}: {
  commands: Command[];
  placeholder: string;
  noMatches?: string;
  /** At most this many matches are listed, so a long list of records stays quick to scan. */
  limit?: number;
  /** Draws the trigger as a search box with this text, instead of an icon. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Whether closing should hand focus back to the trigger: yes when the palette is dismissed, no
  // when a command ran, since the command decides where the reader goes next.
  const returnFocus = useRef(false);
  const listId = useId();
  const shortcut = useSyncExternalStore(noSubscription, clientShortcut, serverShortcut);

  function openPalette() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => {
          if (prev) return false;
          setQuery("");
          setActive(0);
          return true;
        });
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Purely an imperative DOM action (focusing the input once it mounts) — no setState here, so
  // this doesn't trigger the cascading-render effect warning that resetting query/active would.
  useEffect(() => {
    if (open) {
      returnFocus.current = true;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = !needle
      ? commands.filter((command) => !command.onlyWhenSearching)
      : commands.filter((command) => `${command.label} ${command.keywords || ""}`.toLowerCase().includes(needle));
    return limit ? matches.slice(0, limit) : matches;
  }, [commands, query, limit]);

  function choose(command: Command) {
    returnFocus.current = false;
    setOpen(false);
    command.run();
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); const command = filtered[active]; if (command) choose(command); }
    // The options are reached with the arrow keys, so Tab has nowhere inside the dialog to go and
    // would otherwise walk out into the page behind it.
    else if (event.key === "Tab") event.preventDefault();
  }

  if (!open) return (
    triggerLabel ? (
      <button ref={triggerRef} type="button" className="command-trigger command-search-box" onClick={openPalette} aria-label={placeholder} title={placeholder}>
        <Search /><span className="command-search-label">{triggerLabel}</span><span className="command-trigger-key">{shortcut}</span>
      </button>
    ) : (
      <button ref={triggerRef} type="button" className="command-trigger" onClick={openPalette} aria-label={placeholder} title={placeholder}>
        <Search /><span className="command-trigger-key">{shortcut}</span>
      </button>
    )
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- clicking the dimmed backdrop to dismiss is a mouse convenience; Escape already handles the keyboard case above
    <div className="command-overlay" onClick={() => setOpen(false)}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- stops the backdrop's dismiss-click from bubbling up from inside the panel; Escape already handles the keyboard case */}
      <div className="command-panel" role="dialog" aria-modal="true" aria-label={placeholder} onClick={(e) => e.stopPropagation()}>
        <div className="command-search">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
          />
        </div>
        <ul className="command-list" role="listbox" id={listId} aria-label={placeholder}>
          {filtered.length === 0 && <li className="command-empty" role="none">{noMatches}</li>}
          {filtered.map((command, index) => (
            <li key={command.id} role="none">
              <button
                type="button"
                id={`${listId}-${command.id}`}
                tabIndex={-1}
                role="option"
                aria-selected={index === active}
                className={index === active ? "active" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(command)}
              >
                {command.icon}
                <span>{command.label}</span>
                {command.hint && <small>{command.hint}</small>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

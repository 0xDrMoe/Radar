"use client";
import { useCallback, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

// THE SIDEBAR'S SIZE.
// Wide screens only: under 1000px the sidebar is already an icon rail, and under 700px a tab rail
// (portal.css, refinements.css), so the handle and the toggle are hidden there by CSS and the
// stored choices simply wait for a wider window.
//
// Both choices are this browser's, kept in localStorage: they are about one screen, not one person,
// and a laptop and a desktop monitor want different widths. Storage can be missing or refuse
// (private windows, blocked site data); the sidebar then opens at its default and still works.

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 250;
/** One arrow-key press on the handle. */
export const SIDEBAR_STEP = 16;

const WIDTH_KEY = "radar.staff.sidebar.width";
const COLLAPSED_KEY = "radar.staff.sidebar.collapsed";

/** A usable width from anything: a stored string, a drag position, garbage. */
export function clampSidebarWidth(value: unknown): number {
  const width = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

function readStored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered next time; nothing else depends on it.
  }
}

export function useStaffSidebar() {
  // Read once, on the first render in the browser. The workspace renders only its loading state
  // until its data arrives from the browser's own fetch, so the server never draws the sidebar and
  // there is no server markup for these values to disagree with.
  const [width, setWidthState] = useState(() => clampSidebarWidth(readStored(WIDTH_KEY) ?? SIDEBAR_DEFAULT));
  const [collapsed, setCollapsedState] = useState(() => readStored(COLLAPSED_KEY) === "1");
  /** `persist` is false while a drag is still moving, so storage is written once, where it ends. */
  const setWidth = useCallback((next: number, persist = true) => {
    const clamped = clampSidebarWidth(next);
    setWidthState(clamped);
    if (persist) writeStored(WIDTH_KEY, String(clamped));
  }, []);
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeStored(COLLAPSED_KEY, next ? "1" : "0");
  }, []);
  return { width, setWidth, collapsed, setCollapsed };
}

/**
 * The handle on the sidebar's right edge. Drag it, or focus it and use the arrow keys (Home and End
 * for the narrowest and widest); a double-click puts it back to the default width. A focusable
 * separator is the ARIA pattern for exactly this, and it reads its width as a value in pixels.
 */
export function SidebarResizer({ width, onWidth }: { width: number; onWidth: (next: number, persist?: boolean) => void }) {
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("sw-resizing");
    const move = (moved: PointerEvent) => onWidth(startWidth + moved.clientX - startX, false);
    const end = (ended: PointerEvent) => {
      onWidth(startWidth + ended.clientX - startX, true);
      document.body.classList.remove("sw-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === "ArrowLeft" ? width - SIDEBAR_STEP
      : event.key === "ArrowRight" ? width + SIDEBAR_STEP
        : event.key === "Home" ? SIDEBAR_MIN
          : event.key === "End" ? SIDEBAR_MAX
            : null;
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  }
  return (
    // A focusable separator is a widget (WAI-ARIA window splitter), which is why it takes focus and
    // keys; the lint rule reads every separator as static.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="sw-aside-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see above: a focusable separator is a widget
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(SIDEBAR_DEFAULT)}
    />
  );
}

/** Collapses the sidebar to its icons, and back. The labels stay in the links for screen readers. */
export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Expand the sidebar" : "Collapse the sidebar to icons";
  return (
    <button type="button" className="sw-aside-toggle" aria-label={label} title={label} onClick={onToggle}>
      {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
      <span>Collapse sidebar</span>
    </button>
  );
}

"use client";
import { Info } from "lucide-react";

/**
 * A small "i" whose explanation appears on hover and on focus.
 *
 * `role="button"` with `tabIndex={0}` rather than a real `<button>`: this sits inside running text
 * and inside a `<p>`, where a button's own baseline and default styling fight the line it is part
 * of. What matters is that it is reachable by keyboard and announced, which the role and tabindex
 * give it — and that the text is on `aria-label` as well as in the bubble, because a tooltip that
 * only exists on hover is invisible to a screen reader and to a touch device.
 *
 * Styling lives in app/enhancements.css (.info-tip / .tooltip-bubble), which reveals the bubble on
 * :hover, :focus and :focus-visible — the plain :focus is what makes a tap on a phone work. Hidden,
 * the bubble is display:none rather than invisible: an invisible 230px box still widened the page
 * whenever an icon sat near the right edge, and /pro scrolled sideways on a phone. On a phone it
 * opens along the bottom of the screen, where it cannot run off either side.
 *
 * A client component only for Escape: a bubble that appears on focus has to be dismissible without
 * moving focus (WCAG 1.4.13), and on a phone it covers the bottom of the screen. Blurring hides it
 * through the same :focus rule that showed it.
 */
export default function InfoTip({ text }: { text: string }) {
  return <span className="info-tip" role="button" tabIndex={0} aria-label={text} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}>
    <Info aria-hidden="true"/>
    <span className="tooltip-bubble" role="tooltip">{text}</span>
  </span>;
}

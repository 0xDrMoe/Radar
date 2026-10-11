"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MAIN_CONTENT_ID } from "./main-content";

// Tells assistive technology that a client-side navigation opened another page.
//
// A page load is announced by the browser itself: a screen reader hears the new document's title
// and starts reading from the top. A client-side navigation is not a page load. The page's content
// and title change under the reader with nothing said, and focus is left on the link that was
// clicked, or on <body> once React has replaced it. Next.js's App Router mounts a route announcer
// for this; vinext (1.0.0-beta.8) has none, so the app mounts its own, once, in RootShell.
//
// It matters for signed-in readers above all: their site-chrome links and the palette's commands
// are client-side navigations (app/ChromeLink.tsx), as the dashboard's section rail and the
// operator workspaces' links are for everyone who uses them. A signed-out reader's chrome links are
// page loads, which this never sees: it does nothing on the first render of a document.
//
// On a change of path (not of query: the home page writes its search into the address with
// history.pushState, which is not another page) it waits for the new page to show, says what it
// is in a polite live region, and moves focus to the new page's <main>, as a page load would start
// the reader there, without scrolling: the router has already placed the page (top, or where Back
// left it). Not when the address names a place on the page: the browser's own move to that anchor
// stands. The region is in the document from the first render, empty, because a live region added
// at the moment it speaks is not reliably heard.
//
// What it says is the new title, which is what Next.js's announcer says too, or, where the title
// has not changed, the page's <h1>: the dashboard's sections share one title ("My dashboard") and
// differ by their heading. Either one changing is the sign the new page has committed, and it is
// waited for a frame at a time, because vinext's usePathname follows the address, which can move
// before the page does. A heading that has gone is not one that changed: between two sections the
// dashboard shows its loading card, which has none, and focus moved to that card's <main> was lost
// when the section replaced it. A page that changes neither is announced by its title after two
// seconds.
const SETTLE_MS = 2000;

// The page's heading as a screen reader has it: without what is hidden from one. The home page's
// <h1> types and deletes its first word in an aria-hidden span many times a second, beside a
// steady copy for screen readers; read whole, it would look like a new page on every keystroke.
function heading(): string {
  const h1 = document.querySelector(`#${MAIN_CONTENT_ID} h1, main h1, h1`);
  if (!h1) return "";
  const copy = h1.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

export default function RouteAnnouncer() {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const shown = useRef<{ pathname: string | null; title: string; heading: string } | null>(null);

  useEffect(() => {
    // The first render of a document: remember what it is, say nothing.
    if (!shown.current) {
      shown.current = { pathname, title: document.title, heading: heading() };
      return;
    }
    if (shown.current.pathname === pathname) return;
    const before = { ...shown.current };
    shown.current = { ...before, pathname };
    const started = performance.now();
    let frame = 0;
    const settle = () => {
      const title = document.title, h1 = heading();
      if (title === before.title && (!h1 || h1 === before.heading) && performance.now() - started < SETTLE_MS) {
        frame = requestAnimationFrame(settle);
        return;
      }
      shown.current = { pathname, title, heading: h1 };
      setMessage((title !== before.title ? title : h1 || title) || pathname || "");
      if (!location.hash) {
        const main = document.getElementById(MAIN_CONTENT_ID) ?? document.querySelector("main");
        if (main instanceof HTMLElement) {
          // The operator workspaces' <main> is not focusable of its own accord; the public pages'
          // already carries tabIndex -1 for the skip link.
          if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
          main.focus({ preventScroll: true });
        }
      }
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-route-announcer="">{message}</p>;
}

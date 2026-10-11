"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

// Shared external-store plumbing for prefers-reduced-motion: useSyncExternalStore keeps the
// initial client render consistent with the server (getServerSnapshot always returns false, so
// there's no hydration mismatch) while still reacting to the media query changing after mount —
// without needing a setState call inside an effect body.
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function getReducedMotionServerSnapshot() {
  return false;
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

// Types out each phrase in `phrases`, holds it, deletes it, then moves to the next — looping
// forever. Returns the current partial string; callers render their own cursor/decoration (a
// native <input placeholder> can't render one, and a button's decorative text needs its own
// aria-hidden span, so there's no one right place to draw it here). Freezes on the first phrase
// for prefers-reduced-motion instead of animating, matching the reduced-motion handling already
// used for CSS animations elsewhere in this app (see polish.css).
//
// `paused` stops it where it is, showing the whole of the current phrase rather than the half-typed
// word it was on, and resuming carries on from there. It exists for the reader's pause control:
// text that keeps changing for longer than five seconds has to be stoppable (WCAG 2.2.2), and
// reduced motion is a system setting most people who are distracted by it have never heard of.
export function useTypewriter(phrases: string[], options: { typeMs?: number; deleteMs?: number; holdMs?: number; paused?: boolean } = {}) {
  const { typeMs = 55, deleteMs = 28, holdMs = 1600, paused = false } = options;
  // Starts already showing the first phrase in full — matching the server-rendered HTML exactly
  // (no flash of an empty placeholder/button before hydration) — and only types-from-scratch
  // once it cycles back around after deleting.
  const [text, setText] = useState(phrases[0] || "");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const reducedMotion = useReducedMotion();
  // Pausing completes the word on screen, so resuming has to start from the completed word too, or
  // it would jump back to the fragment it was paused on. Adjusted during render, when the flag
  // changes, rather than in an effect.
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (paused && phrases.length) {
      setText(phrases[phraseIndex % phrases.length]);
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!phrases.length || reducedMotion || paused) return;
    const current = phrases[phraseIndex % phrases.length];
    let delay = deleting ? deleteMs : typeMs;
    if (!deleting && text === current) delay = holdMs;
    else if (deleting && text === "") delay = 80;
    const timer = setTimeout(() => {
      if (!deleting) {
        if (text === current) { setDeleting(true); return; }
        setText(current.slice(0, text.length + 1));
      } else {
        if (text === "") { setDeleting(false); setPhraseIndex((i) => (i + 1) % phrases.length); return; }
        setText(current.slice(0, text.length - 1));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [text, deleting, phraseIndex, phrases, typeMs, deleteMs, holdMs, reducedMotion, paused]);

  if (reducedMotion) return phrases[0] || "";
  return paused && phrases.length ? phrases[phraseIndex % phrases.length] : text;
}

// Same type/hold/delete/loop behavior as useTypewriter, but only for the very first cycle: it types
// `intro` in full, holds, then deletes it completely. Every cycle after that starts from `prefix` —
// which is typed once on the way in and then never deleted again — and only the text after it (each
// entry in `queries`) cycles. Lets a placeholder like "Try "sushi happy hour"" keep "Try " on screen
// permanently instead of retyping it before every example.
export function useTypewriterAfterIntro(
  intro: string,
  prefix: string,
  queries: string[],
  options: { typeMs?: number; deleteMs?: number; holdMs?: number; paused?: boolean } = {},
) {
  const { typeMs = 55, deleteMs = 28, holdMs = 1600, paused = false } = options;
  const [text, setText] = useState(intro);
  const [stage, setStage] = useState<"intro" | "query">("intro");
  const [queryIndex, setQueryIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const reducedMotion = useReducedMotion();
  // Paused, it shows what reduced motion shows - the intro, which reads as the field's label - and
  // resumes from there rather than from whichever half-typed example it was stopped on.
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (paused) {
      setText(intro);
      setStage("intro");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!queries.length || reducedMotion || paused) return;
    const target = stage === "intro" ? intro : prefix + queries[queryIndex % queries.length];
    const floor = stage === "intro" ? 0 : prefix.length;
    let delay = deleting ? deleteMs : typeMs;
    if (!deleting && text === target) delay = holdMs;
    else if (deleting && text.length === floor) delay = 80;
    const timer = setTimeout(() => {
      if (!deleting) {
        if (text === target) { setDeleting(true); return; }
        setText(target.slice(0, text.length + 1));
      } else {
        if (text.length === floor) {
          setDeleting(false);
          if (stage === "intro") setStage("query");
          else setQueryIndex((i) => (i + 1) % queries.length);
          return;
        }
        setText(text.slice(0, text.length - 1));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [text, stage, deleting, queryIndex, intro, prefix, queries, typeMs, deleteMs, holdMs, reducedMotion, paused]);

  return reducedMotion || paused ? intro : text;
}

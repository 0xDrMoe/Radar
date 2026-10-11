"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type TurnstileRenderOptions = {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// One script for the whole page, however many widgets ask for it: every caller shares the first
// one's promise rather than adding another <script>. The promise is kept rather than the element
// looked up again, because a script that has already failed never fires another event, and a
// second form waiting on it would sit out the whole token timeout for nothing. A failure clears the
// promise, so the next attempt (the visitor retrying after a flaky network) loads it afresh.
let scriptLoad: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoad = null;
      reject(new Error("turnstile-script"));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

// Interaction-only: the check runs either way, and the widget shows itself only when Cloudflare
// actually wants a visitor to click something. Always-visible, the home page carried two identical
// "Verify you are human" boxes under two one-field email forms, which is most of what either form
// looked like.
//
// The widget writes its token into a hidden `cf-turnstile-response` input inside the container, so
// it rides along in the surrounding <form>'s FormData; `onToken` reports the same token to a caller
// that would rather wait for it than read it.
function TurnstileWidget({
  siteKey,
  onToken,
  onUnavailable,
  widgetIdRef,
}: {
  siteKey: string;
  onToken?: (token: string | null) => void;
  onUnavailable?: () => void;
  widgetIdRef: React.RefObject<string | undefined>;
}) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let widgetId: string | undefined;
    let canceled = false;
    loadTurnstileScript().then(
      () => {
        if (canceled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token) => onToken?.(token),
          "expired-callback": () => onToken?.(null),
        });
        widgetIdRef.current = widgetId;
      },
      // Blocked by an extension or a network that refuses Cloudflare. Nobody waiting on a token
      // should wait out the whole timeout for one that cannot come.
      () => { if (!canceled) onUnavailable?.(); },
    );
    return () => {
      canceled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      widgetIdRef.current = undefined;
    };
  }, [siteKey, onToken, onUnavailable, widgetIdRef]);
  return <div ref={containerRef} id={`turnstile-${id}`} className="turnstile-widget" />;
}

// Renders a Cloudflare Turnstile challenge as soon as it mounts. Used where the form itself only
// exists after somebody asked for it - the suggest and feedback modals, the creator application -
// so mounting is already a sign of intent. If no site key is configured (see wrangler.jsonc), this
// renders nothing and the form submits exactly as it did before this existed.
//
// A token is good for one siteverify call, and the routes verify it before they validate anything
// else (app/api-utils.ts verifyTurnstile), so a submit the server then turns back for a missing
// field has already spent it. Without a reset the corrected resubmit carried the same token and
// came back "Please complete the verification", which was never the problem. The reset waits a
// tick so the submit handler has read the token out of the form first.
export default function Turnstile({ siteKey }: { siteKey?: string }) {
  const widgetId = useRef<string | undefined>(undefined);
  const anchorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = anchorRef.current?.closest("form");
    if (!siteKey || !form) return;
    const renew = () => setTimeout(() => {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    }, 0);
    form.addEventListener("submit", renew);
    return () => form.removeEventListener("submit", renew);
  }, [siteKey]);
  if (!siteKey) return null;
  return (
    <>
      <span ref={anchorRef} hidden />
      <TurnstileWidget siteKey={siteKey} widgetIdRef={widgetId} />
    </>
  );
}

// How long a submit waits for the challenge to finish. Long enough for somebody to answer the
// checkbox the widget shows when Cloudflare wants an interaction; past that the form sends what it
// has and the server's refusal says what went wrong.
const TOKEN_WAIT_MS = 60_000;

/**
 * Turnstile for a form most visitors never touch: nothing loads until somebody does.
 *
 * The home page's two lead forms (the app waitlist and the deal digest) used to mount a widget each
 * on page load. Interaction-only still runs the full challenge, so every visit to the home page
 * fetched challenges.cloudflare.com twice - two widget documents and two challenge payloads, about
 * 1.36 MB of the page's 2.6 MB in Lighthouse - for two email boxes nearly nobody fills in.
 *
 * Now the form calls `arm` when it is first focused or pressed, and only then does the widget
 * render (both forms share the one script load above). The challenge runs while the visitor types
 * their address, so by the time they press the button the token is almost always waiting. When it
 * is not - a fast Enter, a slow network, a challenge that wants a click - `takeToken` waits for it
 * rather than sending the form without one.
 *
 * Server-side nothing changes: the token still arrives as `cf-turnstile-response` in the JSON body
 * and app/api/email/capture verifies it exactly as before. `takeToken` hands each token out once
 * and resets the widget behind it, because siteverify accepts a token only once and a second
 * submit of the same form needs a fresh one.
 */
export function useLazyTurnstile(siteKey?: string) {
  const [armed, setArmed] = useState(false);
  const widgetId = useRef<string | undefined>(undefined);
  const token = useRef<string | null>(null);
  const waiting = useRef<Array<(value: string | null) => void>>([]);

  const settle = useCallback((value: string | null) => {
    const waiters = waiting.current;
    waiting.current = [];
    for (const resolve of waiters) resolve(value);
  }, []);
  const onToken = useCallback((value: string | null) => {
    token.current = value;
    if (value) settle(value);
  }, [settle]);
  const onUnavailable = useCallback(() => settle(null), [settle]);

  const arm = useCallback(() => setArmed(true), []);

  const takeToken = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    setArmed(true);
    const value = token.current ?? await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        waiting.current = waiting.current.filter((entry) => entry !== done);
        resolve(null);
      }, TOKEN_WAIT_MS);
      const done = (result: string | null) => { clearTimeout(timer); resolve(result); };
      waiting.current.push(done);
    });
    token.current = null;
    if (value && widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    return value || undefined;
  }, [siteKey]);

  const widget = siteKey && armed
    ? <TurnstileWidget siteKey={siteKey} onToken={onToken} onUnavailable={onUnavailable} widgetIdRef={widgetId} />
    : null;
  return { arm, widget, takeToken };
}

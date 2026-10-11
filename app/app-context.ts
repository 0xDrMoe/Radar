// The website, opened from inside the iOS app.
//
// Apple lets an app point to another way to buy only on the United States storefront (App Review
// Guidelines 3.1.1(a) and 3.1.3). Everywhere else - Canada, the app's main market - nothing the app
// leads to may offer a purchase that is not an in-app purchase. The app opens radar.cheap in an
// in-app browser, and nearly every page here carries a way to buy Radar Pro: the header's Pro link,
// the footer's, the badges beside locked controls, the dashboard's upgrade prompts, /pro itself.
//
// So the app opens every page with `from=ios_app&sf=<its App Store storefront>` (see
// mobile/lib/links.ts), and APP_CONTEXT_SCRIPT remembers that for the rest of the browser tab.
// Unless the storefront is "USA", every purchase control on every page in that tab is hidden, and
// stays hidden as the reader moves around the site, until the in-app browser is closed. A missing
// or unknown storefront hides them too: guessing wrong in the permissive direction is a rejection,
// and in the other it costs a button.
//
// Hidden before the first paint, not after React hydrates. The script runs inline at the top of the
// page body (app/[locale]/layout.tsx), before anything below it is parsed, and puts a class on
// <html>; the stylesheet then hides everything marked `purchase-cta` (app/globals.css). A button
// that showed for the half second before hydration would still be a button a reviewer can tap.
// purchaseHidden() below is the same answer for code: the handlers that start a purchase ask it
// before doing anything.
//
// Remembered in sessionStorage, which belongs to one tab. The in-app browser's tab ends when it is
// closed, and a reader's own Safari or Chrome is never affected unless it was opened with the tag.

export const APP_CONTEXT_KEY = "radar:app-context";
export const NO_PURCHASE_CLASS = "app-no-purchase";

/** "ios" is the app on a storefront that may not link out; "ios-us" is the app in the US. */
export type AppContext = "ios" | "ios-us";

// Plain ES5 in a string, because it runs before any bundle has loaded. A tagged URL decides on its
// own, whether or not storage works - a browser refusing sessionStorage must not be the thing that
// shows a Canadian reader a Stripe button.
export const APP_CONTEXT_SCRIPT =
  `(function(){try{var q=new URLSearchParams(location.search),c=null;` +
  `if(q.get("from")==="ios_app"){c=q.get("sf")==="USA"?"ios-us":"ios";try{sessionStorage.setItem("${APP_CONTEXT_KEY}",c)}catch(e){}}` +
  `else{try{c=sessionStorage.getItem("${APP_CONTEXT_KEY}")}catch(e){}}` +
  `if(c==="ios")document.documentElement.classList.add("${NO_PURCHASE_CLASS}")}catch(e){}})();`;

/** Where this tab came from, or null when it was not opened by the app. */
export function appContext(): AppContext | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(APP_CONTEXT_KEY);
    return value === "ios" || value === "ios-us" ? value : null;
  } catch {
    return null;
  }
}

/** Whether this tab must not offer a way to buy Pro. False on the server, which cannot know. */
export function purchaseHidden(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(NO_PURCHASE_CLASS) || appContext() === "ios";
}

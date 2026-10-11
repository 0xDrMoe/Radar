import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The four billing surfaces on the dashboard - the declined-card banner, the pause banner, the
// cancellation survey and the save offer - all sit behind a sign-in and a subscription in a
// particular state, so none of them can be reached by opening the site. That is exactly why they
// are checked here: everything that would otherwise be found by looking at the page.
//
// What this file can prove is that every string exists in every language, every class has a rule
// behind it, and each surface is gated on the condition it claims to be. What it cannot prove is
// how any of it looks. That still needs somebody signed in to a real past_due subscription.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
// The plan, its controls and the cancellation flow have their own section since the dashboard was
// split into one file per section.
const BILLING_SECTION = "../app/[locale]/dashboard/sections/BillingSection.tsx";
const LOCALES = ["en", "fr", "es"];

// Every account.* key the billing surfaces render.
const BILLING_KEYS = [
  "paymentFailedTitle", "paymentFailedBody", "paymentFailedDays", "paymentFailedAction",
  "pausedTitle", "pausedBody", "pausedAction", "pausedResumed",
  "cancelPlan", "cancelTitle", "cancelAnytime", "cancelPrompt", "cancelDetail", "cancelKeep", "cancelContinue", "cancelThanks",
  "cancelReasonPrice", "cancelReasonDeals", "cancelReasonUnused", "cancelReasonMissing", "cancelReasonTemporary", "cancelReasonOther",
  "offerPauseTitle", "offerPauseBody", "offerPauseMonths", "offerPauseTerms", "offerPauseConfirm", "offerPaused", "offerPausedNextCharge",
  "offerDiscountTitle", "offerDiscountBody", "offerDiscountOnce", "offerDiscountRepeating", "offerDiscountForever", "offerDiscountConfirm", "offerDiscounted",
  "offerFeedbackTitle", "offerFeedbackBody", "offerFeedbackConfirm", "offerFeedbackSent",
  "offerNoThanks",
  "manageBilling", "billedByAppStore", "manageInAppStore",
];

test("every billing string exists in every language", async () => {
  for (const locale of LOCALES) {
    const messages = JSON.parse(await read(`../messages/${locale}.json`));
    for (const key of BILLING_KEYS)
      assert.ok(messages.dashboard.account[key], `${locale} is missing dashboard.account.${key}`);
  }
});

test("interpolated billing strings keep their placeholders", async () => {
  // A locale that drops {days} renders "to update it before the subscription ends" with no number
  // in it, which reads as a threat with no deadline. Missing placeholders do not throw, so they
  // have to be asserted.
  // The save offers' terms are the point of the offer: a pause that drops {charge} or a discount
  // that drops {discount} is asking somebody to agree to terms it no longer states.
  const required = {
    paymentFailedDays: ["days"], pausedBody: ["date"], offerPaused: ["date"], offerPauseMonths: ["months"],
    offerPauseTerms: ["resumes", "charge"], offerPausedNextCharge: ["date"],
    offerDiscountOnce: ["discount"], offerDiscountRepeating: ["discount", "months"], offerDiscountForever: ["discount"],
  };
  for (const locale of LOCALES) {
    const messages = JSON.parse(await read(`../messages/${locale}.json`));
    for (const [key, placeholders] of Object.entries(required))
      for (const placeholder of placeholders)
        assert.match(messages.dashboard.account[key], new RegExp(`\\{${placeholder}`), `${locale} dropped {${placeholder}} from ${key}`);
  }
});

test("each billing surface is gated on the condition it claims", async () => {
  const source = await read(BILLING_SECTION);
  // The declined-card banner follows the same helper the entitlement does, rather than testing
  // plan_status inline - two places deciding "is this card failing" is how they drift.
  assert.match(source, /const paymentFailing = isPaymentFailing\(p\.plan_status\);/);
  assert.match(source, /\{paymentFailing && <div className="billing-alert" role="status">/);
  // A pause is not a lapse: its own banner, and the cancel link is hidden while one is running so
  // nobody cancels something that is already not being billed. The link also needs a web
  // subscription to cancel (billingControls, tested below).
  assert.match(source, /const paused = isPaused\(p\.paused_until\);/);
  assert.match(source, /\{paused && <div className="billing-alert paused" role="status">/);
  assert.match(source, /\{controls\.cancel && <div className="appearance-row">/);
  // The days remaining are computed from the stamp, never written as a number in copy - the
  // window is GRACE_DAYS and changing it must not need a translator.
  assert.match(source, /graceDaysLeft\(p\.past_due_since\)/);
});

test("billing controls follow what bills the account, not whether it is on Pro", async () => {
  // Every one of Stripe's controls dead-ended for an App Store subscriber and for a comp: the
  // portal answered "You do not have a billing account yet", and the survey recorded a reason for
  // cancelling a subscription that did not exist.
  const { billingControls } = await import("../app/billing-controls.ts");
  const controls = (state) => billingControls({ pro: true, paused: false, billing: null, webSubscription: false, ...state });
  const none = { manage: false, cancel: false, appStore: false, upgrade: false };
  // A web subscriber has Stripe's controls, and a declined card inside its grace window still does.
  assert.deepEqual(controls({ billing: "stripe", webSubscription: true }), { ...none, manage: true, cancel: true });
  // An App Store subscriber is told where theirs is managed and offered nothing that opens Stripe.
  assert.deepEqual(controls({ billing: "apple" }), { ...none, appStore: true });
  // A comp is on Radar Pro and has nothing to manage.
  assert.deepEqual(controls({}), none);
  // Paying twice is billed to Apple first, and the web subscription can still be managed and
  // canceled. That is why Stripe's controls ask for a web subscription and not for billing "stripe".
  assert.deepEqual(controls({ billing: "apple", webSubscription: true }), { manage: true, cancel: true, appStore: true, upgrade: false });
  // Paused: not Pro while it lasts, and paying nobody, but still a subscription. Its banner resumes
  // it, and nothing sells a second subscription beside it.
  assert.deepEqual(controls({ pro: false, paused: true, webSubscription: true }), none);
  // Free, with nothing behind it: the one place the upgrade pitch belongs.
  assert.deepEqual(controls({ pro: false }), { ...none, upgrade: true });
});

test("each billing control is drawn from that decision", async () => {
  const source = await read(BILLING_SECTION);
  assert.match(source, /const controls = billingControls\(\{ pro, paused, billing: p\.billing, webSubscription: p\.web_subscription \}\);/);
  assert.match(source, /\{controls\.manage && <button disabled=\{busy === "billing"\} onClick=\{\(\) => manageBilling\(\)\}>\{t\("account\.manageBilling"\)\}<\/button>\}/);
  assert.match(source, /\{controls\.upgrade && <button className="primary purchase-cta"/);
  assert.match(source, /\{controls\.appStore && <p className="billing-note">\{t\("account\.billedByAppStore"\)\} <a href="https:\/\/apps\.apple\.com\/account\/subscriptions" target="_blank" rel="noreferrer noopener">/);
  // Nothing opens Stripe on `pro` alone any more.
  assert.doesNotMatch(source, /\{pro \? <button disabled=\{busy === "billing"\}/);
  assert.doesNotMatch(source, /\{pro && !paused && <div className="appearance-row">/);
  // The declined-card banner is Stripe's own past_due and stays as it was. Only Stripe writes that
  // status, so it needs no second condition.
  assert.match(source, /\{paymentFailing && <div className="billing-alert" role="status">[^]*?onClick=\{\(\) => manageBilling\(\)\}>\{t\("account\.paymentFailedAction"\)\}/);
});

test("a cancellation reason is recorded only against a subscription that exists", async () => {
  // The survey is reachable only through the cancel link, and the link only for a web subscription.
  // The server checks again, because a Stripe customer id outlives the subscription it paid for.
  const route = await read("../app/api/stripe/retention/route.ts");
  const survey = route.slice(route.indexOf('step === "survey"'), route.indexOf('step === "accept"'));
  const guard = survey.indexOf("stripeOwnsStatus(");
  const insert = survey.indexOf("INSERT INTO cancellation_reasons");
  assert.ok(guard !== -1 && insert !== -1, "the survey step no longer checks for a subscription before recording a reason");
  assert.ok(guard < insert, "the subscription should be checked before the reason is recorded");
  assert.match(survey, /apiError\(409, "NO_SUBSCRIPTION", "There is no subscription to cancel\."\)/);
});

test("the save offer replaces the survey rather than appearing beside it", async () => {
  const source = await read(BILLING_SECTION);
  // One decision on screen at a time. Enforced in the render rather than only by remembering to
  // clear the flag in a handler, which is how both ended up on screen together.
  assert.match(source, /\{canceling && !saveOffer\?\.offer && <div className="cancel-survey">/);
  assert.match(source, /\{saveOffer\?\.offer && <div className="cancel-survey save-offer">/);
  const submit = source.slice(source.indexOf("async function submitSurvey"), source.indexOf("async function goToPortal"));
  assert.match(submit, /setCanceling\(false\)/);
});

test("the offer shown is the server's answer, never the browser's request", async () => {
  const client = await read(BILLING_SECTION);
  // The browser sends the reason and is told which offer to show. If it chose, anybody could
  // read the code, post `offer: "discount"` and take a discount that was never offered.
  const accept = client.slice(client.indexOf("async function acceptOffer"), client.indexOf("async function resumeSubscription"));
  assert.match(accept, /retention\(\{ step:"accept", offer, months: pauseMonths \}\)/);

  const route = await read("../app/api/stripe/retention/route.ts");
  assert.match(route, /offerForReason\(/);
  // And the accept step checks the offer was actually made, rather than applying whatever the
  // request names. Without this, {step:"accept", offer:"discount"} is a self-serve discount.
  const acceptStep = route.slice(route.indexOf('step === "accept"'), route.indexOf('step === "decline"'));
  assert.match(acceptStep, /SELECT id FROM save_offers WHERE user_id=\? AND offer=\? AND accepted=0/);
  assert.match(acceptStep, /OFFER_NOT_OPEN/);
});

test("declining a save offer always reaches the billing portal", async () => {
  // The one path that must never dead-end: somebody who has decided to cancel and been shown an
  // offer they do not want has to end up somewhere they can actually cancel.
  const route = await read("../app/api/stripe/retention/route.ts");
  const decline = route.slice(route.indexOf('step === "decline"'));
  assert.match(decline, /billingPortal|portal/i);
  assert.match(decline, /url/);
});

test("every class the billing surfaces use has a rule behind it", async () => {
  const styles = (await Promise.all(
    ["../app/portal.css", "../app/polish.css", "../app/dashboard-visuals.css", "../app/enhancements.css", "../app/pro.css"].map(read),
  )).join("\n");
  for (const className of [
    "billing-alert",
    "billing-note",
    "cancel-survey",
    "save-offer",
    "cancel-reasons",
    "cancel-actions",
    "linklike",
    "sponsor-status",
  ]) assert.ok(styles.includes(`.${className}`), `.${className} has no styles`);
  // The paused variant is a modifier on billing-alert, so it needs its own rule or a pause looks
  // identical to a declined card.
  assert.match(styles, /\.billing-alert\.paused/);
});

test("the dunning window in the comments matches the constant", async () => {
  // This comment claimed Stripe retried for three weeks long after the window was cut to three
  // days. A number written into prose beside code is the one that goes stale silently.
  const entitlement = await read("../app/entitlement.ts");
  const days = Number(entitlement.match(/export const GRACE_DAYS = (\d+);/)[1]);
  assert.equal(days, 3);
  const client = await read(BILLING_SECTION);
  assert.doesNotMatch(client, /retries for about three weeks/);
  assert.match(client, /retries once a day for three days/);
});

test("a save offer states its terms on screen", async () => {
  // An offer without its numbers asks somebody to agree to terms they cannot see. The discount
  // says how much and for how long; the pause says when Pro comes back and when the next charge is.
  const source = await read(BILLING_SECTION);
  const offer = source.slice(source.indexOf('{saveOffer?.offer && <div className="cancel-survey save-offer">'));
  assert.match(offer, /t\("account\.offerPauseTerms",\{ resumes: formatDay\(locale, terms\.resumesOn\), charge: formatDay\(locale, terms\.nextChargeOn\) \}\)/);
  assert.match(offer, /t\("account\.offerDiscountOnce"/);
  assert.match(offer, /t\("account\.offerDiscountRepeating",\{ discount: formatDiscount\(locale, saveOffer\.discount\), months:/);
  assert.match(offer, /t\("account\.offerDiscountForever"/);

  // And the server never makes an offer whose terms it could not work out.
  const route = await read("../app/api/stripe/retention/route.ts");
  assert.match(route, /offerForReason\(reason, Boolean\(discount\), Boolean\(pauses\)\)/);
  assert.match(route, /discount: offer === "discount" \? discount : null/);
  assert.match(route, /pauses: offer === "pause" \? pauses : null/);
});

test("cancelling opens on the right to cancel, and the offer screen keeps a cancel button", async () => {
  // Connecticut: someone asking to cancel is told first that they can cancel at any time.
  // California AB 2863 and Colorado: at most one save offer, with a cancel button on the same screen.
  const source = await read(BILLING_SECTION);
  assert.match(source, /<div className="cancel-survey"><h3>\{t\("account\.cancelTitle"\)\}<\/h3><p className="offer-terms">\{t\("account\.cancelAnytime"\)\}<\/p>/);
  const offer = source.slice(source.indexOf('{saveOffer?.offer && <div className="cancel-survey save-offer">'));
  assert.match(offer, /goToPortal\(\); \}\}>\{t\("account\.offerNoThanks"\)\}/);
});

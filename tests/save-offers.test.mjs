import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    ).toString("base64")}`
  );
}

// Really runs: app/save-offers.ts imports nothing, so the terms a customer is shown are tested as
// computed, not pattern-matched.
const offers = await load("../app/save-offers.ts");
const at = (iso) => new Date(iso);
const day = (date) => date.toISOString().slice(0, 10);
const monthly = (anchor, currency = "cad") => ({ currency, interval: "month", intervalCount: 1, anchor: at(anchor) });
const yearly = (anchor) => ({ currency: "cad", interval: "year", intervalCount: 1, anchor: at(anchor) });

test("calendar months are held to the end of a shorter month", () => {
  assert.equal(day(offers.addMonths(at("2026-01-31T12:00:00Z"), 1)), "2026-02-28");
  assert.equal(day(offers.addMonths(at("2028-01-31T12:00:00Z"), 1)), "2028-02-29");
  assert.equal(day(offers.addMonths(at("2026-01-31T12:00:00Z"), 2)), "2026-03-31", "counted from the original day, not chained");
  assert.equal(day(offers.addMonths(at("2026-11-14T12:00:00Z"), 3)), "2027-02-14");
  assert.equal(day(offers.pauseResumesAt(1, at("2026-10-14T09:00:00Z"))), "2026-11-14");
});

test("the next charge after a pause is the first renewal after it ends, not the day it ends", () => {
  // Renews on the 3rd. Paused on Oct 7 for a month: back on Nov 7, the Nov 3 renewal fell inside the
  // pause and was voided, so the next charge is Dec 3.
  const [one, two] = offers.pauseTerms(monthly("2026-01-03T15:00:00Z"), [1, 2], at("2026-10-07T21:00:00Z"));
  assert.deepEqual(one, { months: 1, resumesOn: "2026-11-07", nextChargeOn: "2026-12-03" });
  assert.deepEqual(two, { months: 2, resumesOn: "2026-12-07", nextChargeOn: "2027-01-03" });
});

test("pausing on the renewal day pushes the next charge a full month past the return", () => {
  // Renewal at 08:00 on the 14th; paused at 10:00 on the 14th for one month. The renewal two hours
  // before the pause ends is voided, so the charge after that is the next month's.
  const [one] = offers.pauseTerms(monthly("2026-03-14T08:00:00Z"), [1], at("2026-10-14T10:00:00Z"));
  assert.deepEqual(one, { months: 1, resumesOn: "2026-11-14", nextChargeOn: "2026-12-14" });
});

test("a renewal anchored on the 31st is clamped the way Stripe clamps it", () => {
  const next = offers.nextRenewalAfter(monthly("2026-01-31T12:00:00Z"), at("2026-02-15T00:00:00Z"));
  assert.equal(day(next), "2026-02-28");
  const after = offers.nextRenewalAfter(monthly("2026-01-31T12:00:00Z"), at("2026-03-01T00:00:00Z"));
  assert.equal(day(after), "2026-03-31");
});

test("a trial's future anchor is the next charge", () => {
  const next = offers.nextRenewalAfter(monthly("2026-10-21T00:00:00Z"), at("2026-10-07T00:00:00Z"));
  assert.equal(day(next), "2026-10-21");
});

test("no pause is offered on a yearly subscription", () => {
  // A pause would switch off months already paid for, and could void a whole yearly renewal.
  assert.equal(offers.pauseTerms(yearly("2026-03-01T00:00:00Z"), [1, 2, 3], at("2026-10-07T00:00:00Z")), null);
  assert.equal(offers.pauseTerms(null, [1, 2, 3]), null, "no subscription facts, no terms, no offer");
});

test("a percentage discount states its percentage and duration", () => {
  const billing = monthly("2026-01-03T00:00:00Z");
  const now = at("2026-10-07T00:00:00Z");
  assert.deepEqual(offers.saveDiscountTerms({ percent_off: 25, duration: "repeating", duration_in_months: 3, valid: true }, billing, now),
    { percentOff: 25, amountOff: null, currency: null, duration: "repeating", months: 3 });
  assert.deepEqual(offers.saveDiscountTerms({ percent_off: 50, duration: "once" }, billing, now),
    { percentOff: 50, amountOff: null, currency: null, duration: "once", months: null });
  assert.deepEqual(offers.saveDiscountTerms({ percent_off: 10, duration: "forever" }, billing, now),
    { percentOff: 10, amountOff: null, currency: null, duration: "forever", months: null });
});

test("a fixed-amount discount is quoted in the subscription's own currency", () => {
  const now = at("2026-10-07T00:00:00Z");
  const coupon = { amount_off: 200, currency: "cad", currency_options: { usd: { amount_off: 150 } }, duration: "once" };
  assert.deepEqual(offers.saveDiscountTerms(coupon, monthly("2026-01-03T00:00:00Z", "cad"), now),
    { percentOff: null, amountOff: 200, currency: "cad", duration: "once", months: null });
  assert.deepEqual(offers.saveDiscountTerms(coupon, monthly("2026-01-03T00:00:00Z", "usd"), now),
    { percentOff: null, amountOff: 150, currency: "usd", duration: "once", months: null });
  assert.equal(offers.saveDiscountTerms({ amount_off: 200, currency: "cad", duration: "once" }, monthly("2026-01-03T00:00:00Z", "usd"), now), null,
    "Stripe refuses a coupon with no amount in the subscription's currency, so it is not offered");
});

test("a discount that cannot be stated or would do nothing is not offered", () => {
  const now = at("2026-10-07T00:00:00Z");
  const billing = monthly("2026-01-03T00:00:00Z");
  assert.equal(offers.saveDiscountTerms({ percent_off: 25, duration: "once", valid: false }, billing, now), null, "invalid coupon");
  assert.equal(offers.saveDiscountTerms({ duration: "once" }, billing, now), null, "no amount");
  assert.equal(offers.saveDiscountTerms({ percent_off: 100, duration: "forever" }, billing, now), null, "a free plan is not a discount");
  assert.equal(offers.saveDiscountTerms({ percent_off: 25, duration: "repeating" }, billing, now), null, "repeating with no length");
  assert.equal(offers.saveDiscountTerms(null, billing, now), null);
  // Three months off a yearly plan that next renews in five months discounts nothing.
  assert.equal(offers.saveDiscountTerms({ percent_off: 25, duration: "repeating", duration_in_months: 3 }, yearly("2026-03-01T00:00:00Z"), now), null);
  // Six months off one renewing in five covers that renewal.
  assert.equal(offers.saveDiscountTerms({ percent_off: 25, duration: "repeating", duration_in_months: 6 }, yearly("2026-03-01T00:00:00Z"), now)?.months, 6);
});

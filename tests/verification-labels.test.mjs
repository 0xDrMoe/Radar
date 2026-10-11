import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// What a card says about whether its deal was checked.
//
// Many live deals are needs_review - imported from a source, never checked by Radar - and every
// card of theirs used to read "Re-checking", as if a first check had happened: most Canadian cards
// on the home list. Only a deal that was verified and went stale is being re-checked. One
// that was never checked says when it was listed.

// app/verification.ts imports its neighbours without an extension, as the bundler resolves them;
// Node needs the .ts written out.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes("/app/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { branchConfirmation, dealTagLabel, listedLabel, SAME_CHECK_SECONDS, verificationState, verificationStatusLabel } = await import("../app/verification.ts");

const year = new Date().getFullYear();
const listedOn = `${year}-09-22 16:47:03`; // midday UTC, so the 22nd in any North American zone

test("a deal has one of three verification states", () => {
  assert.equal(verificationState({ effective_verification_status: "verified" }), "verified");
  assert.equal(verificationState({ effective_verification_status: "stale" }), "stale");
  assert.equal(verificationState({ verification_status: "stale" }), "stale");
  assert.equal(verificationState({ effective_verification_status: "needs_review" }), "unchecked");
  assert.equal(verificationState({ effective_verification_status: null, verification_status: "needs_review" }), "unchecked");
  assert.equal(verificationState({}), "unchecked");
});

test("only a deal that was checked and went stale is 'Re-checking'", () => {
  const card = (status) => dealTagLabel({ category: "Food deal", effective_verification_status: status, created_at: listedOn, verified_at: listedOn });
  assert.equal(card("verified"), "Food deal");
  assert.equal(card("stale"), "Re-checking · Food deal");
  assert.equal(card("needs_review"), "Listed Sep 22 · Food deal", "never checked, so it says when it was listed");
  assert.doesNotMatch(card("needs_review"), /Re-checking/);
  // Sponsored still says so first, whatever the check.
  assert.equal(dealTagLabel({ category: "Food deal", sponsored: 1, effective_verification_status: "needs_review" }), "Sponsored · Food deal");
});

test("the listed date is when the deal was added, in the reader's language", () => {
  assert.equal(listedLabel({ created_at: listedOn }, "en"), "Listed Sep 22");
  assert.match(listedLabel({ created_at: listedOn }, "fr"), /^Ajoutée le 22 sept/);
  assert.match(listedLabel({ created_at: listedOn }, "es"), /^Añadida el 22 sept/);
  assert.equal(listedLabel({ created_at: "2025-09-22 16:47:03" }, "en"), "Listed Sep 22, 2025", "another year says which");
  // Without a created_at, the import time in verified_at is the listing date.
  assert.equal(listedLabel({ verified_at: listedOn }, "en"), "Listed Sep 22");
  assert.equal(listedLabel({}, "en"), null);
  assert.equal(dealTagLabel({ category: "Happy hour", effective_verification_status: "needs_review" }), "Happy hour");
});

test("the stale and verified wording the detail line uses is unchanged", () => {
  assert.equal(verificationStatusLabel("verified"), "Checked");
  assert.equal(verificationStatusLabel("stale"), "Re-checking");
});

// A deal page's branch line: "Confirmed <date>" only for a check that covered the branch, "Listed
// <date>" for a branch whose date is only when it was marked. The three shapes found live, as they
// stand in the catalogue after drizzle/0056.
const verifiedDeal = { verification: "verified", listedAt: "2026-09-23 02:47:03" };
const check = (verified_at) => ({ status: "verified", verified_at });
const ownBranch = (verified_at) => ({ eligibility: "confirmed", verified_at, own: true });

test("a branch whose date is its import is dated by the check of its deal, never 'Confirmed' at the import", () => {
  // deacon-brodies-ottawa-taco-tue and 10fourteen-ottawa-sun: imported 2026-09-23 02:47:03, the
  // branch stamped at that same moment, and one check, drizzle/0056's, a week later. It covered the
  // deal at its own address, so the branch is confirmed then.
  assert.deepEqual(
    branchConfirmation(ownBranch("2026-09-23 02:47:03"), verifiedDeal, [check("2026-09-30 16:27:33")]),
    { state: "confirmed", at: "2026-09-30 16:27:33" },
  );
  // apothecary-lounge-ottawa: a branch stamped 2026-09-23 01:31:48 by a script that confirmed it
  // without a check, then checked on the 30th.
  assert.deepEqual(
    branchConfirmation(ownBranch("2026-09-23 01:31:48"), { verification: "verified", listedAt: "2026-08-21 08:06:23" }, [check("2026-09-30 16:27:33")]),
    { state: "confirmed", at: "2026-09-30 16:27:33" },
  );
  // lonestar-baseline-ottawa: checked against its own branch's page by drizzle/0054, which linked
  // the chain's other branch in the same statement file and left this row at its import.
  assert.deepEqual(
    branchConfirmation(ownBranch("2026-09-23 01:31:48"), verifiedDeal, [check("2026-09-29 05:27:48")]),
    { state: "confirmed", at: "2026-09-29 05:27:48" },
  );
  // The latest check, when there were several.
  assert.deepEqual(
    branchConfirmation(ownBranch("2026-09-29 05:27:48"), verifiedDeal, [check("2026-09-29 05:27:48"), check("2026-09-30 16:27:33")]),
    { state: "confirmed", at: "2026-09-30 16:27:33" },
  );
  // The same own branch with no check at all: listed, with the moment it was marked.
  assert.deepEqual(branchConfirmation(ownBranch("2026-09-23 02:47:03"), verifiedDeal, []), { state: "listed", at: "2026-09-23 02:47:03" });
});

test("another branch is confirmed only by a check that stamped it", () => {
  const other = (verified_at) => ({ eligibility: "confirmed", verified_at, own: false });
  // Imported with the deal, the deal checked since at its own address: that check was not of this
  // branch, so it is listed, dated when it was marked.
  assert.deepEqual(branchConfirmation(other("2026-09-23 01:31:48"), verifiedDeal, [check("2026-09-30 16:27:34")]), { state: "listed", at: "2026-09-23 01:31:48" });
  // The Verify button's all-locations form stamps every branch with the check's own moment, and so
  // did drizzle/0054 linking a chain's branches to a deal it had just checked. D1's
  // CURRENT_TIMESTAMP can tick between statements of one batch.
  assert.deepEqual(branchConfirmation(other("2026-09-29 05:27:49"), verifiedDeal, [check("2026-09-29 05:27:48")]), { state: "confirmed", at: "2026-09-29 05:27:48" });
  // The latest check that covered it, not the deal's latest.
  assert.deepEqual(
    branchConfirmation(other("2026-09-20 10:00:00"), verifiedDeal, [check("2026-09-30 16:27:33"), check("2026-09-20 10:00:00")]),
    { state: "confirmed", at: "2026-09-20 10:00:00" },
  );
  // Minutes are not the same check: the window is what one batch or one migration takes.
  const outside = new Date(Date.parse("2026-09-20T10:00:00Z") + (SAME_CHECK_SECONDS + 1) * 1000).toISOString().replace("T", " ").slice(0, 19);
  assert.equal(branchConfirmation(other(outside), verifiedDeal, [check("2026-09-20 10:00:00")]).state, "listed");
  // A branch marked 'confirmed' with no date at all is listed as of the deal's own listing.
  assert.deepEqual(branchConfirmation(other(null), verifiedDeal, [check("2026-09-30 16:27:33")]), { state: "listed", at: "2026-09-23 02:47:03" });
});

test("a brand-wide deal is confirmed at every branch by its latest check", () => {
  const branch = { eligibility: "confirmed", verified_at: null, own: false };
  assert.deepEqual(branchConfirmation(branch, { ...verifiedDeal, brandWide: true }, [check("2026-09-29 05:27:48"), check("2026-09-01 00:00:00")]), { state: "confirmed", at: "2026-09-29 05:27:48" });
  // Never checked: listed, as of the deal's own listing.
  assert.deepEqual(branchConfirmation(branch, { ...verifiedDeal, brandWide: true }, []), { state: "listed", at: "2026-09-23 02:47:03" });
});

test("a chain branch confirmed from the deal's own source page is dated by the deal's check", () => {
  // scripts/brand-wide-eligibility.sql confirmed Kelseys', McDonald's' and St-Hubert's branches from
  // the chain promotions page the deal is sourced to, stamping each with the deal's verified_at of
  // the day. drizzle/0056 re-read that page on 2026-09-30: 513 of the 539 branches that would
  // otherwise say "Listed" rest on it.
  const fromSource = (verified_at) => ({ eligibility: "confirmed", verified_at, own: false, fromDealSource: true });
  assert.deepEqual(
    branchConfirmation(fromSource("2026-09-23 01:31:48"), verifiedDeal, [check("2026-09-30 16:27:34"), check("2026-09-23 01:31:48")]),
    { state: "confirmed", at: "2026-09-30 16:27:34" },
  );
  // A branch confirmed from a sibling page (All Star's home page for a promotions-page deal) has no
  // check of its own: listed.
  assert.deepEqual(
    branchConfirmation({ eligibility: "confirmed", verified_at: "2026-09-23 01:31:48", own: false, fromDealSource: false }, verifiedDeal, [check("2026-09-30 16:27:34")]),
    { state: "listed", at: "2026-09-23 01:31:48" },
  );
  // The deal's own state still comes first.
  assert.deepEqual(branchConfirmation(fromSource("2026-09-23 01:31:48"), { verification: "stale" }, [check("2026-08-01 00:00:00")]), { state: "lapsed", at: null });
});

test("the deal's own state comes first", () => {
  const checks = [check("2026-09-30 16:27:33")];
  assert.deepEqual(branchConfirmation(ownBranch("2026-09-30 16:27:33"), { verification: "stale" }, checks), { state: "lapsed", at: null });
  assert.deepEqual(branchConfirmation(ownBranch("2026-09-23 02:47:03"), { verification: "needs_review" }, checks), { state: "unconfirmed", at: null });
  assert.deepEqual(branchConfirmation({ eligibility: "needs_review", verified_at: null, own: true }, verifiedDeal, checks), { state: "unconfirmed", at: null });
  // Only a check that passed dates anything.
  assert.equal(branchConfirmation(ownBranch("2026-09-23 02:47:03"), verifiedDeal, [{ status: "rejected", verified_at: "2026-09-30 16:27:33" }]).state, "listed");
});

// The home page's cards and its detail sheet read the same states.
const home = readFileSync(new URL("../app/HomeClient.tsx", import.meta.url), "utf8");

test("the detail sheet dates an unchecked deal as listed, not checked", () => {
  assert.match(home, /verificationState\(selected\) === "unchecked"\s*\n?\s*\? dealLabels\(locale\)\.listed\(readerDate\(selected\.created_at \|\| selected\.verified_at, locale\)\)/);
});

test("a card's Tonight comes from the API's reading of the schedule, not the stored category", () => {
  assert.match(home, /\{d\.tonight && <span className="price-tier-pill tonight-pill">\{dealLabels\(locale\)\.tonight\}<\/span>\}/);
});

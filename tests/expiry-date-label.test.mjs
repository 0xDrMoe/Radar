// expires_at is the instant an offer stops, and a card prints a calendar date. The date has to be
// read in the offer's own zone: Swiss Chalet's offers that run through October 31 are stored as
// '2026-11-01 03:59:59', the end of the 31st in Toronto, and formatted in UTC (where the Worker
// renders) or anywhere east of Toronto that instant is November 1. Nationwide promotions have no
// location and are read in Pacific time.
//
// "In any process zone" is the point, so the labels are also computed in child processes started
// under several TZ settings, not only in whatever zone this machine happens to be in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // App code imports its own modules without a file extension, which the bundler resolves and
    // bare Node does not.
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { endDateLabel, expiringSoonLabel, expiryTimeZone, hasExpired, lastDayIso, lastDayLongLabel, NATIONAL_EXPIRY_TIME_ZONE } = await import("../app/verification.ts");
const { dealLabels } = await import("../app/i18n/dealLabels.ts");

const SWISS_CHALET = { expires_at: "2026-11-01 03:59:59", location_scope: null, timezone: "America/Toronto" };
const NATIONAL = { expires_at: "2026-10-07 06:59:59", location_scope: "national", timezone: null };
const realNow = Date.now;
const at = (iso) => {
  Date.now = () => Date.parse(iso);
};

// The child: print the labels for a fixed "now" and exit before any test is declared.
if (process.env.EXPIRY_LABEL_CHILD) {
  at("2026-10-01T12:00:00Z");
  process.stdout.write(JSON.stringify({
    swiss: endDateLabel(SWISS_CHALET.expires_at, "en", expiryTimeZone(SWISS_CHALET)),
    national: endDateLabel(NATIONAL.expires_at, "en", expiryTimeZone(NATIONAL)),
  }));
  process.exit(0);
}

const en = dealLabels("en");

test("a local offer's end is read in its location's zone, a national one's in Pacific time", () => {
  assert.equal(expiryTimeZone(SWISS_CHALET), "America/Toronto");
  assert.equal(expiryTimeZone(NATIONAL), "America/Los_Angeles");
  assert.equal(NATIONAL_EXPIRY_TIME_ZONE, "America/Los_Angeles");
  // A national row with a timezone still reads in Pacific time; nothing known means the runtime's.
  assert.equal(expiryTimeZone({ location_scope: "national", timezone: "America/New_York" }), "America/Los_Angeles");
  assert.equal(expiryTimeZone({ location_scope: null, timezone: null }), null);
});

test("Swiss Chalet's offers end Oct 31, and the national rows Oct 6", () => {
  at("2026-10-01T12:00:00Z");
  try {
    assert.equal(endDateLabel(SWISS_CHALET.expires_at, "en", expiryTimeZone(SWISS_CHALET)), "Oct 31");
    assert.equal(endDateLabel(NATIONAL.expires_at, "en", expiryTimeZone(NATIONAL)), "Oct 6");
  } finally {
    Date.now = realNow;
  }
});

for (const zone of ["UTC", "Asia/Tokyo", "Pacific/Kiritimati", "America/Los_Angeles", "Pacific/Honolulu", "Europe/Paris"]) {
  test(`the labels are the same with the process in ${zone}`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: zone, EXPIRY_LABEL_CHILD: "1" },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { swiss: "Oct 31", national: "Oct 6" });
  });
}

// An end at the stroke of midnight belongs to the day before it, like one at 23:59:59.
test("an end at midnight labels the day before", () => {
  at("2026-10-01T12:00:00Z");
  try {
    assert.equal(endDateLabel("2026-11-01 04:00:00", "en", "America/Toronto"), "Oct 31");
    assert.equal(endDateLabel("2026-10-07 07:00:00", "en", "America/Los_Angeles"), "Oct 6");
  } finally {
    Date.now = realNow;
  }
});

test("a later year is printed, in the offer's zone", () => {
  at("2026-12-31T12:00:00Z");
  try {
    // Jan 1 2027 in UTC, still Dec 31 2026 in Toronto: the same year there, so no year.
    assert.equal(endDateLabel("2027-01-01 04:59:59", "en", "America/Toronto"), "Dec 31");
    assert.equal(endDateLabel("2027-01-02 04:59:59", "en", "America/Toronto"), "Jan 1, 2027");
    assert.equal(endDateLabel("2100-01-01 00:00:00", "en", "America/Toronto"), null, "a placeholder is no end date");
  } finally {
    Date.now = realNow;
  }
});

// Counted in calendar days where the offer runs. The old count divided the time left by 24 hours
// and rounded up, so an offer ending tonight read "Ends tomorrow" all morning.
test("the day count is in calendar days in the offer's zone", () => {
  const tz = expiryTimeZone(SWISS_CHALET);
  const end = SWISS_CHALET.expires_at;
  try {
    at("2026-10-31T13:00:00Z"); // 9 AM on the 31st in Toronto
    assert.equal(expiringSoonLabel(end, "en", tz), en.endsToday);
    at("2026-10-30T16:00:00Z"); // noon on the 30th
    assert.equal(expiringSoonLabel(end, "en", tz), en.endsTomorrow);
    at("2026-10-28T16:00:00Z");
    assert.equal(expiringSoonLabel(end, "en", tz), en.endsInDays(3));
    at("2026-10-20T16:00:00Z");
    assert.equal(expiringSoonLabel(end, "en", tz), null, "more than a week out says nothing");
    at("2026-11-01T05:00:00Z"); // 1 AM on Nov 1 in Toronto, an hour after the end
    assert.equal(expiringSoonLabel(end, "en", tz), en.recentlyEnded);
    assert.equal(hasExpired(end), true);
  } finally {
    Date.now = realNow;
  }
});

// Evening of Oct 6 in California is already Oct 7 in UTC. The offer still ends today there.
test("a national offer counts its days in Pacific time", () => {
  try {
    at("2026-10-07T03:00:00Z"); // 8 PM on Oct 6 in Los Angeles
    assert.equal(expiringSoonLabel(NATIONAL.expires_at, "en", expiryTimeZone(NATIONAL)), en.endsToday);
    assert.equal(hasExpired(NATIONAL.expires_at), false);
  } finally {
    Date.now = realNow;
  }
});

// The zone travels with the rows the cards read, without renaming any field they already had.
test("the API rows carry the zone and every card passes it", async () => {
  const { readFileSync } = await import("node:fs");
  const { code } = await import("./source.mjs");
  const read = (file) => code(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  const api = read("app/api/deals/route.ts");
  assert.match(api, /expiry_timezone: expiryTimeZone\(base\)/);
  assert.match(api, /expiry_timezone: deal\.expiry_timezone \?\? null/, "a nationwide card's offers carry it too");
  assert.match(read("app/api/deals/[slug]/route.ts"), /expiry_timezone: expiryTimeZone\(rest\)/);
  assert.match(read("app/dealView.ts"), /"expiry_timezone"/, "the compact view must keep it");
  const home = read("app/HomeClient.tsx");
  assert.doesNotMatch(home, /(endDateLabel|expiringSoonLabel)\([^)]*locale\)/, "every label call must pass the zone");
  assert.equal(home.match(/(endDateLabel|expiringSoonLabel)\([a-z]+\.expires_at, locale, [a-z]+\.expiry_timezone\)/g)?.length, 8);
  assert.match(read("app/NationalDeals.tsx"), /endDateLabel\(offer\.expires_at, locale, offer\.expiry_timezone\)/);
});

// The deal page: schema.org priceValidUntil and "Offer ends" name the last day where the offer runs.
// The first ten characters of the stored end are the next day for both kinds of row.
test("the deal page names the last day, not the date of the instant it stops", () => {
  assert.equal(lastDayIso(SWISS_CHALET.expires_at, expiryTimeZone(SWISS_CHALET)), "2026-10-31");
  assert.equal(lastDayIso(NATIONAL.expires_at, expiryTimeZone(NATIONAL)), "2026-10-06");
  // Pacific standard time from Nov 1: the end of that day is 07:59:59 UTC on the 2nd.
  assert.equal(lastDayIso("2026-11-02 07:59:59", "America/Los_Angeles"), "2026-11-01");
  // An end stored at the stroke of midnight belongs to the day before.
  assert.equal(lastDayIso("2026-11-01 04:00:00", "America/Toronto"), "2026-10-31");
  assert.equal(lastDayLongLabel(NATIONAL.expires_at, "en", expiryTimeZone(NATIONAL)), "October 6, 2026");
  assert.equal(lastDayLongLabel(SWISS_CHALET.expires_at, "fr", expiryTimeZone(SWISS_CHALET)), "31 octobre 2026");
  assert.equal(lastDayIso(null, "America/Toronto"), null);
  assert.equal(lastDayLongLabel("not a date", "en", "America/Toronto"), null);
});

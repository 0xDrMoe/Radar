import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { code } from "./source.mjs";

// The parser that fills the admin schedule form from the sentence already sitting next to it.
//
// Every string here is real: they are the schedule column of deals imported from the happy-hour
// directories, which is the input this exists to read. The cases that matter most are the ones
// where it should refuse, because a wrong schedule filled in silently is worse than an empty form.

const { parseScheduleText, describeWindows } = await import("../app/schedule-text.ts");

const one = (text) => {
  const windows = parseScheduleText(text);
  assert.equal(windows.length, 1, `expected one window from ${text}, got ${describeWindows(windows) || "none"}`);
  return windows[0];
};

test("a day range and a shared meridiem", () => {
  // "2-6 PM" states the meridiem once and means it for both ends.
  const w = one("Tue-Fri 2-6 PM");
  assert.deepEqual(w.days, ["tue", "wed", "thu", "fri"]);
  assert.equal(w.start, "14:00");
  assert.equal(w.end, "18:00");
});

test("a range that wraps past Saturday keeps going", () => {
  // Apothecary Lounge: "Sun-Thu 10 PM-12 AM" is five days, and midnight is 00:00, not 12:00.
  const w = one("Sun-Thu 10 PM-12 AM");
  assert.deepEqual(w.days, ["sun", "mon", "tue", "wed", "thu"]);
  assert.equal(w.start, "22:00");
  assert.equal(w.end, "00:00");
});

test("daily means all seven", () => {
  const w = one("Daily 4-6 PM");
  assert.equal(w.days.length, 7);
  assert.equal(w.start, "16:00");
  assert.equal(w.end, "18:00");
});

test("two windows in one sentence stay two windows", () => {
  // Biff's Bistro. A single window carrying all nine days would be wrong on both.
  const windows = parseScheduleText("Tue-Fri 2-6 PM - Sat-Sun 4-6 PM");
  assert.equal(windows.length, 2, describeWindows(windows));
  assert.deepEqual(windows[0].days, ["tue", "wed", "thu", "fri"]);
  assert.deepEqual(windows[1].days, ["sun", "sat"]);
  assert.equal(windows[1].start, "16:00");
});

test("weekdays and weekends are named groups", () => {
  assert.deepEqual(one("Weekdays 3-5 PM").days, ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual(one("Weekends 11 AM-2 PM").days, ["sun", "sat"]);
});

test("until close becomes a real end time", () => {
  const w = one("Fri 9 PM-close");
  assert.deepEqual(w.days, ["fri"]);
  assert.equal(w.start, "21:00");
  assert.equal(w.end, "23:59");
});

test("a time with no day at all is read as every day", () => {
  // Consistent with availabilityFromSchedule in app/search.ts, which already treats a bare time
  // range as an everyday offer written loosely.
  const w = one("3-6 PM");
  assert.equal(w.days.length, 7);
});

test("noon and midnight do not invert", () => {
  assert.equal(one("Mon 12 PM-3 PM").start, "12:00");
  assert.equal(one("Mon 12 AM-2 AM").start, "00:00");
});

test("a comma list of days is all of them", () => {
  assert.deepEqual(one("Mon, Wed, Fri 5-7 PM").days, ["mon", "wed", "fri"]);
});

test("one set of days with two time windows keeps both", () => {
  // "Mon-Fri 3-6 PM & 9 PM-close" names its days once and its hours twice. Reading only the first
  // drops the late window, which is often the better deal.
  const windows = parseScheduleText("Mon-Fri 3-6 PM & 9 PM-close");
  assert.equal(windows.length, 2, describeWindows(windows));
  assert.deepEqual(windows[0].days, windows[1].days);
  assert.equal(windows[0].start, "15:00");
  assert.equal(windows[1].start, "21:00");
  assert.equal(windows[1].end, "23:59");
});

test("it abstains rather than guessing", () => {
  // Each of these could be turned into a window by inventing something. None should be. An empty
  // form tells the reviewer it needs them; a wrongly filled one does not.
  for (const text of ["Call for details", "Mon-Fri", "Ask your server", "", null, undefined, "Seasonal hours"]) {
    assert.deepEqual(parseScheduleText(text), [], `should not have parsed: ${text}`);
  }
});

test("an impossible clock time is refused", () => {
  assert.deepEqual(parseScheduleText("Mon 25-99 PM"), []);
});

test("the parser never writes anything", () => {
  // The safety of offering a parsed schedule rests on a person seeing it before it is saved. If
  // this module ever reaches for the database or the network, that has stopped being true.
  const source = code(readFileSync(new URL("../app/schedule-text.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /fetch\(|env\.DB|prepare\(|INSERT|UPDATE /);
});

test("a comma list whose element is itself a range keeps every day", () => {
  // "Tue, Thu-Sun 5-7 PM" once parsed as Sunday alone: the spec pattern matched "Tue, Thu", left
  // "-Sun" to begin a second spec, and the only time range in the sentence attached to that. Four
  // days vanished silently, which is the exact failure this parser must not produce.
  const w = one("Tue, Thu-Sun 5-7 PM");
  assert.deepEqual(w.days, ["sun", "tue", "thu", "fri", "sat"].filter((d) =>
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(d)).sort((a, b) =>
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(a) - ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(b)));
  assert.equal(w.start, "17:00");
});

test("midnight and noon are read as the clock times they are", () => {
  // "10pm to midnight" is how a restaurant writes a late happy hour on its own page — far more
  // often than "10 PM-12 AM", which is how the directories write it. Both have to land on the same
  // window, or the two can never be compared.
  const late = one("Sun-Thu 10pm to midnight");
  assert.deepEqual(late.days, ["sun", "mon", "tue", "wed", "thu"]);
  assert.equal(late.start, "22:00");
  assert.equal(late.end, "00:00");
  assert.equal(late.end, one("Sun-Thu 10 PM-12 AM").end, "the two spellings must agree");

  const lunch = one("Mon-Fri 11am to noon");
  assert.equal(lunch.start, "11:00");
  assert.equal(lunch.end, "12:00");
});

test("close still means end of day, not a time anyone published", () => {
  // Distinct from midnight on purpose: "until close" is a promise about the kitchen, not a clock
  // reading, and collapsing the two would put a time on the deal page that nobody stated.
  assert.equal(one("Fri 9 PM-close").end, "23:59");
  assert.equal(one("Fri 9 PM-late").end, "23:59");
});

test("a sentence that puts the days last is still read", () => {
  // Blowers & Grafton's homepage: "HALI HOUR FOOD & DRINK SPECIALS 2 PM - 5 PM & 9 PM - Close
  // EVERYDAY!". The draft said exactly this and the two disagreed, because a day spec claims the
  // text to its RIGHT and this one has nothing to its right. It parsed as nothing at all.
  const windows = parseScheduleText("FOOD & DRINK SPECIALS 2 PM - 5 PM & 9 PM - Close EVERYDAY!");
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], { days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], start: "14:00", end: "17:00" });
  assert.equal(windows[1].start, "21:00");
  assert.equal(windows[1].end, "23:59");
});

test("trailing days are only borrowed when there is exactly one set of them", () => {
  // Two specs and the times could belong to either, so it abstains rather than picking one. The
  // word "Dinner" between the times and the days is what makes them two statements — without it
  // the times are adjacent to the first spec and belong to it, which is the next test.
  assert.deepEqual(parseScheduleText("Brunch 11 AM-2 PM Dinner Mon-Fri Late Sat-Sun"), []);
  // "Mon-Fri and Sat-Sun" is one spec, not two — a list joined by "and" names seven days, and
  // reading it as an ambiguity would abstain on a sentence that is perfectly clear.
  const joined = parseScheduleText("3-6 PM Mon-Fri and Sat-Sun");
  assert.equal(joined.length, 1);
  assert.equal(joined[0].days.length, 7);
  // And the ordinary case must not change: a spec with times to its right still wins.
  const normal = parseScheduleText("Mon-Fri 3-6 PM");
  assert.deepEqual(normal[0].days, ["mon", "tue", "wed", "thu", "fri"]);
});

test("a range with no meridiem anywhere is refused, not read as the small hours", () => {
  // Banter Room's page: "Happy hour daily from 2 to 5." The arithmetic says 02:00-05:00, and a
  // 2 AM happy hour on a deal page is worse than no schedule at all.
  assert.deepEqual(parseScheduleText("Happy hour daily from 2 to 5"), []);
  assert.deepEqual(parseScheduleText("Mon-Fri 11-2"), []);
  // A 24-hour clock states itself with minutes, and an end word carries its own meaning.
  assert.equal(parseScheduleText("Mon-Fri 14:00-17:00")[0].start, "14:00");
  assert.equal(parseScheduleText("Mon-Fri 9 PM-close")[0].end, "23:59");
});

test("a meridiem written with periods is still a meridiem", () => {
  // Clark's Oyster Bar: "Happy Hour Mon - Fri 3:00 p.m. - 5:00 p.m". The draft claimed exactly
  // this and the review reported the two as disagreeing, because "p.m." matched nothing and a
  // range with no meridiem is refused. The row read as a correction to make when it was a publish.
  const w = one("Happy Hour Mon - Fri 3:00 p.m. - 5:00 p.m");
  assert.deepEqual(w.days, ["mon", "tue", "wed", "thu", "fri"]);
  assert.equal(w.start, "15:00");
  assert.equal(w.end, "17:00");
  assert.equal(one("Daily 11 a.m.-2 p.m.").start, "11:00");
  assert.equal(one("Daily 11 A.M. to 2 P.M.").end, "14:00");
});

test("times stated just before the days belong to them", () => {
  // Ancora: "Happy Hour | 2:30 to 5pm, Daily". A day spec claims the text to its right, so these
  // times had no owner and were dropped — the row read as disagreeing with a draft that, once
  // corrected to exactly this, still disagreed.
  const w = one("Happy Hour | 2:30 to 5pm, Daily");
  assert.equal(w.days.length, 7);
  assert.equal(w.start, "14:30");
  assert.equal(w.end, "17:00");
  assert.deepEqual(one("Lunch 11 AM-2 PM Mon-Fri").days, ["mon", "tue", "wed", "thu", "fri"]);
});

test("a word between the times and the days keeps them apart", () => {
  // Boulevard's page runs "Happy Hour 3:00pm to 5:00pm Dinner 4:30pm to 11:00pm Brunch Saturday &
  // Sunday 11:30am to 2:00pm" together. Letting Saturday reach back past "Brunch" would hand the
  // restaurant's dinner service to the weekend as if it were the deal.
  const windows = parseScheduleText(
    "Happy Hour 3:00pm to 5:00pm Dinner 4:30pm to 11:00pm Brunch Saturday & Sunday 11:30am to 2:00pm",
  );
  assert.deepEqual(windows.map((w) => `${w.days.join(",")} ${w.start}-${w.end}`), ["sun,sat 11:30-14:00"]);
});

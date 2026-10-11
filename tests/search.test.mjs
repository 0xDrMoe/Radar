import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/search.ts",import.meta.url),"utf8");
const compiled = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText;
const search = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("normalizes accents and punctuation",() => {
  assert.equal(search.normalizeSearch("Bâton-Rouge Montréal"),"baton rouge montreal");
});

test("requires every query token while accepting aliases",() => {
  assert.equal(search.matchesQuery("pub burgers and discount drinks","cheap burger"),true);
  assert.equal(search.matchesQuery("pub burgers","cheap oysters"),false);
  assert.equal(search.matchesQuery("terrasse cocktails","patio drinks"),true);
});

test("filters by an all-short-token query instead of matching everything",() => {
  assert.equal(search.matchesQuery("wing wednesday 1 2 price wings","5"),false);
  assert.equal(search.matchesQuery("half price wings, 5 for $5",""),true);
  assert.equal(search.matchesQuery("$5 wing wednesday","$5"),true);
  assert.equal(search.matchesQuery("pub burgers","!!!"),true);
});

test("calculates useful distances and safe pagination",() => {
  const distance = search.kmBetween({ latitude:45.4215,longitude:-75.6972 },{ latitude:45.4765,longitude:-75.7013 });
  assert.ok(distance > 5 && distance < 7);
  assert.equal(search.safeLimit("500"),50);
  assert.equal(search.safeCursor("invalid"),0);
  assert.equal(search.nextRadius(10),25);
});

test("does not coerce missing coordinates to the Gulf of Guinea",() => {
  assert.equal(search.optionalCoordinate(null,-90,90),null);
  assert.equal(search.optionalCoordinate("",-180,180),null);
  assert.equal(search.optionalCoordinate("45.4215",-90,90),45.4215);
  assert.equal(search.optionalCoordinate("0",-90,90),0);
  assert.equal(search.optionalCoordinate("181",-180,180),null);
});

test("rejects unsafe return paths",() => {
  assert.equal(search.safeReturnPath("//evil.example"),"/");
  assert.equal(search.safeReturnPath("https://evil.example"),"/");
  assert.equal(search.safeReturnPath("/dashboard?section=saved"),"/dashboard?section=saved");
  // Each of these starts with a single slash and still resolves to "//evil.example": the check has
  // to be on the resolved path, not only the raw one.
  for (const bypass of ["/.//evil.example/login", "/%2e//evil.example", "/./\\evil.example", "/a/..//evil.example"]) {
    assert.equal(search.safeReturnPath(bypass), "/", bypass);
  }
});

test("expands free-text day ranges instead of matching only the literal day names present",() => {
  const wed = new Date("2026-08-19T20:00:00Z"); // Wed 4pm America/Toronto
  const result = search.availabilityFromSchedule("Mon-Sat rotating specials",wed,"America/Toronto");
  assert.equal(result.eligibleToday,true);
  const sun = new Date("2026-08-16T20:00:00Z");
  assert.equal(search.availabilityFromSchedule("Mon-Sat rotating specials",sun,"America/Toronto").eligibleToday,false);
});

test("treats a time-only schedule as an everyday offer, but not a schedule with no times",() => {
  const wed = new Date("2026-08-19T20:00:00Z"); // Wed 4pm America/Toronto
  const timeOnly = search.availabilityFromSchedule("3–6 PM & 9 PM–close",wed,"America/Toronto");
  assert.equal(timeOnly.eligibleToday,true);
  assert.equal(timeOnly.availableNow,true);
  // No day *and* no parseable time window is genuinely unknown — it must not claim to be on today.
  const unscheduled = search.availabilityFromSchedule("See current official menu",wed,"America/Toronto");
  assert.equal(unscheduled.eligibleToday,false);
  assert.equal(unscheduled.label,"See schedule");
  // A schedule that does name days keeps being filtered by them.
  const sun = new Date("2026-08-16T20:00:00Z");
  assert.equal(search.availabilityFromSchedule("Mon–Fri 3–6 PM",sun,"America/Toronto").eligibleToday,false);
});

test("checks every time window in a schedule, not just the first",() => {
  const evening = new Date("2026-08-17T01:30:00Z"); // 9:30pm America/Toronto
  const result = search.availabilityFromSchedule("Daily 2-5 PM & 9 PM-close",evening,"America/Toronto");
  assert.equal(result.availableNow,true);
});

test("a dated promotion is on for its dates and not on the weekdays around them",() => {
  // National Taco Day, Tuesday 2026-10-06. Read as a weekly schedule, "Oct 6 only" named no day and
  // said "See schedule" on the day itself.
  const tacoDay = new Date("2026-10-06T16:00:00Z"); // noon in Knoxville
  const onTheDay = search.availabilityFromSchedule("Oct 6 only",tacoDay,"America/New_York");
  assert.equal(onTheDay.eligibleToday,true);
  assert.equal(onTheDay.label,"Available today");
  assert.equal(search.availabilityFromSchedule("Oct 6 only",new Date("2026-09-29T16:00:00Z"),"America/New_York").eligibleToday,false,
    "not the Tuesday before");
  assert.equal(search.availabilityFromSchedule("Sept 26-29",new Date("2026-09-28T16:00:00Z"),"America/New_York").eligibleToday,true);
  assert.equal(search.availabilityFromSchedule("Sept 26-29",new Date("2026-09-30T16:00:00Z"),"America/New_York").eligibleToday,false);
  assert.equal(search.availabilityFromSchedule("Oct 30-Nov 2",new Date("2026-11-01T16:00:00Z"),"America/New_York").eligibleToday,true);
  assert.equal(search.availabilityFromSchedule("Dec 30-Jan 2",new Date("2027-01-01T16:00:00Z"),"America/New_York").eligibleToday,true);
});

test("a dated promotion's day is the deal's own day, not UTC's",() => {
  // 10 PM on Oct 6 in Knoxville is already Oct 7 in UTC.
  const lateEvening = new Date("2026-10-07T02:00:00Z");
  assert.equal(search.availabilityFromSchedule("Oct 6 only",lateEvening,"America/New_York").eligibleToday,true);
  assert.equal(search.availabilityFromSchedule("Oct 6 only",new Date("2026-10-07T05:00:00Z"),"America/New_York").eligibleToday,false);
});

test("only a schedule that opens with its date is read as dated",() => {
  // A weekly offer with an end date stays weekly: when it stops is expires_at's job.
  const tuesday = new Date("2026-09-29T16:00:00Z");
  assert.equal(search.availabilityFromSchedule("Tuesdays through Oct 21",tuesday,"America/New_York").eligibleToday,true);
  assert.equal(search.scheduleDates("Tuesdays through Oct 21"),null);
  assert.equal(search.scheduleDates("May vary by location"),null);
  assert.deepEqual(search.scheduleDates("Oct 6 only; reward good 14 days"),[1006,1006]);
  assert.deepEqual(search.scheduleDates("Sept 26-29"),[926,929]);
  assert.deepEqual(search.scheduleDates("Oct 30–Nov 2"),[1030,1102]);
});

test("computes timezone-aware structured availability",() => {
  const now = new Date("2026-08-20T20:00:00Z");
  const result = search.availabilityFromStructuredSchedule("[4]","15:00","18:00","America/Toronto",now);
  assert.equal(result.availableNow,true);
  assert.match(result.label,/Available now/);
  const later = search.availabilityFromStructuredSchedule("[5]","15:00","18:00","America/Toronto",now);
  assert.equal(later.availableNow,false);
  assert.match(later.label,/Friday/);
});

test("finds a deal when the search is plural and the deal is not",() => {
  // The bug a collaborator hit on the live site: Ottawa had two live taco deals, and searching
  // "tacos" surfaced only the one whose text happened to spell the plural. Neither the title
  // "Two-taco Tuesday" nor the curated term "taco tuesday nachos & tequila" contains "tacos",
  // and searchAliases had no entry for it.
  assert.equal(search.matchesQuery("Two-taco Tuesday Si Senor Mexican Street Food","tacos"),true);
  assert.equal(search.matchesQuery("Taco Tuesday nachos & tequila Father & Sons Tavern","tacos"),true);
  // The singular direction already worked through plain substring matching — keep it that way.
  assert.equal(search.matchesQuery("$3 tacos all night","taco"),true);
  // Words the alias table happened to cover must not regress now that stripping handles them.
  assert.equal(search.matchesQuery("Half-price wing night","wings"),true);
  assert.equal(search.matchesQuery("$11 burger and a pint","burgers"),true);
  // An -es plural stems too, for the words a bare -s would leave mangled.
  assert.equal(search.matchesQuery("Toasted sandwich and soup","sandwiches"),true);
  // Stripping must not turn a miss into a match: nothing here is a taco.
  assert.equal(search.matchesQuery("Half-price wing night","tacos"),false);
  // Short tokens keep their trailing s rather than stemming down to noise.
  assert.equal(search.matchesQuery("Free coffee refill","ribs"),false);
});

test("ranks the literal plural above the stemmed match",() => {
  const literal = search.relevanceScore("$3 tacos all night","tacos","Cantina","Taco night");
  const stemmed = search.relevanceScore("Two-taco Tuesday","tacos","Si Senor","Two-taco Tuesday");
  assert.ok(literal > stemmed,`expected literal ${literal} to outrank stemmed ${stemmed}`);
  assert.ok(stemmed > 0,"a stemmed match must still score above nothing");
});

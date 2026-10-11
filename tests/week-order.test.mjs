import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityFromSchedule, scheduleShape, scheduleWeekdays, weekRank } from "../app/search.ts";

// Which days a free-text schedule runs on, and the order a venue's offers are listed in.
//
// Both come from the availability line's own reading of a schedule, so a card that says an offer
// is on today can never list it under another day, or lead with a different one. Every schedule
// below is written the way live deals write them.

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

test("bare days, ranges, lists and 'daily' all read as days", () => {
  assert.deepEqual(scheduleWeekdays("Wed"), [WED], "a bare day is the common case for a nightly special");
  assert.deepEqual(scheduleWeekdays("Wed from 2 PM"), [WED]);
  assert.deepEqual(scheduleWeekdays("Mon 5 PM-late"), [MON]);
  assert.deepEqual(scheduleWeekdays("Mon-Fri 2-5 PM"), [MON, TUE, WED, THU, FRI]);
  assert.deepEqual(scheduleWeekdays("Weekdays 3-6 PM"), [MON, TUE, WED, THU, FRI]);
  assert.deepEqual(scheduleWeekdays("Tue–Fri 4–6 PM; oysters 5 PM–late"), [TUE, WED, THU, FRI]);
  assert.deepEqual(scheduleWeekdays("Thu, Fri & Sun 7-11 PM"), [SUN, THU, FRI]);
  assert.deepEqual(scheduleWeekdays("Sat-Sun"), [SUN, SAT]);
  assert.deepEqual(scheduleWeekdays("Daily"), [SUN, MON, TUE, WED, THU, FRI, SAT]);
  assert.deepEqual(scheduleWeekdays("Daily, open-3 PM"), [SUN, MON, TUE, WED, THU, FRI, SAT]);
  // No day but a time range is an everyday offer written loosely; no day and no time is nothing.
  assert.deepEqual(scheduleWeekdays("3-6 PM"), [SUN, MON, TUE, WED, THU, FRI, SAT]);
  assert.deepEqual(scheduleWeekdays("See current official menu"), []);
});

// The point of sharing one reading: for every day of a real week, "runs that day" and "on today"
// give the same answer.
test("the days agree with the availability line on every day of the week", () => {
  const schedules = ["Wed", "Mon-Fri 2-5 PM", "Thu, Fri & Sun 7-11 PM", "Daily", "3-6 PM", "Sat-Sun", "See current official menu"];
  // 2026-09-20 is a Sunday. Noon UTC is 8 AM in Toronto, the same calendar day.
  for (let weekday = 0; weekday < 7; weekday++) {
    const date = new Date(Date.UTC(2026, 8, 20 + weekday, 12));
    for (const schedule of schedules) {
      assert.equal(
        scheduleWeekdays(schedule).includes(weekday),
        availabilityFromSchedule(schedule, date, "America/Toronto").eligibleToday,
        `${schedule} on weekday ${weekday}`,
      );
    }
  }
});

test("a venue's week reads Monday to Sunday, then the all-week offers, then the unscheduled", () => {
  const kelseys = ["Daily 3-5 PM & 8 PM-close", "Wed", "Daily, open-3 PM", "Mon", "See current official menu", "Tue", "Sun"];
  assert.deepEqual(
    [...kelseys].sort((a, b) => weekRank(a) - weekRank(b)),
    ["Mon", "Tue", "Wed", "Sun", "Daily 3-5 PM & 8 PM-close", "Daily, open-3 PM", "See current official menu"],
  );
  // Among offers starting the same day, the narrower one first; among the all-week ones, the one
  // on fewer days first.
  assert.ok(weekRank("Tue") < weekRank("Tue–Fri 4–6 PM"));
  assert.ok(weekRank("Mon-Fri 2-5 PM") < weekRank("Daily"));
  // A Sunday special is still a special, and belongs before the daily happy hour.
  assert.ok(weekRank("Sun") < weekRank("Mon-Fri 2-5 PM"));
});

test("one schedule written two ways has one shape, and another hour is another schedule", () => {
  // How the nationwide list tells an offer worded twice from two offers (sameOfferKey).
  assert.equal(scheduleShape("Tue"), scheduleShape("Tuesdays"));
  assert.equal(scheduleShape("Mon-Fri 11 AM-3 PM"), scheduleShape("Weekdays 11am-3pm"));
  assert.equal(scheduleShape("Daily"), scheduleShape("Daily, in restaurant"));
  assert.notEqual(scheduleShape("2pm-5pm, Sun-Thu 9pm-close, Fri-Sat 10pm-close"), scheduleShape("2pm-5pm & 9pm-close"));
  assert.notEqual(scheduleShape("Tue"), scheduleShape("Wed"));
  assert.notEqual(scheduleShape("Daily"), scheduleShape("Daily 6-9 AM"));
});

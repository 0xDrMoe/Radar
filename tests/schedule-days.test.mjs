import assert from "node:assert/strict";
import test from "node:test";
import {
  availabilityFromSchedule,
  availabilityFromStructuredSchedule,
  scheduleRowDays,
  scheduleWeekdays,
} from "../app/search.ts";

// Which days, and which hours on each day, a schedule runs - the reading behind "on now", the
// "Tonight" filter and a venue's week.

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const days = (schedule) => scheduleWeekdays(schedule).map((day) => DAY[day]).join(" ");

// Instants in America/Toronto, where every one of these is read.
const ZONE = "America/Toronto";
const TUE_NOON = new Date("2026-09-29T16:00:00Z");
const TUE_1730 = new Date("2026-09-29T21:30:00Z");
const TUE_2330 = new Date("2026-09-30T03:30:00Z");
const WED_0100 = new Date("2026-09-30T05:00:00Z");
const SAT_NOON = new Date("2026-10-03T16:00:00Z");

// Every distinct `schedule` on a live deal in the production export of 2026-09-30, with the days
// it reads as. Read and checked by hand when it was written: a change to the parser that moves any
// of these has to move this table too, and whoever moves it reads the line they changed.
const LIVE_SCHEDULES = [
  ["3–6 PM & 9 PM–close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["4:30–6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Any time of day", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily (Sausage McMuffin meal at breakfast)", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 10:30 AM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 11 AM-7 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2-4 PM & 9 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2-5 PM & 11 PM-2 AM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2-5 PM & 9 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2-5 PM (bar only)", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2-6 PM & 9 PM-close (lounge)", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2pm-5pm & 8pm-late", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2pm-5pm & 9pm-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2pm-5pm, Sun-Thu 9pm-close, Fri-Sat 10pm-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2–5 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2–5 PM & 9 PM–close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 2–5 PM; beverage purchase required", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5 PM & 8 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5 PM & 9 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5 PM; Sun-Thu 9 PM-close, Fri-Sat 10 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5:30 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5pm & 9pm-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-5pm; Sun-Thu 9-11pm", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-6 PM & 9 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-6 PM - Thu-Sat 9:30-11 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-6 PM; Sun-Thu 9 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3-6 PM; Sun-Thu 9 PM-close, Fri-Sat 10 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3pm-6pm", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3–5 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3–6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 3–6 PM & 10 PM–close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4-7 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4:30–6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4:30–6:30 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4–6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4–6 PM & 10 PM–late", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 4–7 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 5-7 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 5–8 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily 8 PM-close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily after 9 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily at breakfast, once a week, through Oct 4", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily feature", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily from lunch", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily rotating special", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Dec 31", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Nov 1", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Oct 18", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Oct 25", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Oct 4", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Oct 9", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Sep 30", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily through Sept 30", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, Halloween season", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, before 11 AM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, limited time", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, lunch and dinner", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, on online pickup orders", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, on pickup orders over $30", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, once a week, through Oct 4", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, open-3 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, takeout orders", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, while supplies last", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, while supplies last; coupons valid through Dec 31", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, with student ID", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily, with student card", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily; breakfast version during breakfast hours", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Daily; in store after 8 PM, all day in the app", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Event days", ""],
  ["Every day", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Every day 11:30 AM–2:30 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Fri", "Fri"],
  ["Fri-Sat 4 PM-close", "Fri Sat"],
  ["Fridays", "Fri"],
  ["Fridays 3–10 PM", "Fri"],
  ["Fridays after 2 PM", "Fri"],
  ["Fridays after 5 PM", "Fri"],
  ["Fridays, all day", "Fri"],
  ["Late night; confirm start time with restaurant", ""],
  ["Lunch, Tue-Sun", "Sun Tue Wed Thu Fri Sat"],
  ["Mon", "Mon"],
  ["Mon & Sat from 7 PM", "Mon Sat"],
  ["Mon & Tue", "Mon Tue"],
  ["Mon & Tue 11 AM-7:30 PM", "Mon Tue"],
  ["Mon 3–6 PM", "Mon"],
  ["Mon 5 PM-late", "Mon"],
  ["Mon from 5 PM", "Mon"],
  ["Mon, Wed & Sun", "Sun Mon Wed"],
  ["Mon, all day", "Mon"],
  ["Mon-Fri", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 10 AM-2 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 10:30 AM-2 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 11 AM-1:30 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 11 AM-3 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 11 AM-4 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 2-4 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 2-5 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 3-6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 3-6:30 PM - Sat-Sun 4-6 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon-Fri 4-5 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 4-6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 4-6 PM & 9 PM-close", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri 5-6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon-Fri, lunch", "Mon Tue Wed Thu Fri"],
  ["Mon-Thu 5-6 PM, Fri 4:30-6 PM; Mon-Fri 9 PM-close", "Mon Tue Wed Thu Fri"],
  ["Mon-Thu, with student ID", "Mon Tue Wed Thu"],
  ["Mon-Wed 4-6 PM, Thu-Sun 3-6 PM; Wed-Thu 9-10 PM, Fri 9 PM-12 AM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mondays", "Mon"],
  ["Mondays & Saturdays from 7 PM", "Mon Sat"],
  ["Mondays (dinner special)", "Mon"],
  ["Mondays 10:30 AM-8:30 PM", "Mon"],
  ["Mondays 11 AM-10 PM", "Mon"],
  ["Mondays 3–10 PM", "Mon"],
  ["Mondays 4-9 PM", "Mon"],
  ["Mondays 4–11 PM", "Mon"],
  ["Mondays after 2 PM", "Mon"],
  ["Mondays after 5 PM", "Mon"],
  ["Mondays and Fridays, all day", "Mon Fri"],
  ["Mondays and Thursdays 4-9 PM", "Mon Thu"],
  ["Mondays and Thursdays, 4 PM-close", "Mon Thu"],
  ["Mondays from 2 PM", "Mon"],
  ["Mondays from 5 PM", "Mon"],
  ["Mondays, all day", "Mon"],
  ["Mondays, online only", "Mon"],
  ["Mondays–Fridays 11:30 AM–3 PM", "Mon Tue Wed Thu Fri"],
  ["Mondays–Thursdays", "Mon Tue Wed Thu"],
  ["Mondays–Wednesdays", "Mon Tue Wed"],
  ["Monday–Saturday", "Mon Tue Wed Thu Fri Sat"],
  ["Mon–Fri 12–7 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 2–5 PM; daily 9 PM–close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon–Fri 2–5 PM; nightly late hours", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon–Fri 3–5 PM & 9 PM–close; weekends 9 PM–close", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon–Fri 3–5:30 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 3–6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 3–6 PM & 9 PM–close", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 4:30–6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 4:30–6:30 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 4–6 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 4–7 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri 7–11 AM; excludes holidays", "Mon Tue Wed Thu Fri"],
  ["Mon–Fri until 7 PM", "Mon Tue Wed Thu Fri"],
  ["Mon–Sat 3–5 PM", "Mon Tue Wed Thu Fri Sat"],
  ["Mon–Sat 5–7 PM", "Mon Tue Wed Thu Fri Sat"],
  ["Mon–Sun 10 AM–9 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon–Sun 5–7 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Mon–Thu 4–6 PM", "Mon Tue Wed Thu"],
  ["Mon–Thu 4–7 PM; Fri 2–6 PM", "Mon Tue Wed Thu Fri"],
  ["NFL gamedays: Sun, Mon, Thu", "Sun Mon Thu"],
  ["Oct 17 only", ""],
  ["Oct 2-3", ""],
  ["Oct 4 only", ""],
  ["Oct 6 only", ""],
  ["Oct 6 only; reward good 14 days", ""],
  ["Oct 6-11", ""],
  ["Sat", "Sat"],
  ["Sat & Sun", "Sun Sat"],
  ["Sat, all day", "Sat"],
  ["Sat-Sun, online only", "Sun Sat"],
  ["Saturdays", "Sat"],
  ["Saturdays 10 AM–10 PM", "Sat"],
  ["Saturdays after 2 PM", "Sat"],
  ["Saturdays, all day", "Sat"],
  ["See current official menu", ""],
  ["Sep 29 only", ""],
  ["Sept 26-29", ""],
  ["Sept 29 only", ""],
  ["Sun", "Sun"],
  ["Sun 3 PM-close", "Sun"],
  ["Sun-Thu 10 PM-12 AM", "Sun Mon Tue Wed Thu"],
  ["Sun-Thu 2-5 PM & 9 PM-close", "Sun Mon Tue Wed Thu"],
  ["Sundays", "Sun"],
  ["Sundays 10 AM–10 PM", "Sun"],
  ["Sundays after 5 PM", "Sun"],
  ["Sundays from 2 PM", "Sun"],
  ["Sundays through Dec 27", "Sun"],
  ["Sundays through Nov 1", "Sun"],
  ["Sundays, all day", "Sun"],
  ["Thu", "Thu"],
  ["Thu 10 PM-close", "Thu"],
  ["Thu 4 PM-close", "Thu"],
  ["Thu 7-11 PM", "Thu"],
  ["Thu 8 PM-close", "Thu"],
  ["Thu from 4 PM", "Thu"],
  ["Thu, Fri & Sun 7-11 PM", "Sun Thu Fri"],
  ["Thu, all day", "Thu"],
  ["Thursdays", "Thu"],
  ["Thursdays (dinner special)", "Thu"],
  ["Thursdays 10:30 AM-8:30 PM", "Thu"],
  ["Thursdays 3–10 PM", "Thu"],
  ["Thursdays 4-9 PM", "Thu"],
  ["Thursdays after 2 PM", "Thu"],
  ["Thursdays after 7 PM", "Thu"],
  ["Thursdays from 2 PM", "Thu"],
  ["Thursdays from 4 PM", "Thu"],
  ["Thursdays from 5 PM", "Thu"],
  ["Thursdays through Dec 31", "Thu"],
  ["Thursdays, all day", "Thu"],
  ["Tue", "Tue"],
  ["Tue 5 PM-close", "Tue"],
  ["Tue 5-10 PM", "Tue"],
  ["Tue 5–10 PM", "Tue"],
  ["Tue 6 PM-close", "Tue"],
  ["Tue 7-11 PM", "Tue"],
  ["Tue from 4 PM", "Tue"],
  ["Tue from 5 PM", "Tue"],
  ["Tue, Thu-Sun 5-7 PM", "Sun Tue Thu Fri Sat"],
  ["Tue, all night", "Tue"],
  ["Tue-Sat", "Tue Wed Thu Fri Sat"],
  ["Tue-Sun 3-5 PM", "Sun Tue Wed Thu Fri Sat"],
  ["Tue-Wed and Fri-Sat through Oct 24", "Tue Wed Fri Sat"],
  ["Tuesday 3 PM–1 AM", "Tue"],
  ["Tuesday all day", "Tue"],
  ["Tuesdays", "Tue"],
  ["Tuesdays (dinner special)", "Tue"],
  ["Tuesdays 11 AM-9 PM", "Tue"],
  ["Tuesdays 3 PM–1 AM", "Tue"],
  ["Tuesdays 3–10 PM", "Tue"],
  ["Tuesdays 4-9 PM", "Tue"],
  ["Tuesdays 4–11 PM", "Tue"],
  ["Tuesdays after 2 PM", "Tue"],
  ["Tuesdays from 2 PM", "Tue"],
  ["Tuesdays from 4 PM", "Tue"],
  ["Tuesdays from 7 PM", "Tue"],
  ["Tuesdays, all day", "Tue"],
  ["Tue–Fri 4:30–6 PM", "Tue Wed Thu Fri"],
  ["Tue–Fri 4–6 PM; oysters 5 PM–late", "Tue Wed Thu Fri"],
  ["Tue–Sat 4–6 PM", "Tue Wed Thu Fri Sat"],
  ["Tue–Sun 4–6 PM", "Sun Tue Wed Thu Fri Sat"],
  ["Wed", "Wed"],
  ["Wed 2 PM-close", "Wed"],
  ["Wed 4 PM-midnight", "Wed"],
  ["Wed 5 PM-close", "Wed"],
  ["Wed 6 PM-close", "Wed"],
  ["Wed 8 PM-close", "Wed"],
  ["Wed from 5 PM", "Wed"],
  ["Wed, all day", "Wed"],
  ["Wed-Fri 5-7 PM", "Wed Thu Fri"],
  ["Wed-Sat 11 PM-close", "Wed Thu Fri Sat"],
  ["Wed-Sat 4-7 PM", "Wed Thu Fri Sat"],
  ["Wed-Thu & Sun 5-6 PM - Fri-Sat 9 PM-12 AM", "Sun Wed Thu Fri Sat"],
  ["Wednesday open–close", "Wed"],
  ["Wednesdays", "Wed"],
  ["Wednesdays (dinner special)", "Wed"],
  ["Wednesdays 11 AM-9 PM", "Wed"],
  ["Wednesdays 3 PM–close", "Wed"],
  ["Wednesdays 3–10 PM", "Wed"],
  ["Wednesdays 4-9 PM", "Wed"],
  ["Wednesdays after 2 PM", "Wed"],
  ["Wednesdays from 2 PM", "Wed"],
  ["Wednesdays from 8 PM", "Wed"],
  ["Wednesdays, all day", "Wed"],
  ["Wednesdays, breakfast hours", "Wed"],
  ["Wednesday–Sunday after 7:30 PM", "Sun Wed Thu Fri Sat"],
  ["Weekdays 11:30 AM–4 PM", "Mon Tue Wed Thu Fri"],
  ["Weekdays 3–6 PM", "Mon Tue Wed Thu Fri"],
  ["Weekdays 8–11:30 AM, weekends 8 AM–2:30 PM", "Sun Mon Tue Wed Thu Fri Sat"],
  ["Weekends 11:30 AM–2:30 PM", "Sun Sat"],
];

test("every live schedule reads as the days it names", () => {
  assert.equal(LIVE_SCHEDULES.length, 259);
  for (const [schedule, expected] of LIVE_SCHEDULES) assert.equal(days(schedule), expected, schedule);
});

test("the ways of saying every day are every day", () => {
  // Twelve live offers said "Every day" and read as no day at all, so they were never on today.
  for (const schedule of ["Every day", "Everyday", "every day 11 AM-2 PM", "Any time of day", "Anytime", "7 days a week",
    "Seven days", "All week", "Daily", "Nightly", "Every night"]) {
    assert.equal(days(schedule), "Sun Mon Tue Wed Thu Fri Sat", schedule);
  }
  assert.equal(availabilityFromSchedule("Every day", TUE_NOON, ZONE).eligibleToday, true);
  // A count of days that is not seven is not every day.
  assert.equal(days("Reward good 17 days"), "");
});

test("weekends are Saturday and Sunday, and on nothing else", () => {
  assert.equal(days("Weekends 11:30 AM–2:30 PM"), "Sun Sat");
  assert.equal(days("Weekend brunch"), "Sun Sat");
  assert.equal(days("Sat & Sun"), "Sun Sat");
  assert.equal(days("Saturday and Sunday"), "Sun Sat");
  // It read as every day, and so as on now at noon on a Tuesday.
  const tuesday = availabilityFromSchedule("Weekends 11:30 AM–2:30 PM", TUE_NOON, ZONE);
  assert.equal(tuesday.eligibleToday, false);
  assert.equal(tuesday.availableNow, false);
  assert.equal(availabilityFromSchedule("Weekends 11:30 AM–2:30 PM", SAT_NOON, ZONE).availableNow, true);
});

test("a schedule with a weekday clause and a weekend clause runs on both", () => {
  assert.equal(days("Weekdays 8–11:30 AM, weekends 8 AM–2:30 PM"), "Sun Mon Tue Wed Thu Fri Sat");
  assert.equal(days("Mon–Fri 3–5 PM & 9 PM–close; weekends 9 PM–close"), "Sun Mon Tue Wed Thu Fri Sat");
  assert.equal(days("Weeknights 5-7 PM"), "Mon Tue Wed Thu Fri");
});

test("each clause keeps its own hours", () => {
  // The weekend's 8 AM–2:30 PM is not a Tuesday's: at noon on a Tuesday the weekday breakfast,
  // which ends at 11:30, is over.
  const breakfast = "Weekdays 8–11:30 AM, weekends 8 AM–2:30 PM";
  assert.equal(availabilityFromSchedule(breakfast, TUE_NOON, ZONE).phase, "ended");
  assert.equal(availabilityFromSchedule(breakfast, SAT_NOON, ZONE).availableNow, true);
  // Friday's 2-6 is Friday's alone.
  const week = "Mon–Thu 4–7 PM; Fri 2–6 PM";
  assert.equal(availabilityFromSchedule(week, TUE_NOON, ZONE).phase, "upcoming");
  assert.equal(availabilityFromSchedule(week, TUE_1730, ZONE).availableNow, true);
  // A weekend with only the late window is not on in the afternoon.
  const lateWeekend = "Mon–Fri 3–5 PM & 9 PM–close; weekends 9 PM–close";
  const saturdayAfternoon = new Date("2026-10-03T20:00:00Z");
  assert.equal(availabilityFromSchedule(lateWeekend, saturdayAfternoon, ZONE).availableNow, false);
  assert.equal(availabilityFromSchedule(lateWeekend, new Date("2026-09-29T20:00:00Z"), ZONE).availableNow, true, "Tuesday 4 PM");
  // A list of days is one clause: 7-11 PM on all three, not all day Thursday and Friday.
  const pitchers = "Thu, Fri & Sun 7-11 PM";
  const thursdayNoon = new Date("2026-10-01T16:00:00Z");
  assert.equal(availabilityFromSchedule(pitchers, thursdayNoon, ZONE).phase, "upcoming");
  // A window with no day ahead of it is still every day's.
  assert.equal(availabilityFromSchedule("3–6 PM & 9 PM–close", TUE_2330, ZONE).availableNow, true);
  // A day given hours by one clause keeps them; a day no clause gives hours to is on all day.
  const nightly = "Mon–Fri 2–5 PM; nightly late hours";
  assert.equal(availabilityFromSchedule(nightly, TUE_2330, ZONE).phase, "ended");
  assert.equal(availabilityFromSchedule(nightly, SAT_NOON, ZONE).label, "Available today");
});

test("day names are whole words", () => {
  for (const schedule of ["Lemon pepper wings 5-7 PM", "Edmonton locations 5-7 PM", "At sunset 5-7 PM", "With fries 5-7 PM"]) {
    assert.equal(days(schedule), "Sun Mon Tue Wed Thu Fri Sat", `${schedule} names no day, so its hours make it every day`);
  }
  assert.equal(days("Tues & Thurs"), "Tue Thu");
  assert.equal(days("Mon to Fri"), "Mon Tue Wed Thu Fri");
});

test("a start with no end runs until close, and an end with no start from the morning", () => {
  const from = availabilityFromSchedule("Tuesdays from 4 PM", TUE_NOON, ZONE);
  assert.equal(from.phase, "upcoming");
  assert.equal(from.label, "Later today · from 4 PM");
  assert.equal(availabilityFromSchedule("Tuesdays from 4 PM", TUE_1730, ZONE).label, "Available now · from 4 PM");
  assert.equal(availabilityFromSchedule("Daily after 9 PM", TUE_2330, ZONE).availableNow, true);
  assert.equal(availabilityFromSchedule("Mon–Fri until 7 PM", TUE_1730, ZONE).availableNow, true);
  assert.equal(availabilityFromSchedule("Mon–Fri until 7 PM", TUE_2330, ZONE).phase, "ended");
  assert.equal(availabilityFromSchedule("Daily, before 11 AM", TUE_NOON, ZONE).phase, "ended");
  assert.equal(availabilityFromSchedule("Daily, open-3 PM", TUE_1730, ZONE).phase, "ended");
  // "late" and "midnight" end a range the way "close" does.
  assert.equal(availabilityFromSchedule("Tue 5 PM-late", TUE_2330, ZONE).availableNow, true);
  assert.equal(availabilityFromSchedule("Wed 4 PM-midnight", new Date("2026-09-30T22:00:00Z"), ZONE).availableNow, true);
  // On all day in the app, so not "later today" at noon because of the in-store hours.
  assert.equal(availabilityFromSchedule("Daily; in store after 8 PM, all day in the app", TUE_NOON, ZONE).label, "Available today");
});

test("tonight is on today, not over, with hours that reach the evening", () => {
  const tonight = (schedule, at) => availabilityFromSchedule(schedule, at, ZONE).tonight;
  assert.equal(tonight("Tue", TUE_NOON), true, "a wing night on its own night");
  assert.equal(tonight("Mon", TUE_NOON), false, "a Monday wing night on a Tuesday");
  assert.equal(tonight("Tue 5 PM-close", TUE_2330), true);
  assert.equal(tonight("Daily 3-6 PM", TUE_NOON), true, "a happy hour still to come");
  assert.equal(tonight("Daily 3-6 PM", TUE_2330), false, "and not once it is over");
  assert.equal(tonight("Mon-Fri 11 AM-3 PM", TUE_NOON), false, "a lunch that ends at 3 is not tonight's");
  assert.equal(tonight("Daily, before 11 AM", TUE_NOON), false);
  assert.equal(tonight("Weekends 11:30 AM–2:30 PM", SAT_NOON), false);
  assert.equal(tonight("Tuesday 3 PM–1 AM", TUE_NOON), true);
});

// Every `days` value deal_schedules holds, as the admin writes them.
const ROW_DAYS = [
  ['["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]', [0, 1, 2, 3, 4, 5, 6]],
  ['["mon","tue","wed","thu","fri","sat","sun"]', [0, 1, 2, 3, 4, 5, 6]],
  ['["mon","tue","wed","thu","fri","sat"]', [1, 2, 3, 4, 5, 6]],
  ['["Mon","Tue","Wed","Thu","Fri"]', [1, 2, 3, 4, 5]],
  ['["mon","tue","wed","thu","fri"]', [1, 2, 3, 4, 5]],
  ['["Tue","Wed","Thu","Fri","Sat","Sun"]', [0, 2, 3, 4, 5, 6]],
  ['["tue","wed","thu","fri"]', [2, 3, 4, 5]],
  ['["Wed","Thu","Fri"]', [3, 4, 5]],
  ['["Thu","Fri","Sun"]', [0, 4, 5]],
  ['["Mon"]', [1]],
  ['["mon"]', [1]],
  ['["Tue"]', [2]],
  ['["tue"]', [2]],
  ['["Wed"]', [3]],
  ['["Thu"]', [4]],
  ['[]', []],
];

test("deal_schedules days are read in the format the admin writes them", () => {
  for (const [value, expected] of ROW_DAYS) assert.deepEqual(scheduleRowDays(value), expected, value);
  // Numbers, whole names and a comma list are read too; anything else is not a day.
  assert.deepEqual(scheduleRowDays("[2]"), [2]);
  assert.deepEqual(scheduleRowDays("1,2,3,4,5"), [1, 2, 3, 4, 5]);
  assert.deepEqual(scheduleRowDays('["Tuesday","THURSDAY"]'), [2, 4]);
  assert.deepEqual(scheduleRowDays('["Tuxedo", 9, "sunset"]'), []);
  assert.deepEqual(scheduleRowDays(null), []);
});

test("a timed row with day names decides on now", () => {
  // The row behind Tim Hortons' Timbits Tuesday when the audit found this: Tue 06:00-21:00, which
  // came back "Available today" at 11 PM because the row was never read.
  const at = (date) => availabilityFromStructuredSchedule('["Tue"]', "06:00", "21:00", ZONE, date);
  assert.equal(at(TUE_NOON).availableNow, true);
  assert.equal(at(TUE_NOON).label, "Available now · until 9 PM");
  const late = at(TUE_2330);
  assert.equal(late.availableNow, false);
  assert.equal(late.phase, "ended", "it ran today and is over, not 'next available Tuesday'");
  assert.equal(late.eligibleToday, true);
  assert.equal(late.label, "Ended for today");
  assert.equal(at(SAT_NOON).label, "Next available Tuesday · 6 AM–9 PM");
  // The lower-case names the other half of the rows use read the same way.
  assert.equal(availabilityFromStructuredSchedule('["mon","tue","wed","thu","fri"]', "15:00", "18:00", ZONE, TUE_1730).availableNow, true);
  assert.equal(availabilityFromStructuredSchedule('["Tue"]', "17:00", "22:00", ZONE, TUE_NOON).label, "Later today · 5 PM–10 PM");
});

test("a timed row's line is in the reader's language", () => {
  assert.equal(availabilityFromStructuredSchedule('["Tue"]', "06:00", "21:30", ZONE, TUE_NOON, "fr").label, "Disponible maintenant · jusqu'à 21 h 30");
  assert.equal(availabilityFromStructuredSchedule('["Tue"]', "06:00", "21:00", ZONE, TUE_NOON, "es").label, "Disponible ahora · hasta las 21:00");
});

test("a timed row past midnight is on in the small hours of the next day", () => {
  const row = (date) => availabilityFromStructuredSchedule('["Tue"]', "22:00", "02:00", ZONE, date);
  assert.equal(row(WED_0100).availableNow, true);
  assert.equal(row(TUE_2330).availableNow, true);
  assert.equal(row(TUE_NOON).phase, "upcoming");
  assert.equal(row(TUE_NOON).tonight, true);
});

test("a row that says nothing usable leaves the text to decide", () => {
  assert.equal(availabilityFromStructuredSchedule("[]", "11:00", "22:00", ZONE, TUE_NOON), null);
  assert.equal(availabilityFromStructuredSchedule('["Tue"]', null, null, ZONE, TUE_NOON), null);
  assert.equal(availabilityFromStructuredSchedule('["Tue"]', "noon", "late", ZONE, TUE_NOON), null);
});

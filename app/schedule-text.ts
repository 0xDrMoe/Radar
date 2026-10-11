// Turning a schedule written in prose into the days and times the editor asks for.
//
// Why this exists
// ---------------
// Every imported deal carries its schedule as free text - "Sun-Thu 10 PM-12 AM", "Tue-Fri 2-6 PM,
// Sat-Sun 4-6 PM" - and the admin editor needs seven day checkboxes and two clock fields. Of 77
// imported drafts, 76 have the text and 1 has the structure, because the only way across that gap
// was a person reading the sentence and re-entering it by hand. The editor was already showing the
// sentence in a note next to the empty checkboxes, which is the whole problem stated out loud.
//
// What it must never do
// ---------------------
// Save anything. This fills the form and stops; the days light up, the times populate, and a person
// looks at them before pressing save. That is not a formality - it is the entire reason this is
// safe. "The hours are right and dated" is the one claim Radar makes that its competitors do not,
// and a parser that wrote directly to the database would be spending that claim to save two clicks.
//
// So it is built to abstain. An input it cannot read confidently returns no windows at all rather
// than a guess, because a wrong schedule silently filled in is worse than an empty form: the empty
// form tells you it needs you.

export type ScheduleWindow = { days: string[]; start: string; end: string };

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND = ["sat", "sun"];

const DAY_WORD = "(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*";
// One item of a day list is itself possibly a range, so that "Tue, Thu-Sun" is a single spec.
// Written the other way round - a list of bare words with one optional range at the front - it
// matched "Tue, Thu", left "-Sun" to start a second spec, and the time range at the end of the
// sentence attached only to that: "Tue, Thu-Sun 5-7 PM" came out as Sunday alone. Four days
// disappeared, with nothing to show a reviewer that anything had been dropped.
const DAY_ITEM = `${DAY_WORD}(?:\\s*(?:[-–—]|to|through)\\s*${DAY_WORD})?`;
const DAY_SPEC = new RegExp(
  `(daily|every\\s?day|all\\s?week|weeknights?|weekdays?|weekends?|${DAY_ITEM}(?:\\s*(?:,|&|and|\\+)\\s*${DAY_ITEM})*)`,
  "gi",
);

// A time range, with the meridiem optionally stated only once ("2-6 PM") and a word for the end.
// "midnight" and "noon" are real clock times rather than a vague "close", and restaurants write
// them far more often than "12 AM" - a late happy hour on their own site almost always reads
// "10pm to midnight". Reading them costs one alternative and turns a whole shape of sentence from
// unparseable into exact.
const END_WORD = "close|closing|late|midnight|noon";
// "3:00 p.m. – 5:00 p.m" is how Clark's Oyster Bar writes its happy hour, and it is a common house
// style. Without the optional periods the meridiem is simply absent, which - since a range stating
// no meridiem is refused - meant the sentence read as no schedule at all.
const MERIDIEM = "([ap]\\.?m\\.?)";
const TIME_RANGE = new RegExp(
  `(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?\\s*(?:[-–—]|to|until|till|til)\\s*(?:(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?|(${END_WORD}))`,
  "gi",
);
// What each of those words is on the clock. "close" is not a time anyone published, so it keeps
// the end-of-day stand-in the editor already used for it.
const END_WORD_CLOCK: Record<string, string> = {
  close: "23:59",
  closing: "23:59",
  late: "23:59",
  midnight: "00:00",
  noon: "12:00",
};

/** The days a spec names, always in week order, or an empty array if it names none. */
function daysFrom(spec: string): string[] {
  const text = spec.toLowerCase();
  // Week order throughout, so the checkboxes light up in the order they are drawn and two specs
  // that name the same days are recognizably the same set.
  const inOrder = (days: string[]) => DAY_NAMES.filter((day) => days.includes(day));
  if (/daily|every\s?day|all\s?week/.test(text)) return [...DAY_NAMES];
  if (/weeknight|weekday/.test(text)) return inOrder(WEEKDAYS);
  if (/weekend/.test(text)) return inOrder(WEEKEND);

  const found = new Set<string>();
  // A range first, because "mon-fri" also contains two bare day words and would otherwise read as
  // exactly those two days.
  const range = new RegExp(`(${DAY_WORD})\\s*(?:[-–—]|to|through)\\s*(${DAY_WORD})`, "gi");
  let consumed = text;
  for (const match of text.matchAll(range)) {
    const from = DAY_NAMES.indexOf(match[1].slice(0, 3).toLowerCase());
    const to = DAY_NAMES.indexOf(match[2].slice(0, 3).toLowerCase());
    if (from === -1 || to === -1) continue;
    // Wrapping is normal and intended: "Sun-Thu" is five days, "Fri-Sun" is three.
    for (let i = from; ; i = (i + 1) % 7) {
      found.add(DAY_NAMES[i]);
      if (i === to) break;
    }
    consumed = consumed.replace(match[0], " ");
  }
  for (const match of consumed.matchAll(new RegExp(DAY_WORD, "gi"))) {
    const day = DAY_NAMES.indexOf(match[0].slice(0, 3).toLowerCase());
    if (day !== -1) found.add(DAY_NAMES[day]);
  }
  return DAY_NAMES.filter((day) => found.has(day));
}

/** "10", "30", "pm" -> "22:30". Returns null for anything that is not a real clock time. */
function toClock(hourText: string, minuteText: string | undefined, meridiem: string | undefined): string | null {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith("p");
    // 12 AM is midnight and 12 PM is noon, which is the one case where the arithmetic inverts.
    hour = hour % 12;
    if (pm) hour += 12;
  } else if (hour === 24) {
    hour = 0;
  }
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Every time window a fragment states.
 *
 * More than one, because a happy hour is commonly two: "Mon-Fri 3-6 PM & 9 PM-close" names its days
 * once and its hours twice, and reading only the first silently drops the late window - which is
 * often the better deal and the one somebody is out looking for.
 */
function timesFrom(fragment: string): Array<{ start: string; end: string }> {
  const found: Array<{ start: string; end: string }> = [];
  for (const match of fragment.matchAll(TIME_RANGE)) {
    const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem, closeWord] = match;

    // A range that states no meridiem anywhere is not a time this can read. "Happy hour daily from
    // 2 to 5" means the afternoon to every human and 02:00-05:00 to the arithmetic, and a 2 AM
    // happy hour on a deal page is the kind of wrong that gets somebody out of bed. Abstaining is
    // the house rule. A 24-hour clock says so with its minutes ("14:00-17:00"), and an end word
    // carries its own meaning, so neither is caught by this.
    const meridiemStated = Boolean(startMeridiem || endMeridiem);
    const clockStated = Boolean(startMinute || endMinute);
    if (!meridiemStated && !clockStated && !closeWord) continue;

    // "2-6 PM" states the meridiem once, at the end, and means it for both. "10 PM-12 AM" states
    // both and means both. Borrowing the stated one is right; inventing one is not.
    const start = toClock(startHour, startMinute, startMeridiem || endMeridiem);
    if (!start) continue;
    if (closeWord) {
      found.push({ start, end: END_WORD_CLOCK[closeWord.toLowerCase()] });
      continue;
    }
    const end = toClock(endHour, endMinute, endMeridiem || startMeridiem);
    if (end) found.push({ start, end });
  }
  return found;
}

/**
 * Every day/time window a schedule sentence states.
 *
 * Each day spec claims the text up to the next one, so "Tue-Fri 2-6 PM, Sat-Sun 4-6 PM" reads as
 * two windows rather than one window with nine days in it. A spec with no time range beside it is
 * dropped: naming days without hours is not a schedule the editor can hold, and guessing the hours
 * is the one thing this must not do.
 */
export function parseScheduleText(text: string | null | undefined): ScheduleWindow[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const value = text.replace(/\s+/g, " ");

  const specs = [...value.matchAll(DAY_SPEC)];
  const windows: ScheduleWindow[] = [];

  if (!specs.length) {
    // No day named at all. A bare "3-6 PM" is an everyday offer written loosely, which is how the
    // rest of the codebase already reads it - see availabilityFromSchedule in app/search.ts.
    return timesFrom(value).map((times) => ({ days: [...DAY_NAMES], ...times }));
  }

  for (const [index, spec] of specs.entries()) {
    const from = (spec.index ?? 0) + spec[0].length;
    const to = index + 1 < specs.length ? specs[index + 1].index ?? value.length : value.length;
    const days = daysFrom(spec[0]);
    if (!days.length) continue;
    // Every time range beside this spec belongs to these days, so an afternoon and a late window
    // stated together both survive.
    for (const times of timesFrom(value.slice(from, to))) windows.push({ days, ...times });
  }

  // A day spec claims the text to its RIGHT, so times stated before the first one have no owner at
  // all and are dropped. Ancora writes "Happy Hour | 2:30 to 5pm, Daily" and lost its whole window
  // that way. Those times belong to the first spec when nothing but punctuation stands between -
  // "5pm, Daily" is one statement. "11:00pm Brunch Saturday" is two, and stays two, which is what
  // keeps a page's dinner service from being read as the deal.
  const firstSpecAt = specs[0].index ?? 0;
  const head = value.slice(0, firstSpecAt);
  const headTimes = [...head.matchAll(TIME_RANGE)];
  if (headTimes.length) {
    const last = headTimes[headTimes.length - 1];
    const between = head.slice((last.index ?? 0) + last[0].length);
    const days = daysFrom(specs[0][0]);
    if (!/[a-z]/i.test(between) && days.length) {
      for (const times of timesFrom(head)) windows.push({ days, ...times });
    }
  }

  // A day spec claims the text to its right, which loses the sentence that puts the days last:
  // "FOOD & DRINK SPECIALS 2 PM - 5 PM & 9 PM - Close EVERYDAY!" is a real happy hour written on a
  // real restaurant's homepage, and it parsed as nothing at all. When exactly one set of days is
  // named and nothing attached to it, the times anywhere in the sentence belong to those days -
  // there is no second spec they could belong to instead. More than one and it stays ambiguous,
  // so it stays unparsed.
  if (!windows.length && specs.length === 1) {
    const days = daysFrom(specs[0][0]);
    if (days.length) for (const times of timesFrom(value)) windows.push({ days, ...times });
  }

  // Identical windows collapse: "Mon 4-6 PM and Tue 4-6 PM" written as two specs is one window
  // with two days, not two rows for a person to look at and wonder about.
  const merged: ScheduleWindow[] = [];
  for (const window of windows) {
    const same = merged.find((m) => m.start === window.start && m.end === window.end);
    if (same) same.days = DAY_NAMES.filter((day) => same.days.includes(day) || window.days.includes(day));
    else merged.push(window);
  }
  return merged;
}

/** A short human summary of what was parsed, for the button that offers it. */
export function describeWindows(windows: ScheduleWindow[]): string {
  const label = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);
  return windows
    .map((w) => `${w.days.map(label).join(", ")} ${w.start}–${w.end}`)
    .join(" · ");
}

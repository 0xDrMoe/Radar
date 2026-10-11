// Finding one branch in a long list of them.
//
// Tim Hortons' Timbits Tuesday is confirmed at 120 addresses and Subway's buy-two-get-one at 84.
// Both were a bare <select>, and a native select's keyboard search is a prefix match against the
// option's own text: every one of those 120 options begins with the city, so typing "bank" to
// reach the Bank Street branch matched nothing at all, and typing "o" walked through Ottawa one
// option per keypress. The list was navigable by scrolling it and by nothing else.
//
// Kept out of the component so the matching is testable as a function instead of through a
// rendered listbox — see tests/branch-search.test.mjs.

/** Below this many branches a native <select> is the better control, so callers keep theirs. */
export const BRANCH_SEARCH_MIN = 9;

/** How many matches a listbox draws at once. The rest are counted, not rendered. */
export const BRANCH_RESULT_LIMIT = 50;

export interface BranchOption {
  /** How the caller identifies the branch — a location id, or the address it keys on. */
  value: string;
  /** The line a reader scans. */
  label: string;
  /** A second, quieter line: a distance, a neighborhood. */
  hint?: string;
}

export interface IndexedBranch {
  option: BranchOption;
  haystack: string;
}

const COMBINING = /[̀-ͯ]/g;
// Unicode-aware rather than [^a-z0-9]: collapsing punctuation must not quietly delete a script
// this regex was not written with in mind.
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/** Lowercased, unaccented, every run of punctuation collapsed to one space. */
export function normalizeBranchText(text: string): string {
  return text.normalize("NFD").replace(COMBINING, "").toLowerCase().replace(SEPARATORS, " ").trim();
}

/**
 * The words a query is asking for. Every one has to appear somewhere, in any order — so "ottawa
 * bank" and "bank ottawa" both find 1595 Bank St, Ottawa, which is the whole point of replacing a
 * control that could only match the beginning of a line.
 */
export function branchQueryTerms(query: string): string[] {
  const normalized = normalizeBranchText(query);
  return normalized ? normalized.split(" ") : [];
}

/**
 * Normalizes once per list rather than once per keystroke. NFD decomposition is the expensive part
 * of the work here and the options do not change while somebody is typing into them.
 *
 * The haystack is exactly the text the option row shows. A branch that matched on a field the
 * reader cannot see — the postal prefix the deal page deliberately stops sending to the browser,
 * say — reads as the filter choosing at random.
 */
export function indexBranches(options: BranchOption[]): IndexedBranch[] {
  return options.map((option) => ({
    option,
    haystack: normalizeBranchText(option.hint ? `${option.label} ${option.hint}` : option.label),
  }));
}

export interface BranchMatches {
  /** The matches worth drawing, capped at `limit`. */
  shown: BranchOption[];
  /** How many matched in total, so the UI can say what it left out. */
  total: number;
}

/**
 * Order is the caller's, untouched.
 *
 * It already carries more than a string comparison could: the deal's own branch first, then
 * distance from wherever the reader searched, then city and street. Ranking the survivors by how
 * well each one matched would spend that to answer a question nobody asked — somebody typing
 * "bank" is narrowing the list, not asking which Bank Street branch is the most Bank Street.
 */
export function matchBranches(indexed: IndexedBranch[], query: string, limit = BRANCH_RESULT_LIMIT): BranchMatches {
  const terms = branchQueryTerms(query);
  const matched = terms.length
    ? indexed.filter((entry) => terms.every((term) => entry.haystack.includes(term)))
    : indexed;
  return { shown: matched.slice(0, limit).map((entry) => entry.option), total: matched.length };
}

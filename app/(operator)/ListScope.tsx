"use client";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";

// Shared scoping for every list in an operator workspace — admin and the creator workspace both
// run their lists through it.
//
// Each of these tabs used to render its whole result set — up to 500 rows for deals and users,
// 400 for the audit log, 250 for suggestions — with no search and no indication that a cap even
// existed. Finding one record meant scrolling past all of them, and a list that had silently hit
// its server-side limit looked exactly like a complete one.
//
// Two rules, applied the same way everywhere so the tabs behave alike:
//
//   1. Everything is searchable. The search runs over the whole set, never the preview, so a
//      record below the fold is still findable by typing.
//   2. Nothing dumps its full set unasked. With no search and no filter, a list shows a bounded
//      preview and says so in words — "8 most recent of 240" — because a truncated list with no
//      caption reads as "that is everything", which is worse than the wall it replaces.
//
// Kept out of AdminClient.tsx so the selection rule is testable without rendering a component,
// following the precedent filterInventory already set there, and one level up from admin/ now
// that it is not only admin's.

export const LIST_PREVIEW_COUNT = 8;

export interface ListSelection<T> {
  /** Everything matching the search and any caller-side filters. */
  matched: T[];
  /** What to render now: `matched`, or a preview of it when nothing is being asked for. */
  visible: T[];
  /** Whether the operator narrowed the list themselves. Drives the count line's wording. */
  narrowed: boolean;
}

export function selectRows<T>(
  rows: T[],
  searchText: (row: T) => string,
  { query, filtered = false, showAll = false, previewCount = LIST_PREVIEW_COUNT }: {
    query: string;
    /** True when a caller-side control (a role, status or type filter) is also narrowing. */
    filtered?: boolean;
    showAll?: boolean;
    previewCount?: number;
  },
): ListSelection<T> {
  const needle = query.trim().toLowerCase();
  const matched = needle ? rows.filter((row) => searchText(row).toLowerCase().includes(needle)) : rows;
  const narrowed = Boolean(needle) || filtered;
  return { matched, narrowed, visible: narrowed || showAll ? matched : matched.slice(0, previewCount) };
}

// Says what is on screen versus what exists. The wording changes with the state because the three
// cases mean different things: a narrowed list is a result count, an expanded one is the whole
// set, and the default is a deliberate sample that has to say so.
export function listCountLabel(
  { matched, visible, narrowed }: ListSelection<unknown>,
  total: number,
  noun: string,
  showAll: boolean,
) {
  const plural = (n: number) => `${n} ${n === 1 ? noun : `${noun}s`}`;
  if (narrowed) return `${matched.length} of ${plural(total)}`;
  if (showAll || visible.length === total) return `All ${plural(total)}, newest first`;
  return `${visible.length} most recent of ${total} — search to find anything else`;
}

// ── Pages ────────────────────────────────────────────────────────────────────────────────────
// The staff workspace pages its lists instead of previewing eight rows and then dumping all of
// them: "Show all" on 500 accounts was a wall, and the preview hid that the rest existed. Paging
// works on the rows already loaded, so it costs the Worker nothing; search and filters still run
// over the whole set first, and paging only decides which slice of the result is on screen.

export const LIST_PAGE_SIZE = 25;

export interface ListPage<T> {
  rows: T[];
  /** 1-based, and always inside 1..pageCount, however stale the page that was asked for. */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row on this page; both 0 when there are none. */
  first: number;
  last: number;
  total: number;
}

export function pageRows<T>(rows: T[], page: number, pageSize = LIST_PAGE_SIZE): ListPage<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A filter can shrink the list under a later page; showing its last page beats an empty one.
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return { rows: slice, page: current, pageCount, first: slice.length ? start + 1 : 0, last: start + slice.length, total };
}

/** "26–50 of 240 accounts". Says where the reader is, which a page number alone does not. */
export function pageRangeLabel({ first, last, total }: ListPage<unknown>, noun: string, plural = `${noun}s`) {
  const nouns = `${total} ${total === 1 ? noun : plural}`;
  if (!total) return `No ${plural}`;
  return first === 1 && last === total ? `All ${nouns}` : `${first}–${last} of ${nouns}`;
}

export function ListToolbar({ query, onQuery, placeholder, label, children }: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  label: string;
  /** Optional extra filter controls, rendered beside the search box. */
  children?: React.ReactNode;
}) {
  return (
    <div className="inventory-tools list-tools">
      <label className="portal-search">
        <Search />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} aria-label={label} />
      </label>
      {children}
    </div>
  );
}

export function ListCount({ children }: { children: React.ReactNode }) {
  return <p className="list-count-line">{children}</p>;
}

// Only rendered when a preview is actually hiding something, so it never appears as a button that
// would do nothing.
export function ShowAllRow({ selection, total, noun, showAll, onShowAll }: {
  selection: ListSelection<unknown>;
  total: number;
  noun: string;
  showAll: boolean;
  onShowAll: () => void;
}) {
  if (selection.narrowed || showAll || selection.matched.length <= selection.visible.length) return null;
  return (
    <button type="button" className="tool-button" onClick={onShowAll}>
      <Users /> Show all {total} {total === 1 ? noun : `${noun}s`}
    </button>
  );
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return <p className="list-empty">{children}</p>;
}

/** Previous / next under a paged list. Renders nothing when everything fits on one page. */
export function Pager({ paged, noun, plural = `${noun}s`, onPage }: { paged: ListPage<unknown>; noun: string; plural?: string; onPage: (page: number) => void }) {
  if (paged.pageCount <= 1) return null;
  // Back to the top of the list, which is where a new page starts reading; the buttons are at its
  // foot. Instant rather than smooth, so nobody watches a long scroll back up.
  const go = (page: number) => (event: React.MouseEvent<HTMLButtonElement>) => {
    onPage(page);
    event.currentTarget.closest("section")?.scrollIntoView({ block: "start" });
  };
  return (
    <nav className="list-pager" aria-label={`Pages of ${plural}`}>
      <span className="list-pager-range" aria-live="polite">{pageRangeLabel(paged, noun, plural)}</span>
      <div className="list-pager-buttons">
        <button type="button" className="tool-button" onClick={go(paged.page - 1)} disabled={paged.page <= 1} aria-label="Previous page">
          <ChevronLeft aria-hidden="true" /> Previous
        </button>
        <span className="list-pager-page">Page {paged.page} of {paged.pageCount}</span>
        <button type="button" className="tool-button" onClick={go(paged.page + 1)} disabled={paged.page >= paged.pageCount} aria-label="Next page">
          Next <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

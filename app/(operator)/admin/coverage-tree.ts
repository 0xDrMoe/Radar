// The Market coverage tab's hierarchy: country, then province or state, then city, then postal
// area, each level with the totals of everything under it.
//
// The server sends one row per (country, region, city, postal area) that has a live, draft,
// scheduled or paused deal (the coverageTree read in app/api/admin/route.ts, brand-wide and national
// offers left out). This rolls those rows up, so the counts at every level are sums of the rows
// below rather than separate queries that could disagree with them. A blank level stays blank: the
// tab labels it "not recorded" rather than filing it under a guessed place.

export interface CoverageRow {
  country: string;
  region: string;
  city: string;
  postal_area: string;
  deals: number;
  live: number;
  drafts: number;
  restaurants: number;
  stale: number;
}

export type CoverageLevel = "country" | "region" | "city" | "postal";

export interface CoverageTotals {
  deals: number;
  live: number;
  drafts: number;
  stale: number;
  /**
   * Restaurants summed over the postal areas below. The server counts distinct restaurants per
   * postal area, so a chain with branches in two areas of one city is counted in each; the tab says so.
   */
  restaurants: number;
}

export interface CoverageNode {
  /** Unique across the tree: the path of values down to this node. */
  key: string;
  level: CoverageLevel;
  /** This level's own value, "" when it was not recorded. */
  value: string;
  /** Every level from the country down to this one, for links and filters. */
  place: { country: string; region: string; city: string; postal: string };
  totals: CoverageTotals;
  children: CoverageNode[];
}

const LEVELS: CoverageLevel[] = ["country", "region", "city", "postal"];

const emptyTotals = (): CoverageTotals => ({ deals: 0, live: 0, drafts: 0, stale: 0, restaurants: 0 });

function add(into: CoverageTotals, row: CoverageRow) {
  into.deals += Number(row.deals) || 0;
  into.live += Number(row.live) || 0;
  into.drafts += Number(row.drafts) || 0;
  into.stale += Number(row.stale) || 0;
  into.restaurants += Number(row.restaurants) || 0;
}

/** Biggest first, so the places with the most to look after lead; an unrecorded level always last. */
function sortNodes(nodes: CoverageNode[]) {
  nodes.sort((a, b) => Number(!a.value) - Number(!b.value) || b.totals.deals - a.totals.deals || a.value.localeCompare(b.value));
  for (const node of nodes) sortNodes(node.children);
}

export function buildCoverageTree(rows: readonly CoverageRow[]): { roots: CoverageNode[]; totals: CoverageTotals } {
  const roots: CoverageNode[] = [];
  const byKey = new Map<string, CoverageNode>();
  const totals = emptyTotals();
  for (const row of rows) {
    add(totals, row);
    const values = [(row.country || "").trim().toUpperCase(), (row.region || "").trim(), (row.city || "").trim(), (row.postal_area || "").trim().toUpperCase()];
    let siblings = roots;
    let key = "";
    for (let depth = 0; depth < LEVELS.length; depth += 1) {
      key += `\u0000${values[depth]}`;
      let node = byKey.get(key);
      if (!node) {
        node = {
          key,
          level: LEVELS[depth],
          value: values[depth],
          place: {
            country: values[0],
            region: depth >= 1 ? values[1] : "",
            city: depth >= 2 ? values[2] : "",
            postal: depth >= 3 ? values[3] : "",
          },
          totals: emptyTotals(),
          children: [],
        };
        byKey.set(key, node);
        siblings.push(node);
      }
      add(node.totals, row);
      siblings = node.children;
    }
  }
  sortNodes(roots);
  return { roots, totals };
}

/** The share of a level's deals whose check has lapsed, as a whole percent. */
export function stalePercent(totals: Pick<CoverageTotals, "deals" | "stale">): number {
  return totals.deals ? Math.round((totals.stale / totals.deals) * 100) : 0;
}

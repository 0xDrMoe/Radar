"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { GeoFilter, PanelHeader, StatePanel, countryName, geoFromSearch, geoIsSet, geoQuery, matchesGeo, type GeoFilterValue } from "../ui";
import { buildCoverageTree, stalePercent, type CoverageNode } from "../coverage-tree";
import { usePagedRows, useTabState, useWorkspace } from "../workspace";
import { Pager } from "../../ListScope";

// Where Radar has deals, as a hierarchy: country, province or state, city, postal area. It used to
// be a grid of launch-market cards at the foot of the overview, which said nothing about the
// places between those markets or inside them. The tree is read from each deal's own branch
// (coverageTree in app/api/admin/route.ts); the launch markets, with their targets and empty
// searches, are a second panel below it.

/** What a level is called when the deal's branch did not record it. Never a guessed place. */
const NOT_RECORDED: Record<CoverageNode["level"], string> = {
  country: "Country not recorded",
  region: "Province or state not recorded",
  city: "City not recorded",
  postal: "Postal area not recorded",
};

function nodeLabel(node: CoverageNode) {
  if (!node.value) return NOT_RECORDED[node.level];
  return node.level === "country" ? countryName(node.value) : node.value;
}

// market_coverage.status as stored (drizzle/0008, 0018); anything else is shown as written.
const MARKET_STATUS: Record<string, string> = { established: "Established", covered: "Covered", limited: "Limited", researching: "Researching" };
const MARKET_ESTABLISHED = new Set(["established", "covered"]);

export default function CoverageTab() {
  const { data, permissions, openTab, tabState } = useWorkspace();
  const canWorkDeals = ["create_deals", "publish_deals", "verify_deals"].some((permission) => permissions.has(permission));
  const canRead = canWorkDeals || permissions.has("view_analytics");
  // A deep link (/admin/coverage?region=NS) opens the tab already filtered, winning over a filter
  // kept from an earlier visit: written into the store before useTabState reads it, as in DraftReview.
  useState(() => {
    const linked = typeof window === "undefined" ? null : geoFromSearch(window.location.search);
    if (linked && geoIsSet(linked)) tabState.set("coverage.geo", linked);
  });
  const [geo, setGeo] = useTabState<GeoFilterValue>("coverage.geo", { country: "", region: "", city: "", postal: "" });
  const [expanded, setExpanded] = useTabState<string[]>("coverage.expanded", []);
  const [marketsOpen, setMarketsOpen] = useState(true);

  const rows = useMemo(() => data.coverageTree ?? [], [data.coverageTree]);
  const places = useMemo(() => rows.map((row) => ({ country: row.country, region: row.region, city: row.city, postal: row.postal_area })), [rows]);
  const filtered = useMemo(
    () => rows.filter((row) => matchesGeo({ country: row.country, region: row.region, city: row.city, postal: row.postal_area }, geo)),
    [rows, geo],
  );
  const tree = useMemo(() => buildCoverageTree(filtered), [filtered]);
  const cities = useMemo(() => new Set(rows.map((row) => row.city).filter(Boolean)), [rows]);
  const markets = useMemo(
    () => (data.coverage ?? []).filter((market) => matchesGeo({ country: market.country, region: market.region, city: market.market }, { ...geo, postal: "" })),
    [data.coverage, geo],
  );
  const [marketPage, setMarketPage] = usePagedRows("coverage.markets", markets, `${geo.country}|${geo.region}|${geo.city}`);

  if (!canRead) {
    return (
      <StatePanel kind="empty" title="Market coverage is not part of your role">
        It is read by staff who work on deals and by those with the analytics permission.
      </StatePanel>
    );
  }

  // With a place chosen the tree is already small, so every level under it is shown open.
  const filtering = geoIsSet(geo);
  const open = new Set(expanded);
  const isOpen = (node: CoverageNode) => filtering || open.has(node.key);
  function toggle(node: CoverageNode) {
    setExpanded((current) => (current.includes(node.key) ? current.filter((key) => key !== node.key) : [...current, node.key]));
  }
  // Inventory filtered to a city or postal area. A level that was not recorded is left out of the
  // query rather than sent blank, and a city that was not recorded gets no link at all: it would
  // open the whole province.
  function inventoryLink(node: CoverageNode): string | null {
    if (node.level === "city" && node.value) return geoQuery({ country: node.place.country, region: node.place.region, city: node.place.city });
    if (node.level === "postal" && node.value) return geoQuery({ country: node.place.country, region: node.place.region, city: node.place.city, postal: node.place.postal });
    return null;
  }

  const tableRows: ReactNode[] = [];
  const depthOf: Record<CoverageNode["level"], number> = { country: 0, region: 1, city: 2, postal: 3 };
  function walk(nodes: CoverageNode[]) {
    for (const node of nodes) {
      const expandable = node.children.length > 0 && node.level !== "postal";
      const opened = expandable && isOpen(node);
      const link = inventoryLink(node);
      const label = nodeLabel(node);
      tableRows.push(
        <tr key={node.key} className={`sw-cov-row sw-cov-${node.level}${node.value ? "" : " sw-cov-missing"}`}>
          <th scope="row" style={{ paddingLeft: `${8 + depthOf[node.level] * 18}px` }}>
            {expandable ? (
              <button type="button" className="sw-cov-toggle" aria-expanded={opened} onClick={() => toggle(node)} disabled={filtering}>
                {opened ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
                <span>{label}</span>
                <span className="sr-only">, {node.children.length} {node.children.length === 1 ? "place" : "places"} inside</span>
              </button>
            ) : (
              <span className="sw-cov-leaf">{label}</span>
            )}
          </th>
          <td>{node.totals.live.toLocaleString()}</td>
          <td>{node.totals.drafts.toLocaleString()}</td>
          <td>{node.totals.deals.toLocaleString()}</td>
          <td>{node.totals.restaurants.toLocaleString()}</td>
          <td className={stalePercent(node.totals) >= 25 ? "sw-cov-warn" : undefined}>{stalePercent(node.totals)}%</td>
          <td>
            {link && (
              <button type="button" className="sw-link sw-cov-open" onClick={() => openTab("deals", link)}>
                Deals <ArrowRight aria-hidden="true" size={13} /><span className="sr-only"> in {label}</span>
              </button>
            )}
          </td>
        </tr>,
      );
      if (opened) walk(node.children);
    }
  }
  walk(tree.roots);

  return (
    <div className="sw-coverage">
      <section className="portal-card" aria-label="Deals by place">
        <PanelHeader
          title="Deals by place"
          actions={!filtering && tree.roots.length > 0 ? (
            <>
              <button type="button" className="sw-link" onClick={() => {
                const keys: string[] = [];
                const collect = (nodes: CoverageNode[]) => { for (const node of nodes) if (node.level !== "postal" && node.level !== "city") { keys.push(node.key); collect(node.children); } };
                collect(tree.roots);
                setExpanded(keys);
              }}>Expand to cities</button>
              {expanded.length > 0 && <button type="button" className="sw-link" onClick={() => setExpanded([])}>Collapse all</button>}
            </>
          ) : undefined}
        >
          Live, draft, scheduled and paused deals by country, province or state, city and postal area (the first three
          characters of a postal code or ZIP). Open a level to see what is inside it; &ldquo;Deals&rdquo; opens the
          inventory filtered to that city or area. Brand-wide and national offers have no single place, so they are not counted here.
        </PanelHeader>
        <GeoFilter places={places} value={geo} onChange={setGeo} label="Show coverage in" />
        {!rows.length ? (
          <StatePanel kind="empty" title="No deals with a place yet">
            Once a live or draft deal is attached to a restaurant branch with an address, it appears here under its country, province or state, city and postal area.
          </StatePanel>
        ) : !filtered.length ? (
          <StatePanel kind="empty" title="No deals in this place" action={<button type="button" className="sw-link" onClick={() => setGeo({ country: "", region: "", city: "", postal: "" })}>Clear place</button>}>
            Nothing live, draft, scheduled or paused matches the place chosen above. Try a wider area.
          </StatePanel>
        ) : (
          <>
            <div className="sw-cov-scroll">
              <table className="sw-cov-table">
                <caption className="sr-only">Deals by country, province or state, city and postal area, with totals at each level</caption>
                <thead>
                  <tr>
                    <th scope="col">Place</th>
                    <th scope="col">Live</th>
                    <th scope="col">Drafts</th>
                    <th scope="col" title="Live, draft, scheduled and paused">All open</th>
                    <th scope="col">Restaurants</th>
                    <th scope="col" title="Share of these deals whose last check is more than 30 days old">Check overdue</th>
                    <th scope="col"><span className="sr-only">Open in Deal inventory</span></th>
                  </tr>
                </thead>
                <tbody>{tableRows}</tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{filtering ? "In this place" : "Everywhere"}</th>
                    <td>{tree.totals.live.toLocaleString()}</td>
                    <td>{tree.totals.drafts.toLocaleString()}</td>
                    <td>{tree.totals.deals.toLocaleString()}</td>
                    <td>{tree.totals.restaurants.toLocaleString()}</td>
                    <td>{stalePercent(tree.totals)}%</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <small className="review-note">
              Restaurants are counted once per postal area, so the totals above that add up the areas count a chain with
              branches in two areas twice.{rows.length >= 2000 ? " Only the first 2,000 places are shown." : ""}
            </small>
          </>
        )}
      </section>

      <section className="portal-card" aria-label="Launch markets">
        <PanelHeader
          title="Launch markets"
          actions={<button type="button" className="sw-link" aria-expanded={marketsOpen} onClick={() => setMarketsOpen(!marketsOpen)}>{marketsOpen ? "Hide" : "Show"}</button>}
        >
          The markets Radar is launching or has launched, each with a target number of live offers. Empty searches are
          searches there in the last 90 days that found nothing: a sign the catalog is missing what people look for.
        </PanelHeader>
        {marketsOpen && (!data.coverage?.length ? (
          <StatePanel kind="empty" title="No launch markets set up">Launch markets are added by the team that plans market launches.</StatePanel>
        ) : !markets.length ? (
          <StatePanel kind="empty" title="No launch market in this place">Clear or widen the place filter above to see the others.</StatePanel>
        ) : (
          <div className="sw-cov-scroll">
            <table className="sw-cov-table sw-cov-markets">
              <caption className="sr-only">Launch markets with their status, live offers against the target, staleness and empty searches</caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col">Status</th>
                  <th scope="col">Live offers</th>
                  <th scope="col">Restaurants</th>
                  <th scope="col">Check overdue</th>
                  <th scope="col">Empty searches</th>
                </tr>
              </thead>
              <tbody>
                {marketPage.rows.map((market) => {
                  const minimum = Number(market.minimum_offers) || 0;
                  const short = minimum > 0 && market.active_deals < minimum;
                  return (
                    <tr key={market.id}>
                      <th scope="row">
                        {cities.has(market.market) ? (
                          <button type="button" className="sw-link" onClick={() => openTab("deals", geoQuery({ country: market.country, region: market.region, city: market.market }))}>
                            {market.market}<span className="sr-only">: open its deals</span>
                          </button>
                        ) : market.market}
                        {(market.region || market.country) && <small>{[market.region, market.country && countryName(market.country)].filter(Boolean).join(", ")}</small>}
                      </th>
                      <td><span className={`status${MARKET_ESTABLISHED.has(market.status) ? " on" : ""}`}>{MARKET_STATUS[market.status] || market.status}</span></td>
                      <td className={short ? "sw-cov-warn" : undefined}>
                        {market.active_deals.toLocaleString()}{minimum > 0 && <> of {minimum.toLocaleString()}</>}
                        {short && <small>{(minimum - market.active_deals).toLocaleString()} short of the target</small>}
                      </td>
                      <td>{market.unique_restaurants.toLocaleString()}</td>
                      <td className={(market.stale_percent || 0) >= 25 ? "sw-cov-warn" : undefined}>{market.stale_percent || 0}%</td>
                      <td>{(market.zero_result_searches || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager paged={marketPage} noun="market" onPage={setMarketPage} />
          </div>
        ))}
      </section>
    </div>
  );
}

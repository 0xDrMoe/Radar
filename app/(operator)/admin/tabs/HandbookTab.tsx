"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { ListCount, ListToolbar } from "../../ListScope";
// Types only. The articles themselves come from GET /api/admin/handbook, which serves each reader
// the ones their permissions allow; importing the handbook module here would put every article,
// restricted or not, into the bundle every member of staff downloads.
import type { HandbookArticleView, HandbookPayload, HandbookSectionView } from "../handbook";
import { adminNavGroups, areaLabel, type AdminArea } from "../sections";
import { StatePanel } from "../ui";
import { useTabState } from "../workspace";

// Everything the reader can see, joined, so a search matches on a phrase from a step or a gotcha
// and not only on a title — somebody looking for "waitlisted" or "confirmation phrase" is quoting
// the sentence that confused them, not the heading it sits under.
const searchText = (article: HandbookArticleView) =>
  [article.title, article.summary, ...article.body, ...article.steps, ...article.gotchas].join(" ").toLowerCase();

// Which deep link the page was opened on: "/admin/help#drink-rules" names a section,
// "/admin/help#pay-an-affiliate" an article.
const currentHash = () => (typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1)));

type HandbookResult = { payload?: HandbookPayload; error: string };

/** One request for the reader's handbook. Never throws: a failure comes back as its message. */
async function fetchHandbook(): Promise<HandbookResult> {
  try {
    const response = await fetch("/api/admin/handbook", { headers: { accept: "application/json" } });
    const body = (await response.json().catch(() => null)) as (HandbookPayload & { error?: { message?: string } }) | null;
    if (!response.ok || !body?.sections) return { error: body?.error?.message || "The handbook could not be loaded." };
    return { payload: { sections: body.sections, withheld: body.withheld || 0 }, error: "" };
  } catch {
    return { error: "The handbook could not be loaded." };
  }
}

export default function HandbookTab() {
  // Kept for the life of the workspace, so coming back to the handbook shows it at once while a
  // fresh copy loads behind it — permissions can change mid-session, so it is always re-fetched.
  const [payload, setPayload] = useTabState<HandbookPayload | null>("help.payload", null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [handbookQuery, setHandbookQuery] = useTabState("help.query", "");
  const [areaFilter, setAreaFilter] = useTabState<AdminArea | "">("help.area", "");
  const [hash, setHash] = useState(currentHash);
  // The deep link already acted on, so typing a search afterwards does not keep scrolling the page
  // back to it.
  const landed = useRef("");

  const applyResult = useCallback((result: HandbookResult) => {
    if (result.payload) setPayload(result.payload);
    setLoadError(result.error);
  }, [setPayload]);

  // The retry button's path; the first load is the effect below.
  const loadHandbook = useCallback(async () => {
    setLoading(true);
    applyResult(await fetchHandbook());
    setLoading(false);
  }, [applyResult]);

  useEffect(() => {
    let live = true;
    void fetchHandbook().then((result) => {
      if (live) applyResult(result);
    });
    return () => {
      live = false;
    };
  }, [applyResult]);

  useEffect(() => {
    const sync = () => setHash(currentHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const needle = handbookQuery.trim().toLowerCase();
  const filtering = Boolean(needle || areaFilter);

  // The handbook's own grouping (by role, the reader's own section first, as the server ordered
  // it), narrowed by the search and the area filter. Searching opens every article it matched,
  // because a reader who typed a phrase is looking for that phrase — making them expand each
  // result to find it would be a second search.
  const groups = useMemo<HandbookSectionView[]>(() => {
    if (!payload) return [];
    return payload.sections
      .map((section) => ({
        ...section,
        articles: section.articles.filter(
          (article) => (!areaFilter || article.area === areaFilter) && (!needle || searchText(article).includes(needle)),
        ),
      }))
      .filter((section) => section.articles.length > 0);
  }, [payload, needle, areaFilter]);
  const matchCount = groups.reduce((total, section) => total + section.articles.length, 0);

  // Only the parts of the workspace this reader has articles about are offered as a filter.
  const areas = useMemo(() => {
    const present = new Set(payload?.sections.flatMap((section) => section.articles.map((article) => article.area)) || []);
    return adminNavGroups.filter((group) => present.has(group.id));
  }, [payload]);

  // A deep link lands on its target once the content is there to land on. A section is scrolled
  // to; an article is opened as well, because a link to a closed summary line is a link to half
  // of what was meant. Whatever filter was left over from the last visit is cleared first if it
  // would hide the target.
  useEffect(() => {
    if (!hash || !payload || landed.current === hash) return;
    const known = payload.sections.some((section) => section.id === hash || section.articles.some((article) => article.id === hash));
    if (!known) return;
    if (filtering && !groups.some((section) => section.id === hash || section.articles.some((article) => article.id === hash))) {
      setHandbookQuery("");
      setAreaFilter("");
      return;
    }
    const target = document.getElementById(hash);
    if (!target) return;
    landed.current = hash;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ block: "start" });
  }, [hash, payload, groups, filtering, setHandbookQuery, setAreaFilter]);

  if (!payload) {
    return loadError ? (
      <StatePanel
        kind="error"
        title="The handbook could not be loaded"
        action={<button type="button" onClick={() => void loadHandbook()} disabled={loading}>Try again</button>}
      >
        {loadError} Check your connection and try again.
      </StatePanel>
    ) : (
      <StatePanel kind="loading" title="Loading the handbook">Fetching the articles for your role.</StatePanel>
    );
  }

  if (payload.sections.length === 0) {
    return (
      <StatePanel kind="empty" title="No articles for your role yet">
        Your role has no handbook articles. Ask an owner or admin which parts of the workspace are yours.
      </StatePanel>
    );
  }

  return (
    <>
      <section className="portal-card handbook-intro sw-handbook-intro">
        <div className="portal-card-head">
          <div>
            <span className="kicker">STAFF HANDBOOK</span>
            <h2>How the job works, and what to do when it does not</h2>
          </div>
        </div>
        <p>
          Written for the moment something is refusing, delayed, or not where you expected it. Your own
          section comes first, then the parts every member of staff reads.
        </p>
        <ListToolbar
          query={handbookQuery}
          onQuery={setHandbookQuery}
          placeholder="Search the handbook — a phrase from the message works"
          label="Search the handbook"
        >
          {areas.length > 1 && (
            <label className="city-select">
              <LayoutGrid aria-hidden="true" />
              <select
                value={areaFilter}
                onChange={(event) => setAreaFilter(event.target.value as AdminArea | "")}
                aria-label="Show articles about one part of the workspace"
              >
                <option value="">Every part of the workspace</option>
                {areas.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
              </select>
            </label>
          )}
        </ListToolbar>
        {filtering && matchCount > 0 && (
          <ListCount>
            {matchCount} article{matchCount === 1 ? "" : "s"} match
            {areaFilter ? ` in ${areaLabel(areaFilter)}` : ""}
          </ListCount>
        )}
        {loadError && (
          <StatePanel
            kind="error"
            title="Showing the copy loaded earlier"
            action={<button type="button" onClick={() => void loadHandbook()} disabled={loading}>Try again</button>}
          >
            {loadError}
          </StatePanel>
        )}

        {groups.length > 0 && (
          <nav className="sw-handbook-toc" aria-label="Handbook contents">
            <span className="kicker">CONTENTS</span>
            <ol>
              {groups.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} aria-current={hash === section.id ? "location" : undefined}>
                    <span>{section.title}</span>
                    <small>
                      {section.mine ? "Your role · " : section.everyone ? "Everyone · " : ""}
                      {section.articles.length} article{section.articles.length === 1 ? "" : "s"}
                    </small>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {payload.withheld > 0 && !filtering && (
          <p className="sw-handbook-note">
            Articles about work your role does not include are not shown. If you are covering for somebody,
            ask an owner or admin for the permission the work needs; its articles appear here with it.
          </p>
        )}
      </section>

      {groups.length === 0 && (
        <StatePanel
          kind="empty"
          title="Nothing in your handbook matches"
          action={<button type="button" onClick={() => { setHandbookQuery(""); setAreaFilter(""); }}>Clear search</button>}
        >
          Try a word from the message you are looking at, or every part of the workspace. Articles for work your
          role does not include are not searched.
        </StatePanel>
      )}

      {groups.map((section) => (
        <section className="portal-card handbook-section sw-handbook-section" key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <div className="portal-card-head">
            <div>
              <span className="kicker">{section.mine ? "YOUR ROLE" : section.everyone ? "EVERYONE" : "ALSO YOURS"}</span>
              <h2 id={`${section.id}-title`}>{section.title}</h2>
            </div>
            <span className="creator-rate">{section.articles.length} article{section.articles.length === 1 ? "" : "s"}</span>
          </div>
          <p className="handbook-blurb">{section.blurb}</p>
          {section.articles.map((article) => (
            <details key={article.id} id={article.id} className="handbook-article" open={Boolean(needle) || hash === article.id}>
              <summary>
                {/* Two chips in one cell: what kind of article this is, and which part of
                    the workspace it is about — in the sidebar's own words. The sections are
                    roles, so without the second a reader knows who an article is for but not
                    where to go and do it. */}
                <span className="handbook-chips">
                  <span className={`handbook-kind handbook-kind-${article.kind}`}>{article.kindLabel}</span>
                  {article.area && <span className="handbook-area">{areaLabel(article.area)}</span>}
                </span>
                <b>{article.title}</b>
                <small>{article.summary}</small>
              </summary>
              <div className="handbook-body">
                {article.body.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
                {article.steps.length > 0 && (
                  <ol>
                    {article.steps.map((step) => <li key={step.slice(0, 40)}>{step}</li>)}
                  </ol>
                )}
                {article.gotchas.length > 0 && (
                  <ul className="handbook-gotchas">
                    {article.gotchas.map((gotcha) => <li key={gotcha.slice(0, 40)}>{gotcha}</li>)}
                  </ul>
                )}
                <a className="sw-handbook-anchor" href={`#${article.id}`}>Link to this article</a>
              </div>
            </details>
          ))}
        </section>
      ))}
    </>
  );
}

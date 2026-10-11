"use client";

import type { MouseEvent } from "react";
import { BookOpen, Pencil, Wine } from "lucide-react";
import type { DrinkRuleAlert } from "../../drink-rules";
import { usePagedRows, useWorkspace } from "./workspace";
import { Pager } from "../ListScope";

/** The Staff Handbook's Drink Rules section. Staff have no repository access, so never a docs/ file. */
export const DRINK_RULES_HANDBOOK = "/admin/help#drink-rules";

/**
 * Live drink deals that break, or should be checked against, the advertising rules where they run
 * (app/drink-rules.ts). Publishing now refuses the clear cases, so this is mostly what went live
 * before a rule existed. A deal leaves the list once its copy is fixed or it is retired.
 *
 * Each issue says what to do with it, and the panel links the handbook's plain-language version of
 * the rules, because "below_minimum in ON" is not something a deal editor can act on unaided.
 */
export default function DrinkRuleAlerts({ alerts, onOpen }: { alerts: DrinkRuleAlert[]; onOpen: (alert: DrinkRuleAlert) => void }) {
  const { openTab } = useWorkspace();
  const [paged, setPage] = usePagedRows("drinkRuleAlerts", alerts);
  if (!alerts.length) return null;
  // Opened inside the workspace like any other section; a modified click still gets the real link.
  function openHandbook(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openTab("help", "#drink-rules");
    window.setTimeout(() => document.getElementById("drink-rules")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }
  const blocking = alerts.filter((alert) => alert.issues.some((issue) => issue.severity === "block")).length;
  return (
    <section className="portal-card quality-actions drink-rule-alerts" aria-labelledby="drink-rule-alerts-title">
      <div className="portal-card-head">
        <div>
          <span className="kicker">DRINK RULES</span>
          <h2 id="drink-rule-alerts-title">Live drink deals to fix</h2>
          <p>
            Provinces and states set rules on how drink prices may be advertised, such as a minimum price per
            drink or no &ldquo;happy hour&rdquo; wording at all. <b>Must change</b>: the deal breaks a rule where
            it runs, so fix the wording, or pause the deal if the offer itself isn&rsquo;t allowed.{" "}
            <b>Check</b>: it may break one; read it against the rule and fix it if it does. A deal leaves this
            list once it is fixed or retired.
          </p>
          <a className="sw-link" href={DRINK_RULES_HANDBOOK} onClick={openHandbook}>
            <BookOpen aria-hidden="true" size={14} /> Read the Drink Rules in the Staff Handbook
          </a>
        </div>
        <span className="status"><Wine aria-hidden="true" /> {blocking ? `${blocking} must change` : `${alerts.length} to check`}</span>
      </div>
      <div className="quality-list review-list">
        {paged.rows.map((alert) => {
          const label = `${alert.restaurant}, ${alert.title}`;
          return (
            <article key={alert.id}>
              <span aria-hidden="true">{alert.emoji}</span>
              <div>
                <b>{alert.restaurant}</b>
                <small>{alert.title} · {alert.city}</small>
                <ul className="drink-rule-issues">
                  {alert.issues.map((issue) => (
                    <li key={`${issue.code}-${issue.jurisdiction}`} className={issue.severity}>
                      <b>{issue.severity === "block" ? "Must change" : "Check"}</b> {issue.message}
                    </li>
                  ))}
                </ul>
                <div className="review-actions">
                  <button type="button" onClick={() => onOpen(alert)}>
                    <Pencil /> Open<span className="sr-only"> {label}</span>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Pager paged={paged} noun="deal" onPage={setPage} />
    </section>
  );
}

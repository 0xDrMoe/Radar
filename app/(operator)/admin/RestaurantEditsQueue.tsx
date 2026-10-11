"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { StaffTime } from "./ui";
import { usePagedRows } from "./workspace";
import { Pager } from "../ListScope";
import { DEAL_CHANGE_LABELS, changedDealFields, dealContentOf, parsePreviousContent } from "../../deal-change-requests";

export interface AdminDealChangeRequest {
  id: string;
  deal_id: string;
  restaurant_id: string;
  title: string;
  price: string;
  schedule: string;
  description: string | null;
  terms: string | null;
  previous: string;
  created_at: string;
  current_title: string;
  current_price: string;
  current_schedule: string;
  current_description: string | null;
  current_terms: string | null;
  deal_status: string;
  city: string;
  restaurant_name: string | null;
  requester_email: string | null;
  requester_name: string | null;
}

type Decide = (id: string, decision: "approved" | "rejected", notes?: string) => Promise<boolean>;

/**
 * Restaurant managers' deal edits waiting for staff (drizzle/0065). Each shows only the fields that
 * would change, as the live listing has them beside what the restaurant asked for, so a reviewer
 * checks the difference rather than rereading the whole deal.
 */
export default function RestaurantEditsQueue({ requests, busy, onDecide }: { requests: AdminDealChangeRequest[]; busy: string; onDecide: Decide }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [paged, setPage] = usePagedRows("restaurantEdits", requests);

  if (!requests.length) return null;
  return (
    <section className="portal-card restaurant-edits" aria-labelledby="restaurant-edits-title">
      <div className="portal-card-head">
        <div>
          <span className="kicker">RESTAURANT EDITS</span>
          <h2 id="restaurant-edits-title">Waiting for review</h2>
          <p>Managers&apos; changes stay off the public listing until approved here.</p>
        </div>
        <span className="status">{requests.length} waiting</span>
      </div>
      <div className="inventory-table">
        {paged.rows.map((request) => {
          const current = dealContentOf({ title: request.current_title, price: request.current_price, schedule: request.current_schedule, description: request.current_description, terms: request.current_terms });
          const proposed = dealContentOf(request);
          const fields = changedDealFields(current, proposed);
          // Staff edited the deal after the manager opened the form: approving would overwrite that.
          const movedOn = changedDealFields(parsePreviousContent(request.previous), current).length > 0;
          const who = request.requester_name || request.requester_email || "A restaurant manager";
          const busyKey = `review_deal_change-${request.id}`;
          return (
            <article key={request.id} className="restaurant-edit">
              <div>
                <b>{request.restaurant_name || "Restaurant"} · {request.current_title}</b>
                <small>{who} · {request.city} · deal is {request.deal_status} · sent <StaffTime value={request.created_at} /></small>
                {movedOn && <small className="warning-text">This deal was edited after the change was made. Approving replaces those edits.</small>}
                {fields.length ? (
                  <dl className="edit-diff">
                    {fields.map((field) => (
                      <div key={field}>
                        <dt>{DEAL_CHANGE_LABELS[field]}</dt>
                        <dd><span className="sr-only">Now: </span><del>{current[field] || "(empty)"}</del></dd>
                        <dd><span className="sr-only">Proposed: </span><ins>{proposed[field] || "(empty)"}</ins></dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <small>The listing already says this. Approving changes nothing.</small>
                )}
                {rejecting === request.id && (
                  <label className="typed-confirmation wide">
                    Why not? The restaurant sees this.
                    <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
                  </label>
                )}
              </div>
              <div className="row-actions">
                {rejecting === request.id ? (
                  <>
                    <button onClick={() => { setRejecting(null); setNote(""); }}>Cancel</button>
                    <button
                      className="destructive"
                      disabled={!note.trim() || busy === busyKey}
                      onClick={async () => { if (await onDecide(request.id, "rejected", note.trim())) { setRejecting(null); setNote(""); } }}
                    >
                      <X /> Send rejection
                    </button>
                  </>
                ) : (
                  <>
                    <button disabled={busy === busyKey} onClick={() => onDecide(request.id, "approved")}><Check /> Approve<span className="sr-only"> change to {request.current_title}</span></button>
                    <button disabled={busy === busyKey} onClick={() => { setRejecting(request.id); setNote(""); }}><X /> Reject<span className="sr-only"> change to {request.current_title}</span></button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <Pager paged={paged} noun="change" onPage={setPage} />
    </section>
  );
}

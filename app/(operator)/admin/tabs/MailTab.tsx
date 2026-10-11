"use client";
import { ShieldCheck } from "lucide-react";
import { ListCount, ListToolbar, listCountLabel, Pager, pageRows, selectRows } from "../../ListScope";
import { StaffTime, StatePanel } from "../ui";
import { useListScope, useWorkspace } from "../workspace";

// Two lists for whoever runs the email pilot (manage_email):
//
//   Launch signals   people asking to be let in: the pilot waitlist, accepted here one at a time,
//                    and the count of addresses left on the homepage for launch news.
//   Subscribers      people already receiving deal alerts, paused or resumed here.
//
// Which delivery settings are missing is the developer's business (Developer tab); this screen is
// told only whether an invitation can go out right now (integrations.deliveryReady). Subscriber
// exports are developer-only and server-side (GET /api/admin/export), so there is none here.

export default function MailTab() {
  const { data, busy, action, navCounts, canManageEmail, permissions, openTab } = useWorkspace();
  const { listQueryFor, setListQueryFor, pageFor, setPageFor } = useListScope();
  const allUsers = data?.users || [];
  const mailingList = selectRows(allUsers, (row) => `${row.name || ""} ${row.email} ${row.home_postal || ""}`,
    { query: listQueryFor("mail"), showAll: true });
  const mailPage = pageRows(mailingList.matched, pageFor("mail", listQueryFor("mail")));
  // Already ordered oldest-first by the server, so index === place in line.
  const waitlist = data?.waitlist || [];
  const waitPage = pageRows(waitlist, pageFor("waitlist"));
  // Accepting sends an invitation, so it is only possible while email delivery is actually
  // switched on. Surfacing that here beats letting staff click Accept and get a failure back.
  const deliveryReady = data?.integrations?.deliveryReady !== false;
  const canAcceptWaitlist = canManageEmail && deliveryReady;
  const acceptBlockedReason = !canManageEmail
    ? "Your role does not include managing the mailing list."
    : !deliveryReady
      ? "Email delivery is switched off, so an invitation cannot be sent yet."
      : "Admit this person to the pilot and email them a confirmation link.";
  // Launch interest left on the homepage (email_leads) is counted in Growth → Launch signals, by
  // source and over time; this tab is the signed-in accounts' list and the pilot waitlist.
  const canSeeLaunchSignals = permissions.has("view_analytics");
  return (
    <>
      <section className="portal-card waitlist-card">
        <div className="portal-card-head mailing-head">
          <div>
            <span className="kicker">LAUNCH SIGNALS</span>
            <h2>Pilot waitlist</h2>
            <p>People who asked for deal-alert emails before the pilot had room for them. Accepting one emails them a link to confirm.</p>
            <p>
              {waitlist.length
                ? `${waitlist.length} waiting · accept in the order they joined`
                : "Nobody is waiting right now."}
            </p>
            {canSeeLaunchSignals && (
              <p>
                Addresses left on the homepage for launch news are counted in{" "}
                <button type="button" className="sw-link" onClick={() => openTab("growth")}>Growth → Launch signals</button>.
              </p>
            )}
          </div>
          {waitlist.length > 0 && (
            <button
              className="primary"
              disabled={!canAcceptWaitlist || busy === "accept_waitlist-next"}
              title={acceptBlockedReason}
              onClick={() => action({ action: "accept_waitlist" }, "accept_waitlist-next")}
            >
              {busy === "accept_waitlist-next" ? "Accepting…" : "Accept next in line"}
            </button>
          )}
        </div>
        {waitlist.length > 0 && !deliveryReady && (
          <div className="launch-note waitlist-blocked" role="status">
            <ShieldCheck />
            <div>
              <b>Accepting is paused while email delivery is off</b>
              <p>People can still join and keep their place in line. Invitations can&apos;t be sent right now; a developer has been shown why in the Developer section.</p>
            </div>
          </div>
        )}
        {waitlist.length > 0 && (
          <ol className="waitlist-queue" start={waitPage.first}>
            {waitPage.rows.map((entry, row) => { const index = waitPage.first - 1 + row; return (
              <li key={entry.id} className={index === 0 ? "next-in-line" : ""}>
                <span className="queue-position" aria-hidden="true">{index + 1}</span>
                <div className="subscriber-name">
                  <b>{entry.name || entry.email.split("@")[0]}</b>
                  <a href={`mailto:${entry.email}`}>{entry.email}</a>
                </div>
                <div>
                  <b><StaffTime value={entry.created_at} format="date" /></b>
                  <small>{index === 0 ? "Next in line" : <>Joined <StaffTime value={entry.created_at} format="time" /></>}</small>
                </div>
                <button
                  className={index === 0 ? "primary" : "mail-action"}
                  disabled={!canAcceptWaitlist || busy === `accept_waitlist-${entry.id}`}
                  title={acceptBlockedReason}
                  onClick={() => action({ action: "accept_waitlist", id: entry.id }, `accept_waitlist-${entry.id}`)}
                >
                  {busy === `accept_waitlist-${entry.id}` ? "Accepting…" : "Accept"}
                </button>
              </li>
            ); })}
          </ol>
        )}
        {waitlist.length > 0 && (
          <Pager paged={waitPage} noun="person" plural="people" onPage={setPageFor("waitlist")} />
        )}
        {!waitlist.length && (
          <StatePanel kind="empty" title="No one is waiting">
            People who ask to join the deal-alert pilot appear here in the order they joined.
          </StatePanel>
        )}
      </section>
      <section className="portal-card">
        <div className="portal-card-head mailing-head">
          <div>
            <span className="kicker">CONSENTED AUDIENCE</span>
            <h2>Controlled-pilot subscribers</h2>
            <p>
              {navCounts.subscribed}{" "}
              active of {data.users.length} registered users
            </p>
          </div>
        </div>
        <ListToolbar query={listQueryFor("mail")} onQuery={setListQueryFor("mail")} placeholder="Search by name, email, or area" label="Search subscribers" />
        <ListCount>{listCountLabel(mailingList, allUsers.length, "subscriber", true)}</ListCount>
        <div className="mailing-list">
          {mailPage.rows.map((u) => (
            <article
              key={u.id}
              className={!u.alerts_enabled ? "inactive" : ""}
            >
              <div className="subscriber-avatar">
                {(u.name || u.email)[0].toUpperCase()}
              </div>
              <div className="subscriber-name">
                <b>{u.name || u.email.split("@")[0]}</b>
                <a href={`mailto:${u.email}`}>{u.email}</a>
              </div>
              <div>
                <b>{u.home_postal || "Area not set"}</b>
                <small>Local market</small>
              </div>
              <div>
                <b>{u.alert_time || "08:00"}</b>
                <small>
                  {u.alert_days
                    ? `${u.alert_days.split(",").length} delivery days`
                    : "No days selected"}
                </small>
              </div>
              <span className={`status ${u.alerts_enabled ? "on" : ""}`}>
                {u.alerts_enabled ? "Subscribed" : "Paused"}
              </span>
              <button
                className="mail-action"
                disabled={!canManageEmail || busy === `subscriber-${u.id}`}
                onClick={() =>
                  action({
                    action: "subscriber",
                    id: u.id,
                    enabled: !u.alerts_enabled,
                  })
                }
              >
                {busy === `subscriber-${u.id}`
                  ? "Saving…"
                  : u.alerts_enabled
                    ? "Pause"
                    : "Resume"}
              </button>
            </article>
          ))}
          {!allUsers.length ? (
            <StatePanel kind="empty" title="No registered users yet">
              Everyone who creates an account appears here with their alert settings, subscribed or paused.
            </StatePanel>
          ) : !mailingList.visible.length ? (
            <StatePanel kind="empty" title="No subscriber matches that search" action={<button type="button" className="sw-link" onClick={() => setListQueryFor("mail")("")}>Clear search</button>}>
              Search by name, email address or postal area.
            </StatePanel>
          ) : null}
        </div>
        <Pager paged={mailPage} noun="subscriber" onPage={setPageFor("mail", listQueryFor("mail"))} />
        <div className="launch-note">
          <ShieldCheck />
          <div>
            <b>Delivery safeguard</b>
            <p>
              Only people who confirmed their address and are not suppressed can be resumed; the server refuses anyone else. Pausing always works.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

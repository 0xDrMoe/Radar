"use client";
import { useEffect, useMemo } from "react";
import { Mail, Search } from "lucide-react";
import { formatRole, PERMISSION_DESCRIPTIONS, type Permission, type Role, ROLE_DESCRIPTIONS } from "../../../permissions";
import { sqlDate } from "../format";
import type { AdminStaffMember } from "../types";
import { PanelHeader, StatePanel } from "../ui";
import { useTabState, useWorkspace } from "../workspace";
import { Pager, pageRows } from "../../ListScope";

// The staff directory: everyone who can open this workspace, grouped by role, so anyone on the
// team can see who does what and who to ask. Every member of staff can read it. Names and roles
// only; email addresses arrive (from GET /api/admin) only for people who manage accounts.
//
// The sidebar's workspace search links here with ?q=<name>, which pre-fills the search box.

// The order the groups appear in: the people who can decide things first.
const ROLE_ORDER = ["owner", "admin", "supervisor", "finance_manager", "developer", "deal_editor", "moderator", "marketing", "analyst", "custom"];
const rank = (role: string) => {
  const at = ROLE_ORDER.indexOf(role);
  return at === -1 ? ROLE_ORDER.length : at;
};

export default function DirectoryTab() {
  const { data, isAdminPlus, currentUser } = useWorkspace();
  const [query, setQuery] = useTabState("directory.query", "");
  // A link from the workspace search (/admin/directory?q=Dana) wins over a remembered search.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q.slice(0, 80));
  }, [setQuery]);

  const members = useMemo(() => data?.staffDirectory || [], [data?.staffDirectory]);
  // Owners and admins also receive the role grid, so they can see exactly which permissions each
  // role holds. Everyone else gets the role's description, which is what it is for anyway.
  const grantsByRole = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const rp of data?.rolePermissions || []) {
      if (rp.permission === "read_admin") continue;
      if (!map.has(rp.role)) map.set(rp.role, []);
      map.get(rp.role)!.push(rp.permission as Permission);
    }
    return map;
  }, [data?.rolePermissions]);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matched = members.filter((m) =>
      !needle || [m.name, m.email, m.role, formatRole(m.role)].some((field) => field && field.toLowerCase().includes(needle)),
    );
    const byRole = new Map<string, AdminStaffMember[]>();
    for (const member of matched) {
      if (!byRole.has(member.role)) byRole.set(member.role, []);
      byRole.get(member.role)!.push(member);
    }
    return [...byRole.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [members, needle]);
  const shown = groups.reduce((sum, [, list]) => sum + list.length, 0);
  // The page each role's list is on, kept with the search it was turned under: a new search starts
  // every list again from page 1.
  const [pages, setPages] = useTabState<Record<string, { page: number; reset: string }>>("directory.pages", {});

  return (
    <section className="portal-card sw-directory">
      <PanelHeader title="Who's on the team">
        Everyone who can open the staff workspace, grouped by role, with what each role is for. Use it to find who to ask about a deal, a payout or an account.
      </PanelHeader>
      <div className="inventory-tools list-tools">
        <label className="portal-search">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, role or email" aria-label="Search the staff directory" />
        </label>
        {query && <button type="button" className="sw-link" onClick={() => setQuery("")}>Clear search</button>}
      </div>
      {!members.length ? (
        <StatePanel kind="empty" title="Nobody is listed yet">
          The directory lists active staff accounts. If you expected to see colleagues here, an owner can give them a staff role from the Users section.
        </StatePanel>
      ) : !shown ? (
        <StatePanel kind="empty" title="Nobody matches that search">
          Try part of a first name or a role, like &ldquo;moderator&rdquo;. <button type="button" className="sw-link" onClick={() => setQuery("")}>Show everyone</button>
        </StatePanel>
      ) : (
        <>
          <p className="list-count-line">{needle ? `${shown} of ${members.length} people` : `${members.length} ${members.length === 1 ? "person" : "people"} on the team`}</p>
          {groups.map(([role, list]) => {
            const grants = grantsByRole.get(role);
            const paged = pageRows(list, pages[role]?.reset === needle ? pages[role].page : 1);
            return (
              <section key={role} className="sw-dir-group" aria-labelledby={`dir-${role}`}>
                <header>
                  <h3 id={`dir-${role}`}>{formatRole(role)} <small>{list.length}</small></h3>
                  <p>{ROLE_DESCRIPTIONS[role as Role] || "A role this workspace does not describe yet."}</p>
                  {isAdminPlus && grants && grants.length > 0 && (
                    <details className="sw-dir-can">
                      <summary>What this role can do</summary>
                      <ul>
                        {grants.map((p) => <li key={p}><b>{formatRole(p)}</b> {PERMISSION_DESCRIPTIONS[p] || ""}</li>)}
                      </ul>
                    </details>
                  )}
                </header>
                <ul className="sw-dir-people">
                  {paged.rows.map((member) => (
                    <li key={member.id}>
                      <i className="sw-avatar" aria-hidden="true">{(member.name || member.email || "?").charAt(0).toUpperCase()}</i>
                      <span>
                        <b>{member.name || member.email || "Unnamed account"}{member.id === currentUser?.id ? " (you)" : ""}</b>
                        <small>
                          {member.email ? <a href={`mailto:${member.email}`}><Mail aria-hidden="true" /> {member.email}</a> : null}
                          {member.email ? " · " : ""}Account since {sqlDate(member.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager paged={paged} noun="person" plural="people" onPage={(page) => setPages((current) => ({ ...current, [role]: { page, reset: needle } }))} />
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

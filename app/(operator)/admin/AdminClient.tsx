"use client";
import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Archive,
  Banknote,
  BookOpen,
  Building2,
  CalendarX,
  ClipboardCheck,
  Clock3,
  Code2,
  Contact,
  Flag,
  Globe2,
  HeartHandshake,
  KeyRound,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { DialogFocus } from "../DialogFocus";
import { formatRole, ROLE_DESCRIPTIONS } from "../../permissions";
import CardMedia from "../../CardMedia";
import BrandLogo from "../../BrandLogo";
import RadarMark from "../../RadarMark";
import RadarScan from "../../RadarScan";
import CommandPalette, { type Command } from "../../CommandPalette";
import { adminNavGroups, adminTabs, canOpenTab, groupNavLinks, tabBlurbFor, tabPath, tabTitleFor, type AdminTab } from "./sections";
import type { ActionErrorBody, AdminActionPayload, AdminData, AdminDeal, ConfirmDialogState } from "./types";
import { AdminWorkspaceContext, type AdminWorkspace } from "./workspace";
import DealEditor from "./DealEditor";
import { SidebarResizer, SidebarToggle, useStaffSidebar } from "./StaffSidebar";
import { StatePanel } from "./ui";
import OverviewTab from "./tabs/OverviewTab";
import DraftsTab from "./tabs/DraftsTab";
import DealsTab from "./tabs/DealsTab";
import SuggestionsTab from "./tabs/SuggestionsTab";
import AffiliatesTab from "./tabs/AffiliatesTab";
import UsersTab from "./tabs/UsersTab";
import RestaurantsTab from "./tabs/RestaurantsTab";
import MailTab from "./tabs/MailTab";
import ReportsTab from "./tabs/ReportsTab";
import FeedbackTab from "./tabs/FeedbackTab";
import CampaignsTab from "./tabs/CampaignsTab";
import GrowthTab from "./tabs/GrowthTab";
import AuditTab from "./tabs/AuditTab";
import HandbookTab from "./tabs/HandbookTab";
import CoverageTab from "./tabs/CoverageTab";
import SponsorshipsTab from "./tabs/SponsorshipsTab";
import DirectoryTab from "./tabs/DirectoryTab";
import AdministrationTab from "./tabs/AdministrationTab";
import DeveloperTab from "./tabs/DeveloperTab";

// THE STAFF WORKSPACE'S SHELL.
// Loading, the sidebar, the header, the summary strip, the notice, the shared dialogs and the deal
// editor live here; each tab's content is its own component under tabs/, and what they share comes
// through the context in workspace.tsx.

// One link in the sidebar. Built as data rather than written out as markup so that the grouping
// below can be derived from what a given role can actually see — see groupNavLinks in sections.ts.
type NavLink = {
  tab: AdminTab;
  label: string;
  icon: ReactNode;
  /** A number worth interrupting somebody with. Zero, or absent, shows no badge at all. */
  count?: number;
  /** What the badge means, for the reader who hovers it wondering what "3" is counting. */
  countTitle?: string;
};

// Module-level, not component state: the sidebar's links are real routes (/admin/<section>), and
// following one mounts a fresh AdminClient, so a Map held in useState was new on every click and a
// list's page, search and filters were all gone by the time anyone came back to it. The module
// lives for the browser tab, which is the "life of the workspace" useTabState promises; it holds
// only on-screen choices, never data, and a sign-out reloads the page and empties it.
const workspaceTabState = new Map<string, unknown>();

export default function AdminClient({ initialTab }: { initialTab: string }) {
  const [now] = useState(() => Date.now());
  const [data, setData] = useState<AdminData | null>(null),
    [tab, setTab] = useState(initialTab),
    // The deal inventory's search box. Held here rather than in DealsTab because the overview and
    // draft review point it at a deal past the 500 loaded rows as they switch to the inventory.
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    // The deal being edited, with a key that changes on every openEditor so the editor starts over.
    [editorSeed, setEditorSeed] = useState<{ deal: Partial<AdminDeal>; key: number } | null>(null),
    [preview, setPreview] = useState<Partial<AdminDeal> | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string,string>>({}),
    [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  // Where useTabState keeps each tab's own state while another tab is showing; see workspace.tsx.
  const tabState = workspaceTabState;
  const sidebar = useStaffSidebar();
  const openEditor = useCallback((value: Partial<AdminDeal>) => {
    setEditorSeed((current) => ({ deal: value, key: (current?.key ?? 0) + 1 }));
    setFieldErrors({});
  }, []);
  const closeEditor = useCallback(() => setEditorSeed(null), []);
  // `search` carries a deep link's filters (?deal=, ?city=, ?region=...) to the tab, which reads
  // them from location.search when it mounts; see geoFromSearch in ui.tsx.
  const openTab = useCallback((nextTab: string, search = "") => {
    setTab(nextTab);
    history.replaceState(null, "", `${tabPath(nextTab as AdminTab)}${search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const load = useCallback(async (): Promise<AdminData | null> => {
    try {
      const response = await fetch("/api/admin");
      if (!response.ok) throw new Error();
      const json = await response.json() as AdminData;
      setData(json);
      setError("");
      return json;
    } catch {
      setError("The staff workspace could not be loaded. Please try again.");
      return null;
    }
  }, []);
  useEffect(() => {
    // Data fetch on mount: setState happens after the awaited fetch resolves, not
    // synchronously in the effect body — a standard, legitimate data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  // busyKey overrides the default id-derived key for actions that legitimately carry no id —
  // "accept the next person in line" targets whoever is at the front of the queue.
  const action = useCallback(async (payload: AdminActionPayload, busyKey?: string) => {
    const key = busyKey || `${payload.action}-${payload.id}`;
    setBusy(key);
    setNotice("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as ActionErrorBody & { id?: string; warning?: string | null; pending?: boolean };
      if (!response.ok) {
        const fieldErrorBody = typeof result?.error === "object" ? result.error : undefined;
        setFieldErrors(fieldErrorBody?.fields || {});
        throw new Error(fieldErrorBody?.message || (typeof result?.error === "string" ? result.error : "") || "Action failed.");
      }
      const fresh = await load();
      // 202: an owner-approval action asked for by someone who is not an owner. Nothing has
      // changed yet, so it must not read as saved.
      if (response.status === 202 || result.pending) setNotice(`Nothing has changed yet. ${result.warning || "Sent to an owner for approval."} You can follow it in Admin.`);
      else setNotice(result.warning ? `Changes saved. ${result.warning}` : "Changes saved.");
      return { data: fresh, id: result.id };
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Action failed.");
      return false as const;
    } finally {
      setBusy("");
    }
  }, [load]);
  const endedCount = data?.dealTotals?.expired || 0;
  // Already ordered oldest-first by the server, so index === place in line.
  const waitlist = data?.waitlist || [];
  // Same rationale for the sidebar badges, which each re-filtered a different full list.
  const navCounts = useMemo(() => ({
    pendingSuggestions: (data?.suggestions || []).filter((s) => s.status === "pending").length,
    // Active managers was never a restaurant-facing metric (it's the self-service invite
    // feature, which almost nobody uses) — missing-photo is the thing this nav item should
    // actually nudge someone to go fix.
    missingPhoto: (data?.restaurants || []).filter((r) => !r.photo_url).length,
    restaurantEdits: (data?.dealChangeRequests || []).length,
    subscribed: (data?.users || []).filter((u) => u.alerts_enabled).length,
    openReports: (data?.reports || []).filter((r) => r.status !== "resolved" && r.status !== "rejected").length,
    openFeedback: (data?.feedback || []).filter((f) => f.status !== "resolved").length,
  }), [data]);
  const permissions = useMemo(() => new Set(data?.currentUser?.permissions || []), [data?.currentUser?.permissions]);
  const canCreateDeals = permissions.has("create_deals");
  const canPublishDeals = permissions.has("publish_deals");
  const canVerifyDeals = permissions.has("verify_deals");
  const pendingCreatorApplications = useMemo(
    () => (data?.creatorApplications || []).filter((application) => application.status === "pending"),
    [data?.creatorApplications],
  );
  const canManageUsers = permissions.has("manage_users");
  const isOwner = data?.currentUser?.role === "owner";
  const canModerateSuggestions = permissions.has("moderate_suggestions");
  const canModerateFeedback = permissions.has("moderate_feedback");
  const canManageEmail = permissions.has("manage_email");
  const canManageSponsorships = permissions.has("manage_sponsorships");
  const canViewAnalytics = permissions.has("view_analytics");
  const canManageFinance = permissions.has("manage_finance");
  const canManageCampaigns = permissions.has("manage_campaigns");
  const canReopenReports = permissions.has("reopen_reports");
  const canUseDeveloperTools = permissions.has("developer_tools");
  const canExport = permissions.has("export_data");
  // The audit trail is sensitive regardless of individual permission grants (a "custom" role can
  // be handed manage_users without being owner/admin), so it's gated on role tier directly rather
  // than on a permission that happens to usually imply it.
  const isAdminPlus = data?.currentUser?.role === "owner" || data?.currentUser?.role === "admin";
  // THE SIDEBAR'S CONTENTS.
  // A link a role cannot use is left out here rather than hidden in the markup, which is what
  // lets the group headings be derived from what survives: no heading can end up hanging over
  // nothing, and adding a link later means adding one row to this list.
  const viewer = { role: data?.currentUser?.role || "", permissions };
  // The tab being shown, or null when this role cannot open it (a stale link, or a role changed
  // while the page was open). The server sends such a role none of the tab's data either.
  const shown = canOpenTab(tab as AdminTab, viewer) ? (tab as AdminTab) : null;
  const pendingApprovals = (data?.approvals || []).filter((approval) => approval.status === "pending").length;
  const navLinkFor = new Map(
    ([
      {
        tab: "overview",
        label: "Overview",
        icon: <Activity />,
        count: data?.staffReminders?.length || 0,
        countTitle: `${data?.staffReminders?.length || 0} deal reminder${data?.staffReminders?.length === 1 ? "" : "s"} to renew or confirm`,
      },
      {
        tab: "drafts",
        label: "Draft review",
        icon: <ClipboardCheck />,
        count: data?.draftReview?.length || 0,
        countTitle: `${data?.draftReview?.length || 0} draft${data?.draftReview?.length === 1 ? "" : "s"} waiting to be verified or archived`,
      },
      { tab: "deals", label: "Deal inventory", icon: <Building2 /> },
      { tab: "ended", label: "Ended & archived", icon: <CalendarX />, count: endedCount, countTitle: `${endedCount} deal${endedCount === 1 ? "" : "s"} past their end date` },
      {
        tab: "restaurants",
        label: "Restaurants",
        icon: <Store />,
        // Active managers was never a restaurant-facing metric (it's the self-service invite
        // feature, which almost nobody uses) — missing-photo is the thing this nav item should
        // actually nudge someone to go fix.
        // A restaurant's edit waiting for review outranks a missing photo: the edit is somebody
        // waiting on Radar, and the photo will keep.
        count: navCounts.restaurantEdits || navCounts.missingPhoto,
        countTitle: navCounts.restaurantEdits
          ? `${navCounts.restaurantEdits} restaurant edit${navCounts.restaurantEdits === 1 ? "" : "s"} waiting for review`
          : `${navCounts.missingPhoto} restaurant${navCounts.missingPhoto === 1 ? "" : "s"} missing a photo`,
      },
      { tab: "coverage", label: "Market coverage", icon: <Globe2 /> },
      { tab: "suggestions", label: "Suggestions", icon: <HeartHandshake />, count: navCounts.pendingSuggestions, countTitle: `${navCounts.pendingSuggestions} suggestion${navCounts.pendingSuggestions === 1 ? "" : "s"} waiting for a decision` },
      { tab: "reports", label: "Accuracy reports", icon: <Flag />, count: navCounts.openReports, countTitle: `${navCounts.openReports} open report${navCounts.openReports === 1 ? "" : "s"}` },
      { tab: "feedback", label: "Product feedback", icon: <MessageSquare />, count: navCounts.openFeedback, countTitle: `${navCounts.openFeedback} open feedback item${navCounts.openFeedback === 1 ? "" : "s"}` },
      {
            tab: "mail",
            label: "Mailing list",
            icon: <Mail />,
            // Surface the queue rather than the subscriber count — a waitlist entry needs an
            // action, a subscriber count does not, so it isn't worth a badge at all.
            count: waitlist.length,
            countTitle: `${waitlist.length} waiting to be accepted`,
      },
      { tab: "campaigns", label: "Campaigns", icon: <Megaphone /> },
      { tab: "growth", label: "Growth", icon: <TrendingUp /> },
      // Its own entry rather than a corner of Users: approving an affiliate, deciding what they
      // are owed and sending them money are three different jobs on two different permissions,
      // and they were invisible while the program was empty.
      {
        tab: "affiliates",
        label: "Affiliates",
        icon: <Banknote />,
        count: pendingCreatorApplications.length,
        countTitle: `${pendingCreatorApplications.length} application${pendingCreatorApplications.length === 1 ? "" : "s"} waiting`,
      },
      { tab: "sponsorships", label: "Sponsorships", icon: <Sparkles /> },
      { tab: "users", label: "Users", icon: <Users /> },
      { tab: "directory", label: "Staff directory", icon: <Contact /> },
      { tab: "audit", label: "Audit log", icon: <Archive /> },
      {
        tab: "admin",
        label: "Admin",
        icon: <KeyRound />,
        count: isOwner ? pendingApprovals : 0,
        countTitle: `${pendingApprovals} request${pendingApprovals === 1 ? "" : "s"} waiting for an owner`,
      },
      { tab: "developer", label: "Developer", icon: <Code2 /> },
    ] as NavLink[])
      // canOpenTab is the same rule the /admin/<section> page enforces on the server, so a link is
      // shown exactly when following it would work.
      .filter((link) => canOpenTab(link.tab, viewer))
      .map((link) => [link.tab, link] as const),
  );
  // THE WORKSPACE SEARCH. Sections by name, and - once something is typed - the records behind
  // them: a deal, a restaurant, a member of staff. Each opens where that record is worked on.
  const searchCommands = useMemo<Command[]>(() => {
    if (!data) return [];
    const tabs: Command[] = adminTabs
      .filter((adminTab) => canOpenTab(adminTab, { role: data.currentUser?.role || "", permissions }))
      .map((adminTab) => ({ id: `tab-${adminTab}`, label: tabTitleFor(adminTab), hint: "Section", keywords: tabBlurbFor(adminTab), run: () => openTab(adminTab) }));
    const deals: Command[] = data.deals.map((deal) => ({
      id: `deal-${deal.id}`,
      label: `${deal.restaurant} — ${deal.title}`,
      hint: `Deal · ${deal.city || "No single city"} · ${deal.status}`,
      keywords: `${deal.city} ${deal.cuisine || ""} ${deal.id}`,
      onlyWhenSearching: true,
      run: () => { setQuery(deal.restaurant); openTab(deal.status === "expired" || deal.status === "archived" ? "ended" : "deals", `?deal=${encodeURIComponent(deal.id)}`); },
    }));
    const restaurants: Command[] = data.restaurants.map((restaurant) => ({
      id: `restaurant-${restaurant.id}`,
      label: restaurant.name,
      hint: "Restaurant",
      keywords: restaurant.website || "",
      onlyWhenSearching: true,
      run: () => openTab("restaurants", `?q=${encodeURIComponent(restaurant.name)}`),
    }));
    const staff: Command[] = (data.staffDirectory || []).map((member) => ({
      id: `staff-${member.id}`,
      label: member.name || member.email || "Staff member",
      hint: `Staff · ${formatRole(member.role)}`,
      keywords: `${member.email || ""} ${member.role}`,
      onlyWhenSearching: true,
      run: () => openTab("directory", `?q=${encodeURIComponent(member.name || member.email || "")}`),
    }));
    return [...tabs, ...deals, ...restaurants, ...staff];
  }, [data, permissions, openTab]);
  const workspace = useMemo<AdminWorkspace | null>(() => data && {
    data,
    load,
    action,
    busy,
    setBusy,
    notice,
    setNotice,
    fieldErrors,
    setFieldErrors,
    now,
    permissions,
    currentUser: data.currentUser,
    openTab,
    openEditor,
    setPreview,
    setConfirmDialog,
    inventoryQuery: query,
    setInventoryQuery: setQuery,
    navCounts,
    pendingCreatorApplications,
    canCreateDeals,
    canPublishDeals,
    canVerifyDeals,
    canManageUsers,
    canManageSponsorships,
    canModerateSuggestions,
    canModerateFeedback,
    canManageEmail,
    canViewAnalytics,
    canManageFinance,
    canManageCampaigns,
    canReopenReports,
    canUseDeveloperTools,
    canExport,
    isOwner,
    isAdminPlus,
    tabState,
  }, [
    data, load, action, busy, notice, fieldErrors, now, permissions, openTab, openEditor, query, navCounts,
    pendingCreatorApplications, canCreateDeals, canPublishDeals, canVerifyDeals, canManageUsers, canManageSponsorships,
    canModerateSuggestions, canModerateFeedback, canManageEmail, canViewAnalytics, canManageFinance, canManageCampaigns,
    canReopenReports, canUseDeveloperTools, canExport, isOwner, isAdminPlus, tabState,
  ]);
  if (error)
    return (
      <div className="portal-loading portal-error">
        <ShieldCheck />
        <h1>Workspace unavailable.</h1>
        <p>{error}</p>
        <button onClick={load}>Try again</button>
        <Link prefetch={false} href="/">Back to deals</Link>
      </div>
    );
  if (!data || !workspace)
    return <div className="portal-loading"><div className="portal-loading-body"><RadarScan /><p>Opening the staff workspace…</p></div></div>;
  return (
    <AdminWorkspaceContext.Provider value={workspace}>
      <main
        className={`portal admin-portal${sidebar.collapsed ? " sw-collapsed" : ""}`}
        style={{ "--sw-aside-width": `${sidebar.width}px` } as CSSProperties}
      >
        <aside>
          <Link prefetch={false} className="brand" href="/">
            <RadarMark />
            Radar
            <i>.</i>
          </Link>
          <div className="workspace-label">STAFF WORKSPACE</div>
          <div className="sw-search">
            <CommandPalette commands={searchCommands} placeholder="Search sections, deals, restaurants, staff…" triggerLabel="Search workspace" limit={40} />
          </div>
          {/* WHAT THE SIDEBAR IS GROUPED BY.
              Purpose, not the shape of the database: somebody opens admin to work on the catalog,
              to clear a queue, to deal with money, or to look something up about an account. The
              division is the staff handbook's own, so the two surfaces teach one mental model.

              Headings come out of groupNavLinks rather than being written here, so a group whose
              links this role cannot see disappears entirely instead of leaving a label over a gap. */}
          <nav aria-label="Staff workspace">
            {groupNavLinks([...navLinkFor.values()]).map(({ group, links }) => (
              <Fragment key={group.id}>
                <span className="nav-group">{group.label}</span>
                {links.map((link) => (
                  <Link prefetch={false} key={link.tab} href={tabPath(link.tab)} className={tab === link.tab ? "active" : ""} aria-current={tab === link.tab ? "page" : undefined} title={link.label}>
                    {link.icon}
                    {link.label}
                    {link.count ? <i title={link.countTitle}>{link.count}</i> : null}
                  </Link>
                ))}
              </Fragment>
            ))}
          </nav>
          <Link prefetch={false} className="backlink" href="/dashboard">
            Personal dashboard
          </Link>
          {/* Down here with the ways out rather than up in the nav, because the handbook is not a
              place you work — it is what you open when a control refuses, or when a deal is wrong
              and somebody is waiting. Tinted so it can be found without hunting, and quieter than
              an active tab so it does not compete with the section you are actually in.

              Ungated, like the tab itself: the person most likely to need it is the one with the
              fewest permissions, because they are the one who most often finds a control missing
              and wonders why. */}
          <Link prefetch={false} className={`backlink nav-handbook${tab === "help" ? " active" : ""}`} href="/admin/help">
            <BookOpen />
            Staff handbook
          </Link>
          <Link prefetch={false} className="backlink" href="/">
            ← Back to Radar
          </Link>
          <SidebarToggle collapsed={sidebar.collapsed} onToggle={() => sidebar.setCollapsed(!sidebar.collapsed)} />
          {!sidebar.collapsed && <SidebarResizer width={sidebar.width} onWidth={sidebar.setWidth} />}
        </aside>
        <section className="portal-main">
          <header>
            <div>
              <span className="kicker">{(adminNavGroups.find((group) => (group.tabs as readonly string[]).includes(tab))?.label || "Staff workspace").toUpperCase()}</span>
              {/* Both of these were a chain of ternaries ending in `: "Audit log"`, so every tab
                  added after the chain was written — affiliates, growth, the handbook itself —
                  opened under the audit log's name and description. A lookup cannot fall through. */}
              <h1>{tabTitleFor(tab)}</h1>
              <p>{tabBlurbFor(tab)}</p>
            </div>
            <div className="admin-identity">
              <ShieldCheck />
              <div>
                <b>{data.currentUser?.name || data.currentUser?.email || "Administrator"}</b>
                <small title={ROLE_DESCRIPTIONS[data.currentUser?.role as keyof typeof ROLE_DESCRIPTIONS] || undefined}>{formatRole(data.currentUser?.role || "admin")} · Protected workspace</small>
              </div>
            </div>
          </header>
          {/* The live region is always mounted: screen readers skip a role="status" that arrives
              already holding its text, which is how every notice here used to appear. */}
          <div className="sr-only" role="status" aria-live="polite">{notice}</div>
          {notice && (
            <div className="admin-notice">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {!shown && (
            <StatePanel kind="error" title="This section is not part of your role.">
              Ask an owner or admin if you need it. Everything you can open is in the sidebar.
            </StatePanel>
          )}
          {shown === "overview" && <OverviewTab />}
          {shown === "drafts" && <DraftsTab />}
          {(shown === "deals" || shown === "ended") && <DealsTab tab={shown} />}
          {shown === "suggestions" && <SuggestionsTab />}
          {shown === "affiliates" && <AffiliatesTab />}
          {shown === "users" && <UsersTab />}
          {shown === "restaurants" && <RestaurantsTab />}
          {shown === "mail" && <MailTab />}
          {shown === "reports" && <ReportsTab />}
          {shown === "feedback" && <FeedbackTab />}
          {shown === "campaigns" && <CampaignsTab />}
          {shown === "growth" && <GrowthTab />}
          {shown === "audit" && <AuditTab />}
          {shown === "coverage" && <CoverageTab />}
          {shown === "sponsorships" && <SponsorshipsTab />}
          {shown === "directory" && <DirectoryTab />}
          {shown === "admin" && <AdministrationTab />}
          {shown === "developer" && <DeveloperTab />}

          {/* THE STAFF HANDBOOK.
              Filed against permissions rather than gated by them: an article is grouped under
              "your job" when you hold the permission it describes, and everything else stays
              readable below. Somebody covering a colleague's queue for a week needs to read how
              that queue works, and a moderator who understands why a payout failed is a moderator
              who escalates it correctly instead of guessing. The only thing permissions decide
              here is the order. */}
          {shown === "help" && <HandbookTab />}
        </section>
        {editorSeed && <DealEditor key={editorSeed.key} initial={editorSeed.deal} onClose={closeEditor} />}
        {confirmDialog && (
          // Backdrop click-to-dismiss is a mouse convenience; Cancel and the Escape key below
          // are the keyboard-accessible ways out.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div className="overlay" onMouseDown={() => setConfirmDialog(null)} onKeyDown={(event) => { if (event.key === "Escape") setConfirmDialog(null); }}>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks originating inside the dialog. The rule this names matters: `role="dialog"` makes the section non-static, so no-static-element-interactions never fires here and a directive naming it is dead. */}
            <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
              <span className="kicker">{confirmDialog.kicker ?? "CANNOT BE UNDONE"}</span>
              <h2 id="confirm-dialog-title">{confirmDialog.title}</h2>
              <p>{confirmDialog.body}</p>
              <div className="editor-actions">
                {/* Focus starts on Cancel, so a stray Enter dismisses rather than destroys.
                    no-autofocus guards against autofocus on page load, which moves focus somewhere
                    the reader did not ask to go. This is the opposite case: a modal the admin just
                    opened, where WAI-ARIA's dialog pattern asks for focus to move inside on open.
                    Leaving it out would strand focus behind an aria-modal dialog. */}
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <button autoFocus onClick={() => setConfirmDialog(null)}>Cancel</button>
                <button
                  className="destructive"
                  disabled={busy === confirmDialog.busyKey}
                  onClick={async () => { await confirmDialog.run(); setConfirmDialog(null); }}
                >{confirmDialog.confirmLabel}</button>
              </div>
            </section>
          </div>
        )}
        {preview && (() => {
          // Mirrors the public deal-grid card's own markup/classes (app/page.tsx) field-for-field
          // — restaurant name prominent with the offer as a line underneath, cuisine pill, "city ·
          // address" order, schedule+price in a .time row — rather than an ad-hoc summary that
          // drifts from what actually ships. Status/verification stay in a separate admin-only
          // strip below the card look-alike so they don't get mistaken for part of the public card.
          const restaurant = data.restaurants.find((r) => r.id === preview.restaurant_id);
          return (
            // Backdrop click-to-dismiss is a mouse-only convenience; the close button below
            // remains the fully keyboard-accessible way to dismiss this dialog.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div className="overlay preview-overlay" onMouseDown={() => setPreview(null)}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
              <section
                className="modal deal-preview"
                role="dialog"
                aria-modal="true"
                aria-label="Deal preview"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <DialogFocus onClose={() => setPreview(null)} />
                <button
                  className="close"
                  aria-label="Close preview"
                  onClick={() => setPreview(null)}
                >
                  <X />
                </button>
                <article className="deal peach preview-card-shell">
                  <CardMedia website={restaurant?.website} source={preview.source_url} photoUrl={restaurant?.photo_url} emoji={preview.emoji} emojiClassName="food" className="card-media">
                    <div className="card-top">
                      <div className="card-top-left">
                        <BrandLogo name={preview.restaurant || ""} website={restaurant?.website} source={preview.source_url} />
                        <span className="tag">Preview · {preview.status || "draft"}</span>
                      </div>
                    </div>
                  </CardMedia>
                  <div className="deal-copy">
                    <span className="cuisine-pill">{preview.cuisine}</span>
                    <h3 className="restaurant-name">{preview.restaurant}</h3>
                    <p className="deal-offer-line">{preview.title}</p>
                    <p>
                      <MapPin /> {preview.city} · {preview.address}
                    </p>
                    <div className="time">
                      <Clock3 />
                      {preview.schedule}
                      <b>{preview.price}</b>
                    </div>
                  </div>
                </article>
                <div className="preview-admin-strip">
                  <span className={`status ${preview.verification_status === "verified" ? "on" : ""}`}>{preview.verification_status || "needs_review"}</span>
                  <small>This preview is private and does not change publication status.</small>
                </div>
              </section>
            </div>
          );
        })()}
      </main>
    </AdminWorkspaceContext.Provider>
  );
}

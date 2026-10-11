// Routing order, which is also the order the command palette lists them in, which is why it
// matches the sidebar's grouping below rather than the order the tabs happened to be built in.
export const adminTabs = [
  "overview", "drafts", "deals", "ended", "restaurants", "coverage",
  "suggestions", "reports", "feedback",
  "mail", "campaigns", "growth",
  "affiliates", "sponsorships",
  "users", "directory", "audit",
  "admin", "developer",
  "help",
] as const;
export type AdminTab = (typeof adminTabs)[number];

const tabToPath: Partial<Record<AdminTab, string>> = { mail: "email" };
const pathToTab = Object.fromEntries(adminTabs.map((tab) => [tabToPath[tab] || tab, tab])) as Record<string, AdminTab>;

export function tabPath(tab: string) {
  return tab === "overview" ? "/admin" : `/admin/${tabToPath[tab as AdminTab] || tab}`;
}
export function tabFromPath(segment: string): AdminTab | null {
  return pathToTab[segment] || null;
}

// One name per tab, used for the sidebar link, the page heading and the browser tab alike, so the
// three can never disagree about where somebody is.
const tabTitle: Record<AdminTab, string> = {
  overview: "Overview",
  drafts: "Draft review",
  deals: "Deal inventory",
  ended: "Ended & archived",
  restaurants: "Restaurants",
  coverage: "Market coverage",
  suggestions: "Suggestions",
  reports: "Accuracy reports",
  feedback: "Product feedback",
  mail: "Mailing list",
  campaigns: "Campaigns",
  growth: "Growth",
  affiliates: "Affiliates",
  sponsorships: "Sponsorships",
  users: "Users",
  directory: "Staff directory",
  audit: "Audit log",
  admin: "Admin",
  developer: "Developer",
  help: "Staff handbook",
};

// The line under each tab's heading: what the page is for and what can be done on it, in one
// sentence. Kept here with the titles rather than in the page, because both used to be a chain of
// ternaries that ended in `: "Audit log"` — so every tab added after the chain was written opened
// with the audit log's heading over somebody else's screen. A lookup cannot fall through: a tab
// with no entry is a type error rather than a page wearing the wrong name.
const tabBlurb: Record<AdminTab, string> = {
  overview: "Your queues and the health of the work you are responsible for, at a glance.",
  drafts: "Pick one draft, check it against its source, then publish it or archive it with a reason.",
  deals: "Search, filter and edit every deal. Pause, publish or verify one deal at a time.",
  ended: "Deals that are no longer public — expired, archived or paused — and why each one stopped.",
  restaurants: "Restaurant photos, portal managers and the edits restaurants have asked for.",
  coverage: "Where Radar has deals, by country, province or state, city and postal area.",
  suggestions: "Deals the public and creators sent in. Inspect each one, then convert it to a draft or reject it with a reason.",
  reports: "Readers telling us a live deal is wrong. Investigate, then resolve or reject each report.",
  feedback: "Bugs, confusing screens, wrong deals and feature requests sent from the site and app.",
  mail: "Deal-alert subscribers, the pilot waitlist and email leads who have not signed up yet.",
  campaigns: "Tracked links: who owns each one, what it is for, and the traffic and sign-ups it brought in.",
  growth: "How people use Radar: engagement, deal performance, visits and what they search for.",
  affiliates: "Approve affiliates, decide commissions and pay what is owed through Stripe.",
  sponsorships: "Paid placements: which deal, in which market, for how long, and how it performed.",
  users: "Find any account, see its plan and settings, and manage creator links and visibility.",
  directory: "Who does what on the team, and how to reach them.",
  audit: "Every change made in the workspace: who, what, when and to which record.",
  admin: "Approvals, roles and permissions, revenue, subscriptions, comps and operator switches.",
  developer: "Integrations, email delivery readiness, test purchases and data exports.",
  help: "How each job here works, step by step, and what to do when something refuses.",
};

export function adminPageTitle(tab: AdminTab) {
  return `${tabTitle[tab]} — Staff workspace — Radar`;
}
export function tabTitleFor(tab: string) {
  return tabTitle[tab as AdminTab] ?? tabTitle.overview;
}
export function tabBlurbFor(tab: string) {
  return tabBlurb[tab as AdminTab] ?? tabBlurb.overview;
}

// HOW THE SIDEBAR IS DIVIDED.
// By what somebody came to do, not by which table the rows live in. A flat list meant reading the
// whole of it every time to work out which four links were the job in front of you.
//
// These are areas of the workspace, not roles: a role decides which links get built (canOpenTab,
// below), and the areas are what is left once they are. The staff handbook is filed the other way
// round — by role — and each of its articles names the area it is about, so the two meet in the
// middle. "help" has no group here because the handbook is not a place you work; it sits with the
// ways out of the workspace instead.
export const adminNavGroups = [
  { id: "catalog", label: "Catalog", tabs: ["overview", "drafts", "deals", "ended", "restaurants", "coverage"] },
  { id: "moderation", label: "Moderation", tabs: ["suggestions", "reports", "feedback"] },
  { id: "commerce", label: "Audience & growth", tabs: ["mail", "campaigns", "growth"] },
  { id: "finance", label: "Finance", tabs: ["affiliates", "sponsorships"] },
  { id: "access", label: "Team & records", tabs: ["users", "directory", "audit"] },
  { id: "admin", label: "Administration", tabs: ["admin", "developer"] },
] as const satisfies readonly { id: string; label: string; tabs: readonly AdminTab[] }[];

export type AdminNavGroup = (typeof adminNavGroups)[number];
/** The part of the workspace something belongs to. Used by the handbook to place an article. */
export type AdminArea = AdminNavGroup["id"];

export function areaLabel(area: AdminArea) {
  return adminNavGroups.find((group) => group.id === area)?.label ?? area;
}

// Lays a set of sidebar links out in those groups, dropping any group left holding nothing.
// That last part is the whole reason this is a function rather than a literal: an analyst holds
// no moderation or access permission, so those links are never built for them, and a
// "Moderation" heading hanging over empty space reads as something broken rather than as
// something withheld.
export function groupNavLinks<T extends { tab: AdminTab }>(links: readonly T[]) {
  const byTab = new Map(links.map((link) => [link.tab, link]));
  return adminNavGroups
    .map((group) => ({
      group,
      links: group.tabs.flatMap((tab) => {
        const link = byTab.get(tab);
        return link ? [link] : [];
      }),
    }))
    .filter((entry) => entry.links.length > 0);
}

// WHO MAY OPEN WHICH TAB.
// One rule, read by the sidebar (to decide which links exist), by the /admin/[section] page (to
// redirect anyone who types a URL they may not open) and by the server routes that feed each tab.
// Hiding a link is never the protection on its own: every read and write behind a tab checks its
// own permission again on the server. This only keeps a person from being shown a tab that would
// be empty for them.
//
// Pure, with no imports beyond types, so the client can run it on the permissions the API sent and
// the server can run it on the session's.
export interface TabViewer {
  role: string;
  permissions: ReadonlySet<string>;
}

const DEAL_WORK = ["create_deals", "publish_deals", "verify_deals"];

export function canWorkDeals(viewer: TabViewer) {
  return DEAL_WORK.some((permission) => viewer.permissions.has(permission));
}

export function canOpenTab(tab: AdminTab, viewer: TabViewer): boolean {
  const has = (permission: string) => viewer.permissions.has(permission);
  if (!has("read_admin")) return false;
  const adminTier = viewer.role === "owner" || viewer.role === "admin";
  switch (tab) {
    case "overview":
    case "deals":
    case "ended":
    case "restaurants":
    case "directory":
    case "help":
      return true;
    case "drafts":
      return canWorkDeals(viewer);
    case "coverage":
      return canWorkDeals(viewer) || has("view_analytics");
    case "suggestions":
      return has("moderate_suggestions");
    case "reports":
    case "feedback":
      return has("moderate_feedback");
    case "mail":
      return has("manage_email");
    case "campaigns":
      return has("manage_campaigns") || has("view_analytics") || has("manage_finance");
    case "growth":
      return has("view_analytics");
    case "affiliates":
      return has("manage_finance");
    case "sponsorships":
      return has("manage_sponsorships");
    case "users":
      return has("manage_users");
    case "audit":
      return adminTier;
    case "admin":
      // Also everyone who can ask for an owner-approval action (a market pause, a sponsorship
      // deletion, a payout, a switch), so they can follow and withdraw their own requests.
      return adminTier || ["manage_finance", "publish_deals", "manage_sponsorships", "manage_users"].some(has);
    case "developer":
      return has("developer_tools") || has("export_data");
  }
}

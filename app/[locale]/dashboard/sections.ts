// The personal dashboard's sections, the order the rail lists them in, and the group each sits in.
//
// Imports nothing: the Worker (app/[locale]/dashboard/[section]/page.tsx) and the tests read this
// list too, and a section missing from it is a redirect to the overview rather than a page.
export const dashboardSections = ["saved", "areas", "preferences", "alerts", "history", "contributions", "account", "billing", "privacy"] as const;
export type DashboardSection = "overview" | (typeof dashboardSections)[number];

/**
 * The rail, as groups of sections under a heading. The overview has no group: it is where the
 * dashboard opens, above the rest. Grouped by what somebody comes here to do, so ten links read as
 * four short lists: find deals, hear about them, what they sent Radar, and their account.
 */
export const dashboardGroups: ReadonlyArray<{ key: "discover" | "alerts" | "contribute" | "account"; sections: readonly DashboardSection[] }> = [
  { key: "discover", sections: ["saved", "areas", "preferences"] },
  { key: "alerts", sections: ["alerts", "history"] },
  { key: "contribute", sections: ["contributions"] },
  { key: "account", sections: ["account", "billing", "privacy"] },
];

// Old addresses that still arrive: ?section=locations and ?section=settings from before the
// sections had paths, and the names a Stripe or email link may carry.
const legacyAliases: Record<string, DashboardSection> = { locations: "areas", settings: "account", subscription: "billing", data: "privacy" };

export function normalizeDashboardSection(value: string): DashboardSection | null {
  if ((dashboardSections as readonly string[]).includes(value)) return value as DashboardSection;
  return legacyAliases[value] || null;
}

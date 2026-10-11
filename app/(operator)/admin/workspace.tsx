"use client";
import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { LIST_PAGE_SIZE, pageRows, type ListPage } from "../ListScope";
import type { AdminActionPayload, AdminCreatorApplication, AdminData, AdminDeal, ConfirmDialogState } from "./types";

/** What `action` hands back: the freshly loaded workspace and the id the API answered with, or false. */
export type ActionResult = { data: AdminData | null; id: string | undefined } | false;

/** The sidebar's badge counts, which a few tabs repeat in their own headings. */
export interface NavCounts {
  pendingSuggestions: number;
  missingPhoto: number;
  restaurantEdits: number;
  subscribed: number;
  openReports: number;
  openFeedback: number;
}

/**
 * What the tabs of the staff workspace share, provided by the shell in AdminClient.tsx.
 *
 * Only what more than one file needs lives here. A tab's own filters, search boxes, forms and the
 * dialogs only it opens stay in the tab's file.
 */
export interface AdminWorkspace {
  /** Always loaded: the shell renders its loading and error states until it is. */
  data: AdminData;
  load: () => Promise<AdminData | null>;
  /** POSTs to /api/admin and reloads. busyKey overrides the default `${action}-${id}` key. */
  action: (payload: AdminActionPayload, busyKey?: string) => Promise<ActionResult>;
  busy: string;
  setBusy: Dispatch<SetStateAction<string>>;
  notice: string;
  setNotice: Dispatch<SetStateAction<string>>;
  fieldErrors: Record<string, string>;
  setFieldErrors: Dispatch<SetStateAction<Record<string, string>>>;
  now: number;
  permissions: Set<string>;
  currentUser: AdminData["currentUser"];
  /** `search` carries a deep link's filters, e.g. "?city=Halifax" or "?deal=<id>". */
  openTab: (tab: string, search?: string) => void;
  /** Opens the shared deal editor on a loaded deal, or on a new draft's starting values. */
  openEditor: (deal: Partial<AdminDeal>) => void;
  /** The private card preview, opened from an inventory row or from inside the editor. */
  setPreview: Dispatch<SetStateAction<Partial<AdminDeal> | null>>;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>;
  /** The deal inventory's search box. Held here so another tab can point it at a deal past the 500 loaded rows. */
  inventoryQuery: string;
  setInventoryQuery: Dispatch<SetStateAction<string>>;
  navCounts: NavCounts;
  pendingCreatorApplications: AdminCreatorApplication[];
  canCreateDeals: boolean;
  canPublishDeals: boolean;
  canVerifyDeals: boolean;
  canManageUsers: boolean;
  canManageSponsorships: boolean;
  canModerateSuggestions: boolean;
  canModerateFeedback: boolean;
  canManageEmail: boolean;
  canViewAnalytics: boolean;
  /** Affiliates, payouts, comps and the money figures. */
  canManageFinance: boolean;
  canManageCampaigns: boolean;
  /** Changing a report or feedback item that is already resolved or rejected. */
  canReopenReports: boolean;
  canUseDeveloperTools: boolean;
  /** Server-side CSV exports (GET /api/admin/export). The developer role and owners only. */
  canExport: boolean;
  isOwner: boolean;
  /** Owner or admin: the audit trail and account visibility are gated on role tier, not a permission. */
  isAdminPlus: boolean;
  /** Backing store for useTabState. */
  tabState: Map<string, unknown>;
}

export const AdminWorkspaceContext = createContext<AdminWorkspace | null>(null);

export function useWorkspace(): AdminWorkspace {
  const workspace = useContext(AdminWorkspaceContext);
  if (!workspace) throw new Error("useWorkspace must be used inside the staff workspace");
  return workspace;
}

/**
 * useState for a tab's own UI state that outlives the tab being switched away from.
 *
 * Every tab used to be one component, so a search typed into the inventory, a half-filled
 * sponsorship form or a chosen audit filter was still there after a look at another tab. Each tab
 * is its own component now and unmounts when it is left; this keeps those values for the life of
 * the workspace, exactly as before, while the state is still declared in the tab that owns it.
 * Dialogs and other momentary state use plain useState.
 */
export function useTabState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { tabState } = useWorkspace();
  const [value, setValue] = useState<T>(() => (tabState.has(key) ? (tabState.get(key) as T) : initial));
  useEffect(() => {
    tabState.set(key, value);
  }, [tabState, key, value]);
  return [value, setValue];
}

/** The ListScope wiring every list in the workspace uses: a search term and a show-all flag per list. */
export function useListScope() {
  // One bag of search terms and one of expand flags, keyed by list, rather than a pair of
  // useState lines for each of the nine lists in the workspace.
  const [listQuery, setListQuery] = useTabState<Record<string, string>>("listQuery", {});
  const [listShowAll, setListShowAll] = useTabState<Record<string, boolean>>("listShowAll", {});
  const listQueryFor = (key: string) => listQuery[key] || "";
  const setListQueryFor = (key: string) => (value: string) => setListQuery((current) => ({ ...current, [key]: value }));
  const showAllFor = (key: string) => Boolean(listShowAll[key]);
  const expandList = (key: string) => () => setListShowAll((current) => ({ ...current, [key]: true }));
  // The page each list is on. `reset` names what the list is showing (its search and filters):
  // when that changes, the list starts again from page 1 rather than from a page of an older result.
  const [listPage, setListPage] = useTabState<Record<string, { page: number; reset: string }>>("listPage", {});
  const pageFor = (key: string, reset = "") => {
    const stored = listPage[key];
    if (!stored) return 1;
    if (stored.reset === reset) return stored.page;
    // Forget the old page as soon as the list shows something else, not just while it does: kept,
    // it came back the moment a search was cleared, so typing a name and deleting it again on page 3
    // of the users landed on page 3 rather than at the top. Updating state during render is React's
    // pattern for state derived from a change; it re-renders once before anything is painted.
    setListPage((current) => ({ ...current, [key]: { page: 1, reset } }));
    return 1;
  };
  const setPageFor = (key: string, reset = "") => (page: number) => setListPage((current) => ({ ...current, [key]: { page, reset } }));
  return { listQueryFor, setListQueryFor, showAllFor, expandList, pageFor, setPageFor };
}

/**
 * One paged list: the page of `rows` on screen, and a way to move to another page. The page is kept
 * per list for the life of the workspace, like the rest of a tab's state. `reset` names what the
 * list is showing (its search and filters); when it changes, the list starts again from page 1.
 * Hand the result to <Pager> from ListScope.tsx.
 */
export function usePagedRows<T>(key: string, rows: T[], reset = "", pageSize = LIST_PAGE_SIZE): [ListPage<T>, (page: number) => void] {
  const [state, setState] = useTabState<{ page: number; reset: string }>(`page.${key}`, { page: 1, reset });
  // As in useListScope's pageFor: a changed search or filter forgets the page, so undoing it later
  // starts from the top rather than bringing an old page back.
  if (state.reset !== reset) setState({ page: 1, reset });
  const paged = pageRows(rows, state.reset === reset ? state.page : 1, pageSize);
  const setPage = useCallback((page: number) => setState({ page, reset }), [setState, reset]);
  return [paged, setPage];
}

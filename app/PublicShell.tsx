import type { ReactNode } from "react";
// The public site's stylesheets: the same fourteen files, in the same order, as OperatorShell.tsx,
// each asked for with `?public`. The build serves that as the file's compiled CSS without the rules
// no public page can match - the admin console, the restaurant portal, the affiliate and creator
// workspaces (the `radar:public-stylesheets` plugin in vite.config.ts, scripts/public-css.mjs). The
// files themselves stay the one source of truth: nothing here is a copy, and a class a public page
// starts using keeps its rules the next time the site is built.
//
// The order is the cascade. Add, remove or reorder a sheet in both shells or in neither;
// tests/public-css.test.mjs holds them to one list.
import "./globals.css?public";
import "./enhancements.css?public";
import "./dashboard.css?public";
import "./polish.css?public";
import "./portal.css?public";
import "./auth.css?public";
import "./refinements.css?public";
import "./newfeatures.css?public";
import "./markets.css?public";
import "./pro.css?public";
import "./dashboard-visuals.css?public";
import "./affiliate.css?public";
import "./site-chrome.css?public";
import "./staff-workspace.css?public";
import { RootShell } from "./RootShell";

/** The public root (app/[locale]/layout.tsx): RootShell's document with the public stylesheet. */
export function PublicShell({ lang, children }: { lang: string; children: ReactNode }) {
  return <RootShell lang={lang}>{children}</RootShell>;
}

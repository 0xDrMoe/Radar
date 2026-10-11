import type { ReactNode } from "react";
// The operator pages' stylesheets - admin, the restaurant portal, portal invites, the affiliate and
// creator workspaces: all fourteen files, whole, in the order RootShell imported them before the
// public site got its own subset (PublicShell.tsx). The order is the cascade, and the public shell
// imports the same list in the same order; tests/public-css.test.mjs holds them to one list.
import "./globals.css";
import "./enhancements.css";
import "./dashboard.css";
import "./polish.css";
import "./portal.css";
import "./auth.css";
import "./refinements.css";
import "./newfeatures.css";
import "./markets.css";
import "./pro.css";
import "./dashboard-visuals.css";
import "./affiliate.css";
import "./site-chrome.css";
import "./staff-workspace.css";
import { RootShell } from "./RootShell";

/** The operator root (app/(operator)/layout.tsx): RootShell's document with every stylesheet. */
export function OperatorShell({ lang, children }: { lang: string; children: ReactNode }) {
  return <RootShell lang={lang}>{children}</RootShell>;
}

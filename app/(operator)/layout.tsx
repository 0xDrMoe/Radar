import type { Metadata } from "next";
import { OperatorShell } from "../OperatorShell";
import { buildSiteMetadata, siteViewport } from "../siteMetadata";

// Admin, the restaurant-operator portal, and portal invites are business/back-office tooling,
// deliberately kept English-only and outside the `[locale]` routing tree (see the
// multi-language plan) — this is their own independent root layout, a sibling of
// app/[locale]/layout.tsx, since neither can see the other's route params.
export const viewport = siteViewport;
export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata();
}

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  return <OperatorShell lang="en">{children}</OperatorShell>;
}

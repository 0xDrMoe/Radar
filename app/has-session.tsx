"use client";
import { createContext, useContext, type ReactNode } from "react";

// Whether the request this page was rendered for carried Clerk's session cookie, for the client
// components that choose by it: app/ChromeLink.tsx, which picks the kind of link the site's pages
// render. RootShell reads the cookie and is the one place that sets this.
//
// Its own module, with nothing in it but React, because RootShell is the root of the operator area
// too, and the provider is all that area needs from it.
const HasSession = createContext(false);

/**
 * Set once, by RootShell. Absent - a page rendered without RootShell around it, such as the
 * not-found page of a path the locale layout rejects - it reads false, and every ChromeLink is a
 * plain link, which works for every reader.
 */
export function HasSessionProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <HasSession value={value}>{children}</HasSession>;
}

export function useHasSession(): boolean {
  return useContext(HasSession);
}

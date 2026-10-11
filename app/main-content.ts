// The id every public page gives its <main>, and the target of the skip link SiteHeader renders
// first on every page. A plain module rather than an export of SiteHeader (a client module) so
// server components such as PublicPage can read the value itself instead of a client reference.
export const MAIN_CONTENT_ID = "main-content";

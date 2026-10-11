import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { MAIN_CONTENT_ID } from "./main-content";

/**
 * The frame of every public page: the site header, the page's own content as the one <main>, and
 * the site footer.
 *
 * Pages used to be `<main className="..."><SiteHeader/>…<SiteFooter/></main>`, so the header's nav
 * and the footer were inside <main>. A <header> or <footer> inside <main> is not a banner or
 * contentinfo landmark, so no page had either, and "skip to main" would have landed on the
 * navigation it was meant to skip. Now the header and footer are siblings of <main>, and the skip
 * link SiteHeader puts first on every page has somewhere to go.
 *
 * The outer element keeps the page's class, and with it the full-height background each page
 * paints behind its header (.legal, .pro-page, .restaurant-page, .deal-page), so nothing moves.
 * <main> takes focus from the skip link (tabIndex -1) without joining the tab order.
 */
export default function PublicPage({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

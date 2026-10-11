import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import PublicPage from "../../PublicPage";
import { appStoreListingUrl } from "../../app-release";
import ChromeLink from "../../ChromeLink";
import { englishOnlyAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
// ChromeLinks, not next-intl's <Link> (app/ChromeLink.tsx): for a reader without a session cookie a
// plain page load, which the Worker answers without a render - /for-restaurants is baked - where a
// client-side link's flight is a render every time. For a reader with the cookie, a client-side
// navigation.

// English-only prose, so one canonical (/en/launch) and no translations, like the legal pages; and
// its own og: tags, or a shared link previews as the home page.
export const metadata = pageMetadata({
  title: "Radar for iPhone — the release",
  description:
    "Radar is out on the App Store: restaurant deals and happy hours near you, with the hours each one actually runs, and when each was last checked or listed.",
  alternates: englishOnlyAlternates("/launch"),
});

// The announcement. Written now, published by a secret later.
//
// This page does not exist until APP_STORE_URL is set to a real apps.apple.com link — it 404s, it
// is absent from the sitemap, and nothing links to it. That is the whole mechanism: the release is
// written, reviewed and deployed in advance, and launch day is `wrangler secret put APP_STORE_URL`
// rather than a code change made under time pressure on the day Apple happens to approve the
// build. `wrangler secret put` publishes a new Worker version, which changes CF_VERSION, which is
// part of the page cache key in worker/index.ts — so the switch takes effect without a deploy.
//
// The same secret ungates /api/jobs/launch-email, and both read appStoreListingUrl() so they
// cannot disagree. Order on the day: set the secret, load this page and click the button, then
// send the email. The email is the irreversible half and it should go last.
//
// Prose ships English-only in all three locales, the convention the legal and support pages
// follow. Machine-translating a launch announcement is a worse failure than not translating it.
//
// Deliberately not claiming a deal count. The catalog changes daily and a number baked into an
// announcement is wrong within a week — every figure below is either structural or checkable.
//
// The same goes for every other claim here, because this page is reviewed once and then published
// weeks later by a secret, with nobody reading it again on the day. Three had already gone false
// before launch: translated deal copy (no translation job has ever run, and the app itself is
// English-only), Canada-only coverage (there are US listings and a US nationwide chain section),
// and restaurants claiming their pages (the portal is invitation-only and /for-restaurants says
// claims are not open). Re-read it against the product before setting APP_STORE_URL.
export const dynamic = "force-dynamic";

export default async function Launch({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const appStoreUrl = await appStoreListingUrl();
  if (!appStoreUrl) notFound();

  return (
    <PublicPage className="legal">
      <article lang="en">
        <span className="kicker">RELEASE</span>
        <h1>Radar is on the App Store</h1>
        <p className="lead">
          Radar shows the restaurant deals running near you — happy hours, daily specials and
          standing food deals — with the hours each one actually runs and when each was last
          checked, or listed if it has not been checked yet. It is free, it works without an account, and it is out now for iPhone.
        </p>

        <p>
          <a className="release-cta" href={appStoreUrl}>
            Download Radar on the App Store
          </a>
        </p>

        <h2>The problem it fixes</h2>
        <p>
          Deal listings go stale quietly. A page that says half-price wings tells you nothing about
          whether that is true at seven on a Tuesday, and the usual way to find out is to arrive and
          be told the offer ended in March. Radar stores the <strong>schedule</strong> rather than
          the coupon, so a happy hour that runs 3&ndash;6pm Tuesday to Friday is shown as running or
          not running at the minute you ask. Filter to <em>available now</em> and what is left is
          what you can actually walk into.
        </p>

        <h2>What is in this release</h2>
        <ul>
          <li>
            <strong>A map of what is on right now.</strong> The same search as a list, on a map, with
            pins grouped by address so a shopping center is one pin rather than six stacked on one
            point.
          </li>
          <li>
            <strong>Receipts on every deal.</strong> Each listing links to its source and says when
            it was last verified, or, if we have not checked it yet, when it was listed. One whose
            last check is more than a month old is marked Re-checking. Nothing is presented as more
            current than it is.
          </li>
          <li>
            <strong>Chains that behave like chains.</strong> An offer running at thirteen branches is
            one card covering thirteen locations, not thirteen near-identical results — with the
            per-branch price kept where branches differ.
          </li>
          <li>
            <strong>Search that narrows properly.</strong> Cuisine, price, deal type, distance, and
            whether it is running now; sorted by recommended, nearest, newest, most saved, biggest
            saving, price or restaurant.
          </li>
          <li>
            <strong>Tracked areas and alerts.</strong> Name a postal code and a radius and get a
            roundup of the deals in it, by push or email, on the day of the week you pick. Off
            unless you turn it on.
          </li>
          <li>
            <strong>In English.</strong> The website also reads in French and Spanish, though the
            deals themselves are shown as they were written, which is usually in English.
          </li>
        </ul>

        <h2>What it costs</h2>
        <p>
          Nothing, for the part most people want. Browsing, search, the map and filters all work
          without an account. <strong>Radar Pro</strong> raises the number of tracked areas, the
          alert radius and how far back history goes, and lets alerts arrive on the days and at the
          time you choose; in the app it is <strong>C$6.99 a month</strong>
          {" "}through the App Store, and on this website it is <strong>C$4.99 a month</strong>. The
          difference is Apple&rsquo;s commission, and it is why the web price is the cheaper one.
        </p>

        <h2>What it does not do</h2>
        <p>
          There are no ads, no third-party analytics and no tracking SDK in the app &mdash; not as a
          roadmap item, but as a thing you can check on the App Store privacy label. Your location
          is used to run the search and is not written to our database. Signing in is optional and
          buys you saved deals, tracked areas and alerts; browsing needs nothing.
        </p>

        <h2>Where it works</h2>
        <p>
          Canada and the United States. Coverage is deepest in and around Ottawa, with listings in
          cities across the country from Victoria to St. John&rsquo;s, and local listings in a
          smaller number of US cities. Chain promotions that run across a whole country, in Canada
          or the US, sit in a nationwide section of their own, off until you switch it on. Coverage
          grows where restaurants and readers send deals in; a thin result set in your city is a gap
          we would like told about rather than a verdict on your city.
        </p>

        <h2>For restaurants</h2>
        <p>
          Listing a deal is free. A restaurant can send us its offers, or a correction to its
          listing, through <ChromeLink href="/for-restaurants">Radar for restaurants</ChromeLink>; each one is
          checked against the source it cites before it is published, which is the difference
          between a listing that ages and one that does not.
        </p>

        <h2>Press and contact</h2>
        <p>
          Radar is made by Cedar Tech Solutions. For anything at all &mdash; questions, a listing
          that is wrong, or a press enquiry &mdash;{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> reaches a
          person.
        </p>

        <p>
          <a className="release-cta" href={appStoreUrl}>
            Download Radar on the App Store
          </a>
        </p>
      </article>
    </PublicPage>
  );
}

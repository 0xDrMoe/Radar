import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { translatedAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import ChromeLink from "../../ChromeLink";
import PublicPage from "../../PublicPage";
import LegalToc from "../LegalToc";
import SupportFr, { SUPPORT_FR_META } from "./SupportFr";
import { SUPPORT_PHONE } from "../../business-contact";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const alternates = translatedAlternates(locale, "/support", ["fr"]);
  if (locale === "fr") return pageMetadata({ alternates, ...SUPPORT_FR_META, imageAlt: "Radar — offres de restaurants et 5 à 7 à proximité" });
  return pageMetadata({
    alternates,
    title: "Support — Radar",
    description:
      "How to get help with Radar: contacting us, accounts and sign-in, deal alerts, Radar Pro billing and cancellation, location, reporting a listing, and deleting your data.",
  });
}

// The page an app store points at, and the page somebody lands on when the app has not done what
// they expected. Apple requires a support URL for every listing, and what it is checked against is
// not the design — it is whether a person arriving with a problem can find a way to reach a human,
// and whether the answers here match what the product actually does.
//
// So every claim below is one the code backs up: the dashboard sections named are the ones in
// app/[locale]/dashboard/sections.ts, the download link is the route in app/api/user/export, the
// deletion address is the one the dashboard's own link uses, and the two billing paths are the two
// that exist — Stripe on the web, Apple's own subscription screen for a purchase made in the iOS
// app. Apple will not let us cancel that one on someone's behalf, and saying otherwise sends
// people to a button that is not there.
//
// The contact address is support@cedartechsolutions.ca. radar.cheap publishes no MX
// records, so anything sent to an address at that domain bounces; the company domain is the
// one that receives mail. There is one mailbox on it, so privacy requests come here too and
// are sorted by subject line rather than by a second address that would have to exist first.
//
// English, and a French translation in SupportFr.tsx (machine-translated for now, like the legal
// pages; see app/[locale]/privacy/page.tsx). Spanish readers get the English article, which says
// so with lang="en" so a screen reader under /es does not read it with Spanish pronunciation. A
// change to this article is a change to SupportFr.tsx in the same commit, with the same ids.
//
// Where Radar works is described, not counted. This section once named two cities, one of which
// had four listings, while the App Store listing that links here named dozens: a list of places or
// a number would go stale the same way. What stays true is the shape — deepest around Ottawa,
// thin across the rest of Canada and in the few US cities with local listings, the nationwide
// chain section beside them — and what a thin area does (app/api/deals/route.ts: a radius, an
// offer to widen it below four results, a "still growing" note on the website, never results
// from elsewhere).
const SECTIONS = [
  ["contact", "1. Contact us"],
  ["coverage", "2. Where Radar works"],
  ["account", "3. Accounts and sign-in"],
  ["alerts", "4. Tracked areas and deal alerts"],
  ["pro", "5. Radar Pro, billing and canceling"],
  ["location", "6. Location"],
  ["listings", "7. A deal is wrong, expired, or missing"],
  ["data", "8. Your data and deleting your account"],
  ["accessibility", "9. Accessibility"],
  ["restaurants", "10. Restaurant owners"],
] as const;

export default async function Support({ params }: { params: Promise<{ locale: string }> }) {
  // The page's links to its sibling pages are ChromeLinks (app/ChromeLink.tsx): for a reader
  // without a session cookie, a page load the Worker answers without rendering; for one with it, a
  // client-side navigation, since that reader's pages are rendered either way and a flight is the
  // cheaper render. Never a prefetching <Link>: each of those was prefetched as it scrolled into
  // view, a render of the page it named.
  const { locale } = await params;
  setRequestLocale(locale);
  if (locale === "fr") {
    return (
      <PublicPage className="legal">
        <SupportFr />
      </PublicPage>
    );
  }
  return (
    <PublicPage className="legal">
      <article lang="en">
        <span className="kicker">SUPPORT</span>
        <h1>Help with Radar</h1>
        <p className="lead">
          Radar is a listings app: it shows restaurant deals happening near you, with the days and
          hours each one runs. If something is not working, or a listing is wrong, write to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> and a person will read it.
          The rest of this page answers the questions we are asked most often.
        </p>

        <LegalToc sections={SECTIONS} />

        <h2 id="contact">1. Contact us</h2>
        <p>
          <strong>
            <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>
          </strong>{" "}
          for anything at all — a bug, a question, a listing that is wrong, an account you cannot
          get into, or a charge you would like us to look at. We aim to answer within two business
          days.
        </p>
        <p>
          You can also call us at <a href={`tel:${SUPPORT_PHONE.tel}`}>{SUPPORT_PHONE.display}</a>.
        </p>
        <p>
          It helps, though it is not required, if you tell us which device and app version you are
          on, the city you were searching, and what you expected to happen instead.
        </p>
        <p>
          Privacy requests — access, correction, deletion, portability — go to the same
          address, for the attention of our Privacy Officer. Put &ldquo;privacy request&rdquo; in the
          subject line, so that they are handled on the timelines the{" "}
          <ChromeLink href="/privacy#rights">Privacy Policy</ChromeLink> commits to.
        </p>

        <h2 id="coverage">2. Where Radar works</h2>
        <p>
          Radar lists restaurant deals in cities across Canada and in a smaller number of US
          cities. Coverage is deepest in and around Ottawa. Elsewhere in Canada, from Victoria to
          St. John&rsquo;s, a city may have only a handful of listings rather than a full picture,
          and the same is true of the US cities with local listings. We add places as we research
          them and as restaurants and readers send deals in.
        </p>
        <p>
          Chain restaurants whose promotions run at participating locations across a whole country,
          in Canada or the US, are kept in a nationwide section rather than mixed into the local
          results. It stays hidden until you turn on <strong>Chain restaurants</strong>, and it is
          where most of Radar&rsquo;s US deals are.
        </p>
        <p>
          Results are limited to a radius around the place you searched, which you can widen. When
          only a few deals fall inside it, Radar offers to search farther, and the website also
          says when an area&rsquo;s coverage is still growing. If nothing falls inside the radius,
          the list is empty rather than filled with offers from somewhere else. That is deliberate:
          a deals app that fills the screen with offers two provinces away is worse than one that
          admits it has nothing for you.
        </p>
        <p>
          You do not have to be in a covered city to look at one. Open Search, tap{" "}
          <strong>Change</strong> beside the location at the top, and type a city name or a postal
          or ZIP code.
        </p>

        <h2 id="account">3. Accounts and sign-in</h2>
        <p>
          <strong>You do not need an account to use Radar.</strong> Browsing, search, the map and
          the filters all work signed out. An account is only needed to save deals, track areas and
          receive alerts.
        </p>
        <p>
          Sign-in is handled by Clerk, with an email address or a linked Google or Apple account. If
          a sign-in email does not arrive, check the spam folder first. If the address on the
          account is one you no longer control, write to us — we can help, but we will need to
          verify who you are before changing anything.
        </p>

        <h2 id="alerts">4. Tracked areas and deal alerts</h2>
        <p>
          A tracked area is a place you want to hear about: a postal or ZIP code and a radius around
          it. Add one from <strong>Areas</strong> in your dashboard. The free plan tracks one area;
          Radar Pro tracks several.
        </p>
        <p>
          Email alerts stay off until you confirm them. We ask once, you confirm from the email, and
          you can turn them off again from <strong>Alerts</strong> in your dashboard or from the
          unsubscribe link at the foot of any alert. Push notifications on iOS follow the system
          permission and can be revoked in iOS Settings at any time.
        </p>
        <p>
          A roundup lists up to eight of the deals in your tracked area, on the day you picked (or
          the days and time you picked, with Radar Pro). It is skipped when nothing is listed within
          the area&rsquo;s radius, so if alerts have gone quiet, the usual cause is an area with no
          listings nearby, and widening its radius in <strong>Areas</strong> is the fix. Email
          alerts are also opening to people gradually: if <strong>Alerts</strong> in your dashboard
          shows you on the waitlist, no email has been sent yet. Once you are in, the same page has
          a button that sends a test message, which settles the question either way.
        </p>

        <h2 id="pro">5. Radar Pro, billing and canceling</h2>
        <p>
          Radar Pro is a subscription, monthly or yearly on the website and monthly in the iOS app.
          It tracks more than one area, alerts on all of them,
          unlocks the wider alert radii, lets you choose the days and the time alerts arrive, and
          makes your alert history exportable.
        </p>
        <p>
          <strong>If you subscribed in the iOS app</strong>, the subscription belongs to your Apple
          ID and Apple does the billing. Cancel it from{" "}
          <a
            href="https://apps.apple.com/account/subscriptions"
            target="_blank"
            rel="noreferrer noopener"
          >
            Settings &rsaquo; your name &rsaquo; Subscriptions
          </a>{" "}
          on your device. We cannot cancel or refund an Apple purchase for you; refunds are
          requested from Apple at{" "}
          <a href="https://reportaproblem.apple.com" target="_blank" rel="noreferrer noopener">
            reportaproblem.apple.com
          </a>
          . Access continues until the end of the period already paid for.
        </p>
        <p>
          <strong>If you subscribed on the website</strong>, billing runs through Stripe. Open{" "}
          <strong>Account</strong> in your dashboard and use <strong>Manage billing</strong> to
          change the payment method, read invoices, or cancel.
        </p>
        <p>
          If Pro features are not showing after a purchase, sign out and back in first — the
          entitlement is read at sign-in. If that does not fix it, write to us with the email on the
          account and we will sort it out.
        </p>

        <h2 id="location">6. Location</h2>
        <p>
          The app asks for location so it can sort deals by how far away they are. Declining is
          fully supported: type a city, postal code or ZIP code instead and everything else behaves
          the same. You can change your mind either way in iOS Settings under Radar.
        </p>
        <p>
          Distances are straight-line distances from where you are to the restaurant rather than
          driving distances, so treat them as a guide.
        </p>

        <h2 id="listings">7. A deal is wrong, expired, or missing</h2>
        <p>
          Restaurants change their offers and do not always tell anyone. Radar shows what it has
          been told and shows you when it last checked a deal, or when it listed one it has not
          checked yet, which is the honest version of a problem we
          cannot fully solve. <strong>Confirm with the restaurant before you travel</strong>,
          particularly for anything time-limited.
        </p>
        <p>
          Every deal page carries a short control asking whether the listing was accurate. It is the
          fastest way to tell us something is off, and it is read. You can also send the link to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
        </p>
        <p>
          To suggest a restaurant we do not list, use the suggestion form on the home page. If you
          run a restaurant and want to send us its offers or correct its listing, see{" "}
          <ChromeLink href="/for-restaurants">Radar for restaurants</ChromeLink>.
        </p>

        <h2 id="data">8. Your data and deleting your account</h2>
        <p>
          <strong>Download a copy.</strong> <strong>Account</strong> in your dashboard has a
          download link that returns everything held against your account as a file.
        </p>
        <p>
          <strong>Delete the account.</strong> Write to{" "}
          <a href="mailto:support@cedartechsolutions.ca?subject=Radar%20account%20deletion%20request">
            support@cedartechsolutions.ca
          </a>{" "}
          from the address on the account, or use the deletion link in <strong>Account</strong>.
          Deleting the account removes your profile, saved deals, tracked areas, alert settings,
          email consent history and delivery history. A few records outlive it in a reduced form, for
          the reasons and periods set out in the{" "}
          <ChromeLink href="/privacy#retention">Privacy Policy</ChromeLink>: an address that
          unsubscribed or bounced stays on our do-not-email list so it is never mailed again, billing
          records are kept as long as tax law requires, and a deal you suggested can stay published
          without your name or email.
        </p>
        <p>
          Deleting a Radar account does not cancel an Apple subscription — cancel that separately,
          as described above, or Apple will keep billing you.
        </p>

        <h2 id="accessibility">9. Accessibility</h2>
        <p>
          We aim for the Radar website and apps to meet the Web Content Accessibility Guidelines
          (WCAG) 2.2 at level AA, and we build them to work with screen readers, keyboard-only
          navigation and enlarged text. If something on Radar is hard to use with a disability or
          assistive technology, write to{" "}
          <a href="mailto:support@cedartechsolutions.ca?subject=Accessibility">support@cedartechsolutions.ca</a>{" "}
          with &ldquo;Accessibility&rdquo; in the subject line, and say which page or screen you were
          on and what you were trying to do. We reply within 5 business days. On request, we will
          provide any information on Radar, including our Terms of Service and Privacy Policy, in an
          accessible format or with communication support, at no cost.
        </p>
        <p>
          The iOS app supports VoiceOver, Voice Control, Dynamic Type at the accessibility sizes,
          Dark Mode, Increased Contrast and Reduce Motion. If you hit something that does not work
          with the assistive technology you use, tell us what you were trying to do and which
          setting you had on. Those reports are how the gaps get found, and they are treated as bugs
          rather than as requests.
        </p>
        <p>
          Radar carries no video or audio content, so there is nothing in it that needs captions or
          audio description.
        </p>

        <h2 id="restaurants">10. Restaurant owners</h2>
        <p>
          If you run a restaurant we list and something is wrong, or you would like to be listed,{" "}
          <ChromeLink href="/for-restaurants">Radar for restaurants</ChromeLink> has a form for sending us an
          offer or a correction, and it reaches us directly. Each one is checked against the source
          you give before anything is published. Restaurants cannot claim or edit their own page
          yet; the restaurant portal is by invitation only. Removal requests are honored — write to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> and
          include the link to the listing.
        </p>
      </article>
    </PublicPage>
  );
}

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { translatedAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import ChromeLink from "../../ChromeLink";
import PublicPage from "../../PublicPage";
import LegalToc from "../LegalToc";
import TermsFr, { TERMS_FR_META } from "./TermsFr";
import { TERMS_LAST_UPDATED, legalDate } from "../legal-meta";
import { SUPPORT_PHONE } from "../../business-contact";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const alternates = translatedAlternates(locale, "/terms", ["fr"]);
  if (locale === "fr") return pageMetadata({ alternates, ...TERMS_FR_META, imageAlt: "Radar — offres de restaurants et 5 à 7 à proximité" });
  return pageMetadata({
    alternates,
    title: "Terms of Service — Radar",
    description:
      "The terms governing use of Radar, including accounts, Radar Pro subscriptions, community submissions, and liability.",
  });
}

// English, and a French translation in TermsFr.tsx: Quebec's Charter of the French Language
// (s. 55, as amended by Bill 96) entitles Quebec readers to an adhesion contract in French. The
// French is a machine translation for now (approved by the operator) and says so at its top;
// see the note in app/[locale]/privacy/page.tsx. A change to this article is a change to
// TermsFr.tsx in the same commit, with the same section ids.
const SECTIONS = [
  ["scope", "1. Who these terms are between"],
  ["service", "2. What Radar provides"],
  ["accuracy", "3. Offer accuracy is not guaranteed"],
  ["accounts", "4. Accounts and eligibility"],
  ["plans", "5. Free plan and Radar Pro"],
  ["alerts", "6. Deal alert emails"],
  ["submissions", "7. Community submissions"],
  ["restaurants", "8. Restaurant listings, claims, and the operator portal"],
  ["sponsored", "9. Sponsored placements"],
  ["acceptable-use", "10. Acceptable use"],
  ["moderation", "11. Moderation and enforcement"],
  ["ip", "12. Intellectual property"],
  ["third-party", "13. Third-party services and links"],
  ["disclaimers", "14. Disclaimers"],
  ["liability", "15. Limitation of liability"],
  ["indemnity", "16. Indemnity"],
  ["changes", "17. Changes to the service and these terms"],
  ["termination", "18. Termination"],
  ["general", "19. General"],
  ["contact", "20. Contact"],
] as const;

export default async function Terms({ params }: { params: Promise<{ locale: string }> }) {
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
        <TermsFr />
      </PublicPage>
    );
  }
  return (
    <PublicPage className="legal">
      {/* English under the Spanish <html lang> too; see the same note on the privacy page. */}
      <article lang="en">
        <span className="kicker">LAST UPDATED {legalDate(TERMS_LAST_UPDATED, "en")}</span>
        <h1>Terms of Service</h1>
        <p className="lead">
          These terms govern your use of Radar. By browsing deals, creating an account, submitting
          information, or subscribing to Radar Pro, you agree to them. If you do not agree, do not
          use the service.
        </p>

        <LegalToc sections={SECTIONS} />

        <h2 id="scope">1. Who these terms are between</h2>
        {/*
          Both names, deliberately. Ontario's Business Names Act s. 2(6) requires a corporation
          identifying itself to the public under a registered name to "set out both the registered
          name and the person's name in all contracts, invoices, negotiable instruments and orders
          involving goods or services" — and this document is a contract, agreed to by anyone who
          subscribes to Pro.

          That is why the numbered company appears here and nowhere else on the site. The privacy
          policy names Cedar Tech Solutions alone: it is not a contract, so 2(6) does not reach it,
          and the entity behind the registered name is one click away in these terms. Do not
          "clean up" the corporate name out of this paragraph.
        */}
        <p>
          &ldquo;Radar&rdquo;, &ldquo;we&rdquo;, and &ldquo;us&rdquo; mean 1000928808 Ontario Corp.,
          carrying on business as Cedar Tech Solutions, an Ontario corporation reachable at{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> or by phone
          at <a href={`tel:${SUPPORT_PHONE.tel}`}>{SUPPORT_PHONE.display}</a>.
          &ldquo;You&rdquo; means the person using the service. Radar is published at radar.cheap. Our{" "}
          <ChromeLink href="/privacy">Privacy Policy</ChromeLink> is incorporated into these terms by reference.
        </p>

        <h2 id="service">2. What Radar provides</h2>
        <p>
          Radar indexes restaurant promotions — happy hours, recurring weekday specials, and
          limited-time offers — from public sources and community suggestions, and helps you find
          the ones near a postal or ZIP code you enter. Every listing links to the source it came
          from and shows when it was last verified or, if it has not been verified, when it was
          listed, so you can judge how current it is.
        </p>
        <p>
          Radar is an information service. We are not a restaurant, a reservation system, a delivery
          service, or an agent of any restaurant. We do not sell food, set prices, or accept orders.
          Markets labeled Limited or Researching have incomplete coverage, and a coverage label is
          never a promise that every local promotion has been indexed.
        </p>

        <h2 id="accuracy">3. Offer accuracy is not guaranteed</h2>
        <p>
          Restaurants control their own prices, hours, eligibility rules, participating locations,
          and whether an offer runs at all. Offers change and end without notice, and a chain
          promotion may not be honored at every branch. We research from linked sources and publish
          verification dates, but we cannot guarantee that a listing is correct at the moment you
          read it.
        </p>
        <p>
          <strong>
            Confirm every offer directly with the restaurant before ordering or traveling.
          </strong>{" "}
          Radar does not guarantee savings or availability, and is not responsible for a restaurant
          declining to honor a listed offer.
        </p>

        <h2 id="accounts">4. Accounts and eligibility</h2>
        <p>
          You may browse Radar without an account. Saving deals, tracking areas, and receiving alerts
          require one. Accounts are created and authenticated through our identity provider; you are
          responsible for keeping your sign-in credentials secure and for activity that happens
          through your account.
        </p>
        <p>
          You must be at least 14 years old to create an account, and old enough in your jurisdiction
          to agree to these terms. Radar is not directed to children. One person may not maintain
          multiple accounts in order to evade free-plan limits or an enforcement action.
        </p>

        <h2 id="plans">5. Free plan and Radar Pro</h2>
        <p>
          Radar&rsquo;s free plan includes browsing and search, saved deals, one tracked area with a
          search radius of up to 50 km, a weekly alert email on one day at a fixed delivery time, and
          your most recent 20 notification records. Radar Pro is a paid subscription that removes
          those limits — unlimited tracked areas, a radius of up to 100 km, alerts on the days and at
          the time you choose, a longer notification history (your last 500 deliveries, against 20
          on the free plan) with CSV export, and two additional accent themes. The current
          comparison is on our <ChromeLink href="/pro">plans page</ChromeLink>.
        </p>
        <p>
          Radar Pro can be bought in two places, the website and the Radar iOS app, and each is
          billed by a different company. Whichever you use, the plan and its features are the same.
        </p>
        <p>
          <strong>Billing on the website.</strong> A subscription bought at radar.cheap is billed
          through Stripe, our payment processor. The price, currency, and billing interval are shown
          on Stripe&rsquo;s checkout page before you confirm, and your subscription renews
          automatically at that interval until you cancel. We never receive or store your full card
          number; see <ChromeLink href="/privacy#payments">Payments</ChromeLink> in our Privacy Policy for the
          payment data we do hold.
        </p>
        <p>
          <strong>Purchases in the iOS app.</strong> A subscription bought inside the Radar iOS app
          is sold through Apple&rsquo;s App Store and belongs to your Apple ID. Apple charges it at
          the price shown in the App Store before you confirm, which can differ from the website
          price, renews it automatically at the end of each period unless you turn off automatic
          renewal at least 24 hours before the period ends, and handles its billing under
          Apple&rsquo;s own terms. You manage and cancel it from Settings &rsaquo; your name &rsaquo;
          Subscriptions on your device. We cannot cancel or refund an App Store purchase for you:
          refunds for it are requested from Apple at{" "}
          <a href="https://reportaproblem.apple.com" target="_blank" rel="noreferrer noopener">
            reportaproblem.apple.com
          </a>{" "}
          and decided by Apple. Deleting your Radar account does not cancel an App Store
          subscription.
        </p>
        <p>
          <strong>Canceling.</strong> A website subscription can be canceled at any time from Account
          &amp; privacy in your dashboard, which opens Stripe&rsquo;s billing portal; an App Store
          subscription is canceled through Apple, as described above. Canceling stops the next
          renewal; Pro features remain available until the end of the period you have already paid
          for, after which the account returns to the free plan. Tracked areas you already added stay
          in your account — the free-plan limit applies only to adding new ones.
        </p>
        <p>
          <strong>Refunds.</strong> Fees for a website subscription are non-refundable, and we do not
          provide partial refunds for unused time in a billing period, except: (a) if you cancel a
          yearly plan within 15 days after it renews, we refund that renewal in full; (b) if you
          cancel within 14 days after the first charge at a new, higher price, we refund the
          difference for the unused time; and (c) wherever else the law requires a refund. If you believe you were charged in error on the website, write to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> and we will
          review it. Refunds for App Store purchases are handled by Apple under its own policies.
        </p>
        <p>
          <strong>Price and feature changes.</strong> We may change a subscription price or what a
          plan includes. A price change takes effect no earlier than your next renewal, and we will
          give you notice beforehand so you can cancel first. Taxes may be added where required.
        </p>
        <p>
          <strong>Failed payments.</strong> If a renewal payment fails or a subscription lapses, we
          may return the account to the free plan until payment succeeds.
        </p>

        <h2 id="alerts">6. Deal alert emails</h2>
        <p>
          Creating an account never opts you into marketing email. Deal alerts are delivered only
          during a controlled pilot and require a confirmed consent record, an enabled preference, no
          active suppression, and pilot eligibility — so requesting alerts may place you on a
          waitlist rather than starting delivery immediately. Every message includes a way to stop
          future messages, and you can disable alerts in your dashboard at any time. Transactional
          messages about your account, such as email confirmations, are not marketing and are sent
          regardless of marketing preferences.
        </p>

        <h2 id="submissions">7. Community submissions</h2>
        <p>
          When you suggest a deal, report an incorrect listing, or send feedback, you grant Radar a
          non-exclusive, worldwide, royalty-free license to review, edit, publish, translate,
          display, and remove that information as part of the service. You keep whatever rights you
          already had in what you submitted.
        </p>
        <p>
          You confirm that your submission is accurate to the best of your knowledge and that it does
          not infringe anyone&rsquo;s rights. Submissions, feedback, and incorrect-deal reports may
          be reviewed by authorized administrators and are retained with an operational audit
          history. We may decline, edit, or remove any submission, and we are under no obligation to
          publish one.
        </p>

        <h2 id="restaurants">8. Restaurant listings, claims, and the operator portal</h2>
        <p>
          A listing can be created from public sources without the restaurant&rsquo;s involvement,
          and a restaurant appearing on Radar does not mean it is a partner or has approved its
          listing. A restaurant submission is reviewed as information, not accepted as proof of
          ownership. Chain participation is verified by branch where we can.
        </p>
        <p>
          Restaurant claims, operator analytics, and the restaurant portal are made available by
          invitation and may require separate verification and additional terms before access is
          granted. If you use the portal on behalf of a business, you confirm you are authorized to
          act for that business and you are responsible for the accuracy of what you publish through
          it. A restaurant may ask us to correct or remove its listing by writing to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
        </p>

        <h2 id="sponsored">9. Sponsored placements</h2>
        <p>
          Paid or promoted placements are labeled &ldquo;Sponsored&rdquo;. Sponsorship may affect
          where a listing appears, but it never removes the restaurant&rsquo;s responsibility for its
          own offer, and it does not stop us from reviewing, correcting, or removing inaccurate
          information in a sponsored listing.
        </p>

        <h2 id="acceptable-use">10. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>submit false, misleading, or spam listings, reports, or feedback;</li>
          <li>impersonate another person, a business, or Radar itself;</li>
          <li>
            scrape, crawl, or bulk-download the service, or use automated means to access it beyond
            ordinary browsing;
          </li>
          <li>
            circumvent rate limits, bot checks, plan limits, authentication, or any other access
            control;
          </li>
          <li>probe, disrupt, or overload the service or its infrastructure;</li>
          <li>
            upload malicious code, or content that is unlawful, harassing, hateful, or infringing;
          </li>
          <li>
            resell, sublicense, or commercially redistribute Radar&rsquo;s data without written
            permission; or
          </li>
          <li>use Radar to break any applicable law.</li>
        </ul>

        <h2 id="moderation">11. Moderation and enforcement</h2>
        <p>
          We may review, moderate, edit, or remove content, and we may warn, rate-limit, suspend, or
          terminate an account that breaches these terms, creates legal risk, or harms other users or
          the service. Where it is practical and appropriate we will tell you why, but we may act
          first when the situation requires it.
        </p>

        <h2 id="ip">12. Intellectual property</h2>
        <p>
          Radar&rsquo;s name, branding, software, design, layout, compilation of listings, and
          original written content belong to the site operator and are protected by intellectual
          property law. Restaurant names, logos, menus, and trademarks belong to their respective
          owners and are used to identify the businesses being described. A listing does not imply
          sponsorship, endorsement, or affiliation unless it is expressly labeled as such.
        </p>
        <p>
          Radar&rsquo;s source code is also published under the GNU Affero General Public License,
          version 3, at <a href="https://github.com/Cedar-Tech-Solutions/Radar">github.com/Cedar-Tech-Solutions/Radar</a>.
          That license covers the code in that repository only. It grants no rights in Radar&rsquo;s
          name, logo, or branding, in its listings or their compilation, or in its written content,
          all of which remain covered by this section.
        </p>
        <p>
          You receive a limited, personal, non-transferable, revocable license to use Radar for your
          own non-commercial purposes. If you believe content on Radar infringes your rights, contact{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> with enough detail to identify
          the material and your claim.
        </p>

        <h2 id="third-party">13. Third-party services and links</h2>
        <p>
          Radar links to restaurant websites and other external sources, and relies on third-party
          providers for authentication, hosting, maps and geocoding, payments, email delivery, and
          translation. Those sites and services have their own terms and privacy practices; we do not
          control them and are not responsible for their content or conduct.{" "}
          <ChromeLink href="/privacy#providers">Service providers</ChromeLink> in our Privacy Policy lists the
          providers we use.
        </p>
        <p>
          Deal descriptions may be machine-translated into French and Spanish. Translations are
          provided for convenience, may be imperfect, and the English source text prevails where they
          differ.
        </p>

        <h2 id="disclaimers">14. Disclaimers</h2>
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind. To the maximum extent permitted by law, we disclaim all implied
          warranties, including merchantability, fitness for a particular purpose, non-infringement,
          accuracy, and uninterrupted or error-free operation. We do not warrant that listings are
          accurate, complete, or current, that alerts will be delivered on time or at all, or that
          defects will be corrected. Some jurisdictions do not allow the exclusion of certain
          warranties, so parts of this section may not apply to you.
        </p>

        <h2 id="liability">15. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Radar and the site operator are not liable for
          indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost
          profits, wasted travel, or loss of data, arising from or related to your use of the service
          or any restaurant offer, even if we have been advised of the possibility.
        </p>
        <p>
          To the maximum extent permitted by law, our total aggregate liability for all claims
          relating to the service is limited to the greater of the amount you paid us in the twelve
          months before the event giving rise to the claim, or twenty Canadian dollars (CAD 20).
          Nothing in these terms limits liability that cannot be limited by law, including for fraud
          or for death or personal injury caused by negligence.
        </p>
        <p>
          If you are a consumer in Quebec, the exclusions and limits in sections 14 and 15 do not
          apply to the extent the Consumer Protection Act prohibits them, and nothing in these terms
          limits our liability for our own acts or those of our representatives. Consumers in other
          provinces, territories and states keep any rights their local consumer protection law gives
          them that cannot be waived.
        </p>

        <h2 id="indemnity">16. Indemnity</h2>
        <p>
          You agree to indemnify and hold harmless the site operator from claims, damages, and
          reasonable costs arising from your breach of these terms, your misuse of the service, or
          content you submitted — except to the extent the claim results from our own conduct.
        </p>

        <h2 id="changes">17. Changes to the service and these terms</h2>
        <p>
          We may add, change, or discontinue features, and we may update these terms as the service
          evolves or the law requires. The &ldquo;last updated&rdquo; date at the top of this page
          identifies the current version. If we make a material change to these terms, we will email
          you at least 30 days before it takes effect, showing the new wording, the wording it
          replaces, and the date it applies. If you do not accept the change, you may cancel your
          subscription before that date at no cost, and we will refund any prepaid period you have
          not used. We will not use this section to change the nature of the service you subscribed
          to.
        </p>

        <h2 id="termination">18. Termination</h2>
        <p>
          You may stop using Radar at any time, cancel a subscription (from your dashboard, or
          through Apple for one bought in the iOS app), and request deletion of your account data as described in{" "}
          <ChromeLink href="/privacy#rights">Your rights and choices</ChromeLink>. We may suspend or terminate
          access to protect users, comply with law, or prevent misuse. Sections that by their nature
          should survive termination — including the submissions license, intellectual property,
          disclaimers, limitation of liability, indemnity, and this section — continue to apply
          afterwards.
        </p>

        <h2 id="general">19. General</h2>
        <p>
          These terms, together with the Privacy Policy and any additional terms you accept for a
          specific feature, are the entire agreement between you and us about the service. If a
          provision is found unenforceable, the rest stays in force and the unenforceable part is
          applied as closely as possible to its original intent. Our failure to enforce a provision
          is not a waiver of it. You may not assign these terms without our consent; we may assign
          them as part of a merger, acquisition, or sale of assets. Headings are for convenience
          only.
        </p>
        <p>
          Before starting a formal dispute, please contact us at{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> so we can try to resolve it
          directly — most issues are settled that way quickly.
        </p>
        <p>
          <strong>Governing law.</strong> These terms are governed by the laws of Ontario and the
          federal laws of Canada that apply there. If you are a consumer, this does not take away the
          protection of the mandatory consumer laws of the province, territory or state where you
          live, and you may bring a claim in the courts where you live. Nothing in these terms
          requires arbitration or waives your right to take part in a class action.
        </p>
        <p>
          <strong>Language.</strong> These terms are available in French and in English, and you may
          read and accept them in either. If you live in Quebec and choose the English version, you do
          so at your express wish. <span lang="fr">Les présentes conditions sont disponibles en
          français et en anglais.</span>
        </p>

        <h2 id="contact">20. Contact</h2>
        <p>
          Questions about these terms, listing corrections, account issues, privacy questions
          and data requests all go to{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
        </p>
      </article>
    </PublicPage>
  );
}

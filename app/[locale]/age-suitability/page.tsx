import { setRequestLocale } from "next-intl/server";
import { englishOnlyAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import ChromeLink from "../../ChromeLink";
import PublicPage from "../../PublicPage";
import LegalToc from "../LegalToc";

export const metadata = pageMetadata({
  alternates: englishOnlyAlternates("/age-suitability"),
  title: "Age Suitability — Radar",
  description:
    "How Radar handles alcohol references: the control that withholds drink deals, what it covers, how it is enforced, and why the app is rated for ages 13 and up.",
});

// Written for an app store reviewer as much as for a parent, and so it describes mechanism rather
// than intent. The 13+ rating rests on a control, and a claim about a control is worth only as
// much as the description of what the control actually does. Everything below is implemented in
// app/alcohol.ts (what counts as a drink reference), app/api/deals (where the filter is applied
// and why the counts agree with it), and mobile/lib/audience.ts (how the answer is kept).
//
// Legal and policy prose ships English-only in every locale, matching the other documents here,
// and the article carries lang="en" to say so.
//
// Every figure below is a dated snapshot (1 October 2026, after the Shenandoah Valley seed) and is phrased in
// the past tense. The home page prints a live count of restaurants and cities, and section 8 once
// said "the 38 cities it covers" in the present tense beside a hero that said 52: two sizes for one
// catalog, each claiming to be current. The 38 was the place picker counting only the city each card
// leads with; it now counts every city a card has an offer in, the same count as the hero's. Dated,
// the snapshot can age without contradicting the live figure. The proportions are part of what was
// told to Apple; do not change them without re-measuring (see app/alcohol.ts and the listing
// document).
const SECTIONS = [
  ["summary", "1. Summary"],
  ["what", "2. What Radar is"],
  ["why", "3. Why the question arises"],
  ["control", "4. The control"],
  ["unanswered", "5. What happens before anyone answers"],
  ["withheld", "6. What the control withholds"],
  ["enforced", "7. How the filter is enforced"],
  ["experience", "8. What a filtered app looks like"],
  ["rating", "9. Age rating"],
  ["contact", "10. Contact"],
] as const;

export default async function AgeSuitability({ params }: { params: Promise<{ locale: string }> }) {
  // The page's links to its sibling pages are ChromeLinks (app/ChromeLink.tsx): for a reader
  // without a session cookie, a page load the Worker answers without rendering; for one with it, a
  // client-side navigation, since that reader's pages are rendered either way and a flight is the
  // cheaper render. Never a prefetching <Link>: each of those was prefetched as it scrolled into
  // view, a render of the page it named.
  setRequestLocale((await params).locale);
  return (
    <PublicPage className="legal">
      <article lang="en">
        <span className="kicker">AGE SUITABILITY</span>
        <h1>Alcohol references and the control that hides them</h1>
        <p className="lead">
          Radar lists restaurant offers, and a large share of those offers are happy hours. The app
          ships with a control that withholds every listing referencing alcohol, and that control is
          the reason Radar is rated for ages 13 and up rather than 18 and up. This page describes
          what the control does, precisely enough to be checked.
        </p>

        <LegalToc sections={SECTIONS} />

        <h2 id="summary">1. Summary</h2>
        <p>
          Drink deals are hidden until somebody states they are of legal drinking age. Nobody sees
          them before answering, the answer can be reversed at any time, and every way the question
          can fail — a fresh install, unreadable storage, an answer lost with the last launch —
          fails toward hiding. A person using Radar with the control in place is shown a food-only
          catalog and does not encounter the drinks side of the product.
        </p>

        <h2 id="what">2. What Radar is</h2>
        <p>
          Radar is a listings app. It shows discounts and specials that restaurants are running
          nearby, with the time and the terms attached, and links out to the restaurant. It does not
          sell anything that is listed, does not process orders, does not deliver, and has no
          shopping cart. A listing that mentions a drink is an advertisement for a restaurant
          promotion, not a way to obtain one.
        </p>

        <h2 id="why">3. Why the question arises</h2>
        <p>
          On 1 October 2026, 155 of the 601 listings in the catalog referenced alcohol, 133 of
          them happy hours, and about a third of the restaurants on the main list (73 of 212)
          had nothing else to show. That is a consequence of the subject matter rather than an editorial
          choice: happy hour is one of the most common forms a restaurant discount takes, and a
          happy hour is a discount on a bar menu. An app carrying that many references, with no
          control over them, describes itself honestly as frequent rather than infrequent.
        </p>
        <p>
          The control exists so that the frequency is a property of one audience rather than of the
          app. It is a real filter over the data, not a label.
        </p>

        <h2 id="control">4. The control</h2>
        <p>
          <strong>It is asked before anything is shown.</strong> On first launch the app presents
          the question ahead of the listings screen. The listings screen is not mounted, does not
          request anything, and does not paint underneath the question.
        </p>
        <p>
          <strong>It is reversible.</strong> An adult who turned drink deals on can turn them off
          again at any time from the account screen, and the same switch is what a parent would use.
          Turning it off takes effect immediately rather than at the next launch: listings already
          held for offline use are keyed to the audience that requested them, so none of them can be
          handed back to the other audience.
        </p>
        <p>
          <strong>It stays on the device.</strong> The answer is kept on the handset. It is never
          attached to a Radar account, never synchronised between devices, and never sent to our
          servers. A phone handed to a child is a different audience from the adult who owns the
          account, and an account-level flag would follow the adult&rsquo;s answer onto the
          child&rsquo;s handset. It is also the one preference in the app that says something about
          a person&rsquo;s age, and Radar has no reason to hold that.
        </p>

        <h2 id="unanswered">5. What happens before anyone answers</h2>
        <p>
          The unanswered state hides. That is true on the very first frame, before stored settings
          have been read; it is true if reading them fails; and it is true if the answer was lost,
          in which case the question is asked again and drinks stay hidden until it is. There is no
          path through the app in which an unanswered user is shown a drink listing, including the
          moments when something has gone wrong.
        </p>

        <h2 id="withheld">6. What the control withholds</h2>
        <p>With the control in place, a listing is withheld if any of the following is true.</p>
        <ul>
          <li>
            Its category is a happy hour. This is treated as a drink reference categorically rather
            than by wording, because a happy hour that names no specific drink is still advertising
            a discounted bar menu.
          </li>
          <li>
            Any text a reader can see on the listing names a drink, or the vocabulary bars use to
            sell them: the restaurant&rsquo;s name, the title, price, description, schedule, terms
            or restrictions. A drink counts whether it is named by kind or by brand — a pint, a
            Caesar, a tall can, a Corona, a Jameson.
          </li>
          <li>
            The venue is a kind of place that exists to serve alcohol — a bar, pub, brewery,
            taproom, winery, distillery, tavern or similar — and the listing does not name food
            outright. Even when it does, the words &ldquo;drink&rdquo; and &ldquo;beverage&rdquo;
            count as alcohol at such a place, so a taproom&rsquo;s &ldquo;15% off food &amp;
            drinks&rdquo; is withheld.
          </li>
        </ul>
        <p>
          A restaurant that runs several offers — a chain&rsquo;s branches, or a pub with a
          different special each night — appears as one card. With the control in place each offer
          on the card is judged on its own, the ones that reference alcohol are taken off it, and
          the card is shown only if food remains. A pub&rsquo;s wing night can appear; its happy
          hour cannot appear beside it.
        </p>
        <p>
          These rules are deliberately over-eager. A false positive hides a wing special from
          somebody who would have enjoyed it; a false negative shows a cocktail listing to a
          thirteen-year-old in an app that said it would not. Those costs are not symmetric, so
          every rule errs toward hiding.
        </p>
        <p>
          The few exceptions run the other way, so each is a whole phrase rather than a word: food
          and soft drinks named after a drink (a shrimp cocktail, a Caesar salad, a Scotch egg,
          root beer, cold brew), places named after a brand (Budweiser Gardens), fine print that
          excludes alcohol from an offer (&ldquo;not valid on alcohol&rdquo;), and, at a bar, a
          drink that is only a condition of a food offer (&ldquo;half-price wings with beverage
          purchase&rdquo;). A drink named anywhere else on the same listing still withholds it.
        </p>

        <h2 id="enforced">7. How the filter is enforced</h2>
        <p>
          <strong>On the server, not in the interface.</strong> The withheld listings are removed
          before the response is assembled. They are not sent to the device and hidden there.
        </p>
        <p>
          <strong>Counts and filters agree with it.</strong> Result totals, city lists and category
          filters are computed after the listings are withheld, so a hidden listing is not counted
          in a total and does not leave its category offered in a filter that would return nothing.
        </p>
        <p>
          <strong>A direct link cannot reach one.</strong> Opening a link to a withheld listing —
          from a message, a search result, or something saved before the control was switched on —
          returns not found rather than the listing.
        </p>
        <p>
          <strong>No screen has to remember.</strong> The filter is attached by the single function
          that makes listing requests, rather than by each screen passing a flag. A screen written
          tomorrow inherits it without anyone having to think about it.
        </p>

        <h2 id="experience">8. What a filtered app looks like</h2>
        <p>
          It is a noticeably smaller app. On the date in section 3, a third of the restaurants on
          the main list were withheld outright, and nine of the 66 cities those restaurants were
          listed in had no food-only listings at all. A city in that position is not offered in the
          place picker, and its listing count is not shown. What remains is a food deals app:
          two-for-one tacos, half-price wings, a lunch special, buck-a-shuck.
        </p>

        <h2 id="rating">9. Age rating</h2>
        <p>
          Radar is rated for ages 13 and up. The rating reflects what a user with the app&rsquo;s
          controls in place encounters, which is the food-only catalog described above. Radar does
          not sell alcohol, take payment for it, arrange its delivery, or verify anyone&rsquo;s
          identity or age beyond the in-app question described here; it is a listings app pointing
          at restaurants, and the legal responsibility for serving rests with those restaurants.
        </p>

        <h2 id="contact">10. Contact</h2>
        <p>
          Questions about this page, or about anything described on it:{" "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>. See also our{" "}
          <ChromeLink href="/terms">Terms of Service</ChromeLink> and{" "}
          <ChromeLink href="/privacy">Privacy Policy</ChromeLink>.
        </p>
      </article>
    </PublicPage>
  );
}

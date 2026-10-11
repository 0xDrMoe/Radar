"use client";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import ChromeLink from "../../../ChromeLink";
import { availabilityFromSchedule } from "../../../search";

export interface AlsoHereOffer {
  id: string;
  slug: string | null;
  title: string;
  price: string;
  schedule: string;
  emoji: string | null;
}

const subscribeToNothing = () => () => {};

// The rest of the week at this address, with whatever runs today marked.
//
// Deal pages are prerendered once per deploy, so the server cannot say which night is tonight: the
// HTML would carry the build day's answer for as long as the build lived, and on every other day
// it would point at the wrong night. So the list renders unmarked - for the server pass, the
// hydrating first client pass, and anyone without JavaScript - and the browser marks today once it
// has hydrated, the same two-pass arrangement LocalTime uses.
//
// "Today" is the venue's day, not the reader's: someone in Vancouver at 10pm looking at an Ottawa
// bar wants to know what is on in Ottawa, where it is already tomorrow. Every offer that runs
// today is marked, not just the first, so a daily happy hour alongside a nightly special is marked
// every day - which is true.
//
// Each link is a ChromeLink (app/ChromeLink.tsx), as the "Similar offers" links are, which writes
// the page's own locale in: a bare /deals/<slug> was a 307 through the middleware to whichever
// locale the visitor's cookie named - for a crawler with no cookie, from a French page to the
// English one. A page load of the baked deal page for a reader without a session cookie, a
// client-side navigation for one with it.
export default function AlsoHere({ offers, timezone }: { offers: AlsoHereOffer[]; timezone: string | null }) {
  const t = useTranslations("dealDetail");
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const now = hydrated ? new Date() : null;
  return (
    <section className="also-here-section">
      <h2>{t("alsoHere")}</h2>
      <div className="also-here">
        {offers.map((offer) => {
          const today = !!now && availabilityFromSchedule(offer.schedule, now, timezone).eligibleToday;
          return (
            <ChromeLink key={offer.id} className={today ? "today" : undefined} href={`/deals/${encodeURIComponent(offer.slug || offer.id)}`}>
              <span className="also-here-emoji" aria-hidden="true">{offer.emoji || "\u{1F37D}\u{FE0F}"}</span>
              <b>{offer.schedule}{today && <em className="also-here-today">{t("alsoHereToday")}</em>}</b>
              <small>{offer.title}</small>
              <small className="also-here-price">{offer.price}</small>
            </ChromeLink>
          );
        })}
      </div>
    </section>
  );
}

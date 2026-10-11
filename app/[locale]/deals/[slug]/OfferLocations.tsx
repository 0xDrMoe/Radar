"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import BranchPicker from "../../../BranchPicker";
import { BRANCH_SEARCH_MIN, type BranchOption } from "../../../branch-search";
import DealMap from "./DealMap";
import { POSTAL_STORAGE_KEY } from "../../../return-path";
import { dateFormatLocale, parseSqlTimestamp, type BranchConfirmation } from "../../../verification";
import { dateFormatter } from "../../../formatters";

export interface OfferLocationOption {
  id: string;
  address: string;
  city: string;
  region: string | null;
  phone: string | null;
  official_url: string | null;
  // What the branch line says, worked out by the page from the deal's checks (branchConfirmation in
  // app/verification.ts). Its timestamp is formatted here, in the location's own timezone
  // (branchDate).
  confirmation: BranchConfirmation;
  latitude: number | null;
  longitude: number | null;
  /** The coordinate is only the city's centre (geo_precision 'city'): drawn as an area, not a pin. */
  approximate: boolean;
  timezone: string;
  distance_km: number | null;
}

// A picker over every linked location (closest first when we know where the visitor is searching
// from) instead of a long stacked list — the detail card and the map below both follow whichever
// option is selected, reusing the same card markup/CSS the old flat list used.
//
// The date is the location's own calendar day, not the reader's. Formatting it in whatever zone the
// code runs in gave the server (UTC) one day and a browser west of it the day before for anything
// confirmed in the evening, and that disagreement is a hydration error (React #418) on the page.
function branchDate(value: string | null, locale: string, timeZone: string) {
  if (!value) return "";
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return "";
  const options = { month: "short", day: "numeric", year: "numeric", timeZone } as const;
  return dateFormatter(`confirmed:${locale}:${timeZone}`, dateFormatLocale(locale), options).format(date);
}

const distanceLabel = (km: number | null) => (km == null ? "" : `${km < 1 ? "<1" : Math.round(km)} km`);

/** Which of the three location states this page is in. See locationScope in page.tsx. */
export interface OfferLocationScope {
  kind: "narrowed" | "elsewhere" | "open";
  /** The state or province the list was narrowed to, when it was. */
  region: string | null;
  postal: string | null;
  /**
   * How many this offer has across every region. Null for a brand-wide offer scoped to one state:
   * counting a national brand's branches reads every one of them, so the page counts the state.
   */
  total: number | null;
  /** How many in the region the list was narrowed to, when that is what was counted. */
  regionTotal: number | null;
  /** True when the list in hand is a page of a longer one — a national chain, capped. */
  capped: boolean;
  showAllHref: string | null;
  /**
   * True when the reader typed a postal or ZIP code this page could not place. The list is every
   * location, as it is for a reader who typed nothing, and the page says why instead of handing
   * back the same prompt they just answered.
   */
  unplaced?: boolean;
}

export default function OfferLocations({
  locations, scope, formAction, returnParam,
}: {
  locations: OfferLocationOption[];
  scope: OfferLocationScope;
  /** This page's own path, so the postal form submits back to it. */
  formAction: string;
  /** Carried through the form so narrowing the list does not lose the reader's way back. */
  returnParam: string | null;
}) {
  const t = useTranslations("offerLocations"), locale = useLocale();
  const [selectedId, setSelectedId] = useState(locations[0]?.id || "");
  const selected = locations.find((l) => l.id === selectedId) || locations[0];
  const branchOptions = useMemo<BranchOption[]>(
    () => locations.map((l) => ({ value: l.id, label: `${l.address}, ${l.city}`, hint: distanceLabel(l.distance_km) || undefined })),
    [locations],
  );
  // The postal or ZIP code the reader searched the homepage with, offered in the form rather than
  // applied (see POSTAL_STORAGE_KEY). Filled after mount, so the prerendered HTML and the first
  // client render agree.
  const postalInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = postalInput.current;
    if (!input || input.value) return;
    try {
      const stored = sessionStorage.getItem(POSTAL_STORAGE_KEY);
      if (stored && /^(?:[A-Z]\d[A-Z]\d[A-Z]\d|\d{5}(?:\d{4})?)$/.test(stored)) input.value = stored;
    } catch {
      // Storage refused: the field starts empty, as it always did.
    }
  }, []);
  if (!selected) return <p>{t("noLocations")}</p>;
  // "Confirmed" only with the date of a check that covered this branch; "Listed" with the date it
  // was marked when none did - an import's timestamp is not a check.
  const { state, at } = selected.confirmation;
  const confirmed = state === "confirmed";
  const status = confirmed ? t("confirmedOn", { date: branchDate(at, locale, selected.timezone) })
    : state === "listed" && at ? t("listedOn", { date: branchDate(at, locale, selected.timezone) })
    : t(state === "lapsed" ? "notRecentlyConfirmed" : "notConfirmed");
  const sortedByDistance = locations.some((l) => l.distance_km != null);
  const caption = t("locationsCount", { count: locations.length });
  const note = sortedByDistance ? t("closestFirst") : undefined;
  return (
    <div className="offer-locations">
      {/* What list this is. A reader who has narrowed to their own state needs to know the number
          they narrowed from, or a short list reads as poor coverage rather than a filter working. */}
      {scope.kind === "narrowed" && (
        <p className="offer-locations-scope">
          {/* Capped and scoped is the one combination where the grand total must not be named. "3 of
              9 locations — AB" reads as nine in Alberta, and the truth is five. The number of
              locations in this one region was never counted, so nothing here claims it. */}
          {scope.capped
            ? scope.regionTotal != null
              ? t("narrowedCappedOf", { count: locations.length, region: scope.region ?? "", total: scope.regionTotal })
              : t("narrowedCapped", { count: locations.length, region: scope.region ?? "" })
            : scope.total != null
              ? t("narrowedTo", { count: locations.length, region: scope.region ?? "", total: scope.total })
              : t("narrowedAll", { count: locations.length, region: scope.region ?? "" })}
          {scope.showAllHref && (scope.total == null || scope.total > locations.length)
            ? <> <a href={scope.showAllHref}>{scope.total != null ? t("showAll", { total: scope.total }) : t("showAllUnknown")}</a></>
            : null}
        </p>
      )}
      {scope.kind === "elsewhere" && (
        <p className="offer-locations-scope">{t(scope.capped ? "noneInRegionCapped" : "noneInRegion", { region: scope.region ?? "", count: locations.length })}</p>
      )}
      {/* The prompt, on the page every shared link and every prerendered copy serves: nobody has
          said where they are, so this is every location there is. A plain GET form rather than an
          input wired to a router push — it is the one control on this page that has to work on the
          static copy, before any JavaScript has run. */}
      {scope.kind === "open" && scope.unplaced && locations.length > 1 && (
        <p className="offer-locations-scope" role="status">{t("postalUnplaced")}</p>
      )}
      {scope.kind === "open" && locations.length > 1 && (
        <form className="offer-locations-postal" method="get" action={formAction}>
          {returnParam && <input type="hidden" name="return" value={returnParam} />}
          <label>
            <span>{scope.capped
              ? scope.total != null
                ? t("postalPromptCapped", { count: locations.length, total: scope.total })
                : t("postalPromptFirst", { count: locations.length })
              : t("postalPrompt", { count: locations.length })}</span>
            <input ref={postalInput} name="postal" autoComplete="postal-code" inputMode="text" maxLength={10}
              placeholder={t("postalPlaceholder")} aria-label={t("postalLabel")} />
          </label>
          <button type="submit">{t("postalSubmit")}</button>
        </form>
      )}
      {/* A national promotion confirmed at every branch of a large chain reaches 120 of these, and
          a select that long can only be scrolled. Short lists keep the native control: it is one
          tap to the system picker on a phone, which a text filter is not. */}
      {locations.length >= BRANCH_SEARCH_MIN ? (
        <BranchPicker options={branchOptions} value={selectedId} onChange={setSelectedId} caption={caption} note={note} />
      ) : locations.length > 1 ? (
        <label className="offer-locations-select">
          <span>{caption}{note}</span>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.address}, {l.city}
                {l.distance_km != null ? ` — ${distanceLabel(l.distance_km)}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="deal-location-list">
        <article className={confirmed ? "confirmed" : "unconfirmed"}>
          <div>
            <b>{selected.address}</b>
            <span>{selected.city}{selected.region ? `, ${selected.region}` : ""}</span>
            <small>{status}</small>
          </div>
          <div>
            {selected.phone && <a href={`tel:${selected.phone}`}>{t("call")}</a>}
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.address}, ${selected.city}`)}`} target="_blank" rel="noreferrer">{t("directions")}</a>
            {selected.official_url && <a href={selected.official_url} target="_blank" rel="noreferrer">{t("locationPage")}</a>}
          </div>
        </article>
      </div>
      {/* The map belongs to the selected branch, so it lives here rather than beside this component
          on the page. It used to be rendered by page.tsx against the first location that happened to
          carry coordinates, which meant choosing a branch moved the address, the phone number and
          the Directions link while the pin stayed where it was.
          Nothing is drawn when the chosen branch has no coordinates. That loses a map the old code
          would have shown from some other branch — which is the point: a pin on the wrong street is
          a specific, checkable falsehood, and no pin is only missing information. */}
      {selected.latitude != null && selected.longitude != null && (
        <DealMap
          latitude={selected.latitude}
          longitude={selected.longitude}
          label={`${selected.address}, ${selected.city}`}
          approximateNote={selected.approximate ? t("approximateMap") : null}
        />
      )}
    </div>
  );
}

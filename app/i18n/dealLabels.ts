// Fixed-vocabulary labels computed by app/search.ts and app/verification.ts (availability
// status, verification status, price tier, end-date phrasing). These are plain utility
// functions called from a route handler (app/api/deals/route.ts), not React components, so they
// take a `locale` argument and look up here directly rather than going through next-intl's
// React-context-bound hooks. Deal CONTENT (title/description/etc.) is translated by the AI
// pipeline in app/translation.ts instead — this file is only for small, enumerable status text.
export type SupportedLocale = "en" | "fr" | "es";

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value === "en" || value === "fr" || value === "es";
}

type Labels = {
  availableNow: (schedule: string) => string;
  laterToday: (schedule: string) => string;
  endedForToday: string;
  seeSchedule: string;
  availableToday: string;
  offerEnded: string;
  nextAvailable: (day: string) => string;
  scheduleUnavailable: string;
  weekdayNames: string[];
  clock: (hours: number, minutes: number) => string;
  until: (time: string) => string;
  checked: string;
  reChecking: string;
  // A deal nobody has checked yet: when it was listed, rather than a "Re-checking" it never had.
  listed: (date: string) => string;
  // The card tag for an offer on tonight - see `tonight` in app/api/deals/route.ts.
  tonight: string;
  sponsored: string;
  priceTiers: string[];
  recentlyEnded: string;
  endsToday: string;
  endsTomorrow: string;
  endsInDays: (days: number) => string;
};

const en: Labels = {
  availableNow: (schedule) => `Available now · ${schedule}`,
  laterToday: (schedule) => `Later today · ${schedule}`,
  endedForToday: "Ended for today",
  seeSchedule: "See schedule",
  availableToday: "Available today",
  offerEnded: "Offer ended",
  nextAvailable: (day) => `Next available ${day}`,
  scheduleUnavailable: "Schedule unavailable",
  weekdayNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  clock: (hours, minutes) => `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours % 24 < 12 ? "AM" : "PM"}`,
  until: (time) => `until ${time}`,
  checked: "Checked",
  reChecking: "Re-checking",
  listed: (date) => `Listed ${date}`,
  tonight: "Tonight",
  sponsored: "Sponsored",
  priceTiers: ["Budget", "Mid-range", "Upscale"],
  recentlyEnded: "Recently ended",
  endsToday: "Ends today",
  endsTomorrow: "Ends tomorrow",
  endsInDays: (days) => `Ends in ${days} days`,
};

const fr: Labels = {
  availableNow: (schedule) => `Disponible maintenant · ${schedule}`,
  laterToday: (schedule) => `Plus tard aujourd'hui · ${schedule}`,
  endedForToday: "Terminé pour aujourd'hui",
  seeSchedule: "Voir l'horaire",
  availableToday: "Disponible aujourd'hui",
  offerEnded: "Offre terminée",
  nextAvailable: (day) => `Prochaine disponibilité ${day}`,
  scheduleUnavailable: "Horaire non disponible",
  weekdayNames: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  clock: (hours, minutes) => `${hours % 24} h${minutes ? ` ${String(minutes).padStart(2, "0")}` : ""}`,
  until: (time) => `jusqu'à ${time}`,
  checked: "Vérifié",
  reChecking: "Nouvelle vérification",
  listed: (date) => `Ajoutée le ${date}`,
  tonight: "Ce soir",
  sponsored: "Commandité",
  priceTiers: ["Économique", "Gamme moyenne", "Haut de gamme"],
  recentlyEnded: "Terminée récemment",
  endsToday: "Se termine aujourd'hui",
  endsTomorrow: "Se termine demain",
  endsInDays: (days) => `Se termine dans ${days} jours`,
};

const es: Labels = {
  availableNow: (schedule) => `Disponible ahora · ${schedule}`,
  laterToday: (schedule) => `Más tarde hoy · ${schedule}`,
  endedForToday: "Terminado por hoy",
  seeSchedule: "Ver horario",
  availableToday: "Disponible hoy",
  offerEnded: "Oferta finalizada",
  nextAvailable: (day) => `Próxima disponibilidad ${day}`,
  scheduleUnavailable: "Horario no disponible",
  weekdayNames: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  clock: (hours, minutes) => `${hours % 24}:${String(minutes).padStart(2, "0")}`,
  until: (time) => `${time.startsWith("1:") ? "hasta la" : "hasta las"} ${time}`,
  checked: "Verificado",
  reChecking: "Reverificando",
  listed: (date) => `Añadida el ${date}`,
  tonight: "Esta noche",
  sponsored: "Patrocinado",
  priceTiers: ["Económico", "Gama media", "Alta gama"],
  recentlyEnded: "Finalizada recientemente",
  endsToday: "Termina hoy",
  endsTomorrow: "Termina mañana",
  endsInDays: (days) => `Termina en ${days} días`,
};

const dictionaries: Record<SupportedLocale, Labels> = { en, fr, es };

export function dealLabels(locale: string): Labels {
  return dictionaries[isSupportedLocale(locale) ? locale : "en"];
}

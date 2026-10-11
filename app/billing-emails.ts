// The subscription notices the law asks Radar to send, in the reader's own language.
//
//   purchase       the acknowledgment after checkout: the terms, how it renews, how to cancel
//   trial ending   2 to 10 days before a free trial converts, with the date and the price
//                  (Quebec's Bill 10; Stripe sends trial_will_end three days ahead)
//   renewal        before a yearly plan renews (California's AB 2863 and the other states with
//                  annual-renewal notice windows)
//   pause ending   before a paused subscription starts billing again
//   annual         once a year to a monthly subscriber (California, Connecticut and Minnesota
//                  require a yearly reminder of every auto-renewing plan, not only yearly ones)
//
// All four are transactional: they are about money the reader has agreed to pay, so they go out
// whatever the reader's marketing preferences are and carry no List-Unsubscribe header. Stripe's
// own renewal and trial emails stay switched off, so these are the only ones a customer gets.
//
// Pure on purpose: nothing here imports the Worker runtime, so the tests can render every notice in
// every language and check the date and the price are really in it.

export const EMAIL_LOCALES = ["en", "fr", "es"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];
export type RenewalInterval = "month" | "year";

/** An amount in the currency's minor units, as Stripe reports it. */
export interface Money { amount: number; currency: string }

/** "fr", "fr-CA" and "FR" all mean French; anything unrecognised means English. */
export function emailLocale(value: unknown): EmailLocale {
  const language = typeof value === "string" ? value.trim().slice(0, 2).toLowerCase() : "";
  return (EMAIL_LOCALES as readonly string[]).includes(language) ? (language as EmailLocale) : "en";
}

// Radar sells in Canada and the US, so the regional form of each language: "9,99 $" in Quebec,
// "US$" spelled out where a dollar sign alone would be ambiguous.
const INTL_LOCALE: Record<EmailLocale, string> = { en: "en-CA", fr: "fr-CA", es: "es-US" };

// Stripe's zero-decimal currencies, whose minor unit is the whole unit. Radar charges in CAD and
// USD today; these are here so a price added in yen is not shown a hundred times too small.
const ZERO_DECIMAL = new Set(["bif","clp","djf","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"]);

export function formatMoney(money: Money, locale: EmailLocale) {
  const currency = money.currency.toUpperCase();
  const units = ZERO_DECIMAL.has(money.currency.toLowerCase()) ? money.amount : money.amount / 100;
  try {
    return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(units);
  } catch {
    return `${units.toFixed(2)} ${currency}`;
  }
}

/** A Unix timestamp as a long date in the reader's own timezone, falling back to UTC. */
export function formatDate(unixSeconds: number, locale: EmailLocale, timezone: string | null) {
  const date = new Date(unixSeconds * 1000);
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "long", timeZone: timezone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "long", timeZone: "UTC" }).format(date);
  }
}

// ── Reading Stripe's objects ─────────────────────────────────────────────────────────────────────

interface StripePriceLike { unit_amount?: number | null; currency?: string; recurring?: { interval?: string } | null }
export interface StripeSubscriptionLike {
  id?: string;
  status?: string;
  currency?: string;
  trial_end?: number | null;
  /** Top-level before Stripe's 2025-03-31 API version, on each item after it. Both are read. */
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
  pause_collection?: { resumes_at?: number | null } | null;
  items?: { data?: Array<{ price?: StripePriceLike | null; plan?: { interval?: string } | null; quantity?: number; current_period_end?: number }> };
}

export interface SubscriptionTerms {
  interval: RenewalInterval;
  /** The list price per period, or null when it cannot be read reliably from the subscription. */
  price: Money | null;
  trialEnd: number | null;
  periodEnd: number | null;
  locale: EmailLocale;
  endsAtPeriodEnd: boolean;
}

/**
 * What a subscription will charge and when, read off the object itself.
 *
 * The price is left out rather than guessed when the item's currency is not the subscription's:
 * a multi-currency price reports its base amount on `unit_amount`, so a Canadian subscriber on a
 * US-dollar base price would be quoted the wrong figure in the wrong currency. Callers prefer
 * Stripe's preview of the next invoice anyway, which also counts discounts; this is the fallback.
 */
export function subscriptionTerms(subscription: StripeSubscriptionLike): SubscriptionTerms {
  const item = subscription.items?.data?.[0];
  const interval: RenewalInterval = (item?.price?.recurring?.interval || item?.plan?.interval) === "year" ? "year" : "month";
  const unit = item?.price?.unit_amount;
  const priceCurrency = item?.price?.currency?.toLowerCase();
  const currency = subscription.currency?.toLowerCase() || priceCurrency;
  const price = typeof unit === "number" && priceCurrency && priceCurrency === currency
    ? { amount: unit * Math.max(1, item?.quantity ?? 1), currency: priceCurrency }
    : null;
  return {
    interval,
    price,
    trialEnd: subscription.status === "trialing" && subscription.trial_end ? subscription.trial_end : null,
    periodEnd: subscription.current_period_end ?? item?.current_period_end ?? null,
    locale: emailLocale(subscription.metadata?.locale),
    endsAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
  };
}

// ── Copy ─────────────────────────────────────────────────────────────────────────────────────────
//
// French and Spanish are Radar's own translations, reviewed by nobody yet; the English is the
// reference. A sentence added here has to be added in all three, which the tests check by
// rendering each notice in each language.

interface Copy {
  kicker: string;
  hello: (name: string | null) => string;
  perInterval: (price: string, interval: RenewalInterval) => string;
  everyInterval: (interval: RenewalInterval) => string;
  unknownPrice: string;
  manage: string;
  reviewOrCancel: string;
  footer: string;
  keep: string;
  facts: { plan: string; price: string; nextRenewal: string; trialEnds: string; then: string; billedMonthly: string; billedYearly: string };
  purchase: { subject: string; title: string; intro: string; renews: (price: string, interval: RenewalInterval) => string };
  trialStarted: { subject: string; title: string; intro: string; converts: (date: string, price: string, interval: RenewalInterval) => string; heads: string };
  cancel: string;
  terms: (url: string) => string;
  annual: { subject: string; title: string; body: (price: string) => string; nextCharge: string };
  trialEnding: { subject: (date: string) => string; title: string; body: (date: string, price: string, interval: RenewalInterval) => string; choice: (date: string) => string };
  renewal: { subject: (date: string) => string; title: string; body: (date: string, price: string) => string; choice: (date: string) => string };
  pauseEnding: { subject: (date: string) => string; title: string; body: (date: string, price: string) => string; choice: (date: string) => string };
}

const COPY: Record<EmailLocale, Copy> = {
  en: {
    kicker: "Billing",
    hello: (name) => (name ? `Hi ${name},` : "Hi,"),
    perInterval: (price, interval) => `${price} per ${interval === "year" ? "year" : "month"}`,
    everyInterval: (interval) => (interval === "year" ? "every year" : "every month"),
    unknownPrice: "the price shown on your account page",
    manage: "Manage your subscription",
    reviewOrCancel: "Review or cancel",
    footer: "This is a billing notice about your Radar Pro subscription, so it is sent regardless of your email preferences.",
    keep: "Keep this email for your records.",
    facts: { plan: "Plan", price: "Price", nextRenewal: "Next renewal", trialEnds: "Free trial ends", then: "Then", billedMonthly: "Radar Pro, billed monthly", billedYearly: "Radar Pro, billed yearly" },
    purchase: {
      subject: "Your Radar Pro subscription is confirmed",
      title: "You're on Radar Pro",
      intro: "Thanks for subscribing. Here are the terms you agreed to, so you have them in writing.",
      renews: (price, interval) => `Your subscription renews automatically ${interval === "year" ? "every year" : "every month"} at ${price} until you cancel.`,
    },
    trialStarted: {
      subject: "Your Radar Pro free trial has started",
      title: "Your free trial has started",
      intro: "Thanks for trying Radar Pro. Here are the terms you agreed to, so you have them in writing.",
      converts: (date, price, interval) => `When the trial ends on ${date}, your card will be charged ${price}, and your subscription will renew automatically ${interval === "year" ? "every year" : "every month"} until you cancel. Cancel before ${date} and you won't be charged anything.`,
      heads: "We'll email you again a few days before the trial ends.",
    },
    cancel: "You can cancel anytime online from your account page. You keep Pro until the end of the period you've paid for, and you won't be charged again.",
    terms: (url) => `The full terms of your subscription are in Radar's Terms of Service: ${url}`,
    annual: {
      subject: "Your yearly Radar Pro reminder",
      title: "A yearly reminder about Radar Pro",
      body: (price) => `You've had Radar Pro for about a year. It renews automatically every month at ${price} until you cancel.`,
      nextCharge: "Next charge",
    },
    trialEnding: {
      subject: (date) => `Your Radar Pro free trial ends on ${date}`,
      title: "Your free trial ends soon",
      body: (date, price, interval) => `Your Radar Pro free trial ends on ${date}. Unless you cancel before then, your card will be charged ${price}, and your subscription will renew automatically ${interval === "year" ? "every year" : "every month"} until you cancel.`,
      choice: (date) => `To keep Pro, you don't need to do anything. If it isn't for you, cancel online from your account page before ${date} and you won't be charged.`,
    },
    renewal: {
      subject: (date) => `Your Radar Pro subscription renews on ${date}`,
      title: "Your yearly renewal is coming up",
      body: (date, price) => `Your Radar Pro subscription renews automatically on ${date}, and your card will be charged ${price} for another year.`,
      choice: (date) => `To keep Pro, you don't need to do anything. To stop the renewal, cancel online from your account page before ${date}. You keep Pro until then and won't be charged again.`,
    },
    pauseEnding: {
      subject: (date) => `Your Radar Pro pause ends on ${date}`,
      title: "Your pause ends soon",
      body: (date, price) => `Your Radar Pro subscription is paused until ${date}. On that date Pro turns back on, and billing continues at ${price} from your next renewal date after it.`,
      choice: (date) => `To pick Pro back up, you don't need to do anything. If you'd rather not continue, cancel online from your account page before ${date} and you won't be charged.`,
    },
  },
  fr: {
    kicker: "Facturation",
    hello: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    perInterval: (price, interval) => `${price} par ${interval === "year" ? "année" : "mois"}`,
    everyInterval: (interval) => (interval === "year" ? "chaque année" : "chaque mois"),
    unknownPrice: "le montant indiqué sur la page de votre compte",
    manage: "Gérer votre abonnement",
    reviewOrCancel: "Vérifier ou annuler",
    footer: "Ceci est un avis de facturation concernant votre abonnement Radar Pro. Il vous est envoyé quelles que soient vos préférences de courriel.",
    keep: "Conservez ce courriel pour vos dossiers.",
    facts: { plan: "Forfait", price: "Prix", nextRenewal: "Prochain renouvellement", trialEnds: "Fin de l'essai gratuit", then: "Ensuite", billedMonthly: "Radar Pro, facturé mensuellement", billedYearly: "Radar Pro, facturé annuellement" },
    purchase: {
      subject: "Votre abonnement Radar Pro est confirmé",
      title: "Bienvenue dans Radar Pro",
      intro: "Merci de vous être abonné. Voici les conditions que vous avez acceptées, pour que vous les ayez par écrit.",
      renews: (price, interval) => `Votre abonnement se renouvelle automatiquement ${interval === "year" ? "chaque année" : "chaque mois"}, pour ${price}, jusqu'à ce que vous l'annuliez.`,
    },
    trialStarted: {
      subject: "Votre essai gratuit de Radar Pro a commencé",
      title: "Votre essai gratuit a commencé",
      intro: "Merci d'essayer Radar Pro. Voici les conditions que vous avez acceptées, pour que vous les ayez par écrit.",
      converts: (date, price, interval) => `À la fin de l'essai, le ${date}, vous serez facturé ${price} et votre abonnement se renouvellera automatiquement ${interval === "year" ? "chaque année" : "chaque mois"} jusqu'à ce que vous l'annuliez. Annulez avant le ${date} et vous ne paierez rien.`,
      heads: "Nous vous écrirons de nouveau quelques jours avant la fin de l'essai.",
    },
    cancel: "Vous pouvez annuler en ligne en tout temps depuis la page de votre compte. Vous gardez Pro jusqu'à la fin de la période payée, et aucun autre montant ne sera prélevé.",
    terms: (url) => `Les conditions complètes de votre abonnement figurent dans les Conditions d'utilisation de Radar : ${url}`,
    annual: {
      subject: "Votre rappel annuel Radar Pro",
      title: "Un rappel annuel au sujet de Radar Pro",
      body: (price) => `Vous êtes abonné à Radar Pro depuis environ un an. L'abonnement se renouvelle automatiquement chaque mois, pour ${price}, jusqu'à ce que vous l'annuliez.`,
      nextCharge: "Prochain paiement",
    },
    trialEnding: {
      subject: (date) => `Votre essai gratuit de Radar Pro se termine le ${date}`,
      title: "Votre essai gratuit se termine bientôt",
      body: (date, price, interval) => `Votre essai gratuit de Radar Pro se termine le ${date}. À moins que vous n'annuliez d'ici là, vous serez facturé ${price} et votre abonnement se renouvellera automatiquement ${interval === "year" ? "chaque année" : "chaque mois"} jusqu'à ce que vous l'annuliez.`,
      choice: (date) => `Pour garder Pro, vous n'avez rien à faire. Si ce n'est pas pour vous, annulez en ligne depuis la page de votre compte avant le ${date} et vous ne paierez rien.`,
    },
    renewal: {
      subject: (date) => `Votre abonnement Radar Pro se renouvelle le ${date}`,
      title: "Votre renouvellement annuel approche",
      body: (date, price) => `Votre abonnement Radar Pro se renouvelle automatiquement le ${date}, et vous serez facturé ${price} pour une autre année.`,
      choice: (date) => `Pour garder Pro, vous n'avez rien à faire. Pour arrêter le renouvellement, annulez en ligne depuis la page de votre compte avant le ${date}. Vous gardez Pro jusqu'à cette date et aucun autre montant ne sera prélevé.`,
    },
    pauseEnding: {
      subject: (date) => `La pause de votre abonnement Radar Pro se termine le ${date}`,
      title: "Votre pause se termine bientôt",
      body: (date, price) => `Votre abonnement Radar Pro est en pause jusqu'au ${date}. À cette date, Pro sera réactivé, et la facturation reprendra à ${price} à votre prochaine date de renouvellement.`,
      choice: (date) => `Pour reprendre Pro, vous n'avez rien à faire. Si vous préférez ne pas continuer, annulez en ligne depuis la page de votre compte avant le ${date} et vous ne paierez rien.`,
    },
  },
  es: {
    kicker: "Facturación",
    hello: (name) => (name ? `Hola, ${name}:` : "Hola:"),
    perInterval: (price, interval) => `${price} al ${interval === "year" ? "año" : "mes"}`,
    everyInterval: (interval) => (interval === "year" ? "cada año" : "cada mes"),
    unknownPrice: "el precio que aparece en la página de tu cuenta",
    manage: "Administrar tu suscripción",
    reviewOrCancel: "Revisar o cancelar",
    footer: "Este es un aviso de facturación sobre tu suscripción a Radar Pro, por eso se envía independientemente de tus preferencias de correo.",
    keep: "Guarda este correo para tus registros.",
    facts: { plan: "Plan", price: "Precio", nextRenewal: "Próxima renovación", trialEnds: "Fin de la prueba gratuita", then: "Después", billedMonthly: "Radar Pro, facturación mensual", billedYearly: "Radar Pro, facturación anual" },
    purchase: {
      subject: "Tu suscripción a Radar Pro está confirmada",
      title: "Ya tienes Radar Pro",
      intro: "Gracias por suscribirte. Estas son las condiciones que aceptaste, para que las tengas por escrito.",
      renews: (price, interval) => `Tu suscripción se renueva automáticamente ${interval === "year" ? "cada año" : "cada mes"} por ${price} hasta que la canceles.`,
    },
    trialStarted: {
      subject: "Tu prueba gratuita de Radar Pro ha comenzado",
      title: "Tu prueba gratuita ha comenzado",
      intro: "Gracias por probar Radar Pro. Estas son las condiciones que aceptaste, para que las tengas por escrito.",
      converts: (date, price, interval) => `Cuando la prueba termine el ${date}, se cobrará ${price} a tu tarjeta y tu suscripción se renovará automáticamente ${interval === "year" ? "cada año" : "cada mes"} hasta que la canceles. Si cancelas antes del ${date}, no se te cobrará nada.`,
      heads: "Te escribiremos de nuevo unos días antes de que termine la prueba.",
    },
    cancel: "Puedes cancelar en línea en cualquier momento desde la página de tu cuenta. Conservas Pro hasta el final del período que pagaste y no se te volverá a cobrar.",
    terms: (url) => `Las condiciones completas de tu suscripción están en los Términos de servicio de Radar: ${url}`,
    annual: {
      subject: "Tu recordatorio anual de Radar Pro",
      title: "Un recordatorio anual sobre Radar Pro",
      body: (price) => `Tienes Radar Pro desde hace aproximadamente un año. Se renueva automáticamente cada mes por ${price} hasta que la canceles.`,
      nextCharge: "Próximo cobro",
    },
    trialEnding: {
      subject: (date) => `Tu prueba gratuita de Radar Pro termina el ${date}`,
      title: "Tu prueba gratuita termina pronto",
      body: (date, price, interval) => `Tu prueba gratuita de Radar Pro termina el ${date}. A menos que canceles antes, se cobrará ${price} a tu tarjeta y tu suscripción se renovará automáticamente ${interval === "year" ? "cada año" : "cada mes"} hasta que la canceles.`,
      choice: (date) => `Para conservar Pro, no tienes que hacer nada. Si no es para ti, cancela en línea desde la página de tu cuenta antes del ${date} y no se te cobrará.`,
    },
    renewal: {
      subject: (date) => `Tu suscripción a Radar Pro se renueva el ${date}`,
      title: "Se acerca tu renovación anual",
      body: (date, price) => `Tu suscripción a Radar Pro se renueva automáticamente el ${date} y se cobrará ${price} a tu tarjeta por un año más.`,
      choice: (date) => `Para conservar Pro, no tienes que hacer nada. Para detener la renovación, cancela en línea desde la página de tu cuenta antes del ${date}. Conservas Pro hasta entonces y no se te volverá a cobrar.`,
    },
    pauseEnding: {
      subject: (date) => `La pausa de tu suscripción a Radar Pro termina el ${date}`,
      title: "Tu pausa termina pronto",
      body: (date, price) => `Tu suscripción a Radar Pro está en pausa hasta el ${date}. Ese día, Pro se reactiva, y la facturación sigue en ${price} desde tu siguiente fecha de renovación.`,
      choice: (date) => `Para retomar Pro, no tienes que hacer nada. Si prefieres no continuar, cancela en línea desde la página de tu cuenta antes del ${date} y no se te cobrará.`,
    },
  },
};

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

interface Notice {
  locale: EmailLocale;
  subject: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  facts?: Array<[string, string]>;
  button: { label: string; url: string };
  footer: string[];
}

/** The same frame as the payment-failed notice in app/email.ts, so billing mail reads as one set. */
function render(notice: Notice) {
  const copy = COPY[notice.locale];
  const facts = notice.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9;border-radius:12px;margin:0 0 20px">
${notice.facts.map(([label, value]) => `      <tr><td style="font-family:Karla,Arial,sans-serif;font-size:14px;color:#5d675f;padding:10px 18px">${escapeHtml(label)}</td><td style="font-family:Karla,Arial,sans-serif;font-size:14px;color:#17261e;font-weight:700;padding:10px 18px;text-align:right">${escapeHtml(value)}</td></tr>`).join("\n")}
    </table>`
    : "";
  const html = `<!doctype html>
<html lang="${notice.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(notice.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(notice.paragraphs[0] || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#ffe4d9;margin-top:6px">${escapeHtml(copy.kicker)}</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:34px;font-weight:700;color:#17261e;letter-spacing:-.5px;line-height:1.1">${escapeHtml(notice.title)}</div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:16px 0 0">${escapeHtml(notice.greeting)}</div>
${notice.paragraphs.map((paragraph) => `    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 18px">${escapeHtml(paragraph)}</div>`).join("\n")}
    ${facts}
    <a href="${escapeHtml(notice.button.url)}" style="display:inline-block;background:#e95f3b;color:#ffffff;font-family:Karla,Arial,sans-serif;font-size:15px;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-bottom:26px">${escapeHtml(notice.button.label)}</a>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:0 32px 28px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#8a938c;line-height:1.6;border-top:1px solid #ece6d8;padding-top:16px">
      ${notice.footer.map(escapeHtml).join("<br>")}
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    notice.title,
    "",
    notice.greeting,
    "",
    ...notice.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(notice.facts?.length ? [...notice.facts.map(([label, value]) => `${label}: ${value}`), ""] : []),
    `${notice.button.label}: ${notice.button.url}`,
    "",
    ...notice.footer,
  ].join("\n");
  return { subject: notice.subject, html, text };
}

interface Recipient { locale: EmailLocale; recipientName: string | null; timezone: string | null; accountUrl: string }

function priceLabel(copy: Copy, price: Money | null, locale: EmailLocale) {
  return price ? formatMoney(price, locale) : copy.unknownPrice;
}

/**
 * The acknowledgment after checkout, and the customer's copy of the contract: California and New
 * York want the terms, the cancellation policy and how to cancel in a form the customer can keep;
 * Ontario, Quebec, BC and Alberta want a copy of the contract within 15 days, hence the link to the
 * full terms.
 *
 * The trial variant is also Quebec's trial notice (Bill 10, 2 to 10 days before the trial ends,
 * with the end date and the price). Radar's trial is three days, so the notice can only go out at
 * the start; `remindLater` adds the promise of a second notice only for a trial long enough that
 * trial_will_end will arrive separately.
 */
export function buildPurchaseEmail(input: Recipient & { interval: RenewalInterval; price: Money | null; trialEnd: number | null; renewsAt: number | null; termsUrl: string; remindLater: boolean }) {
  const { locale, interval, trialEnd, renewsAt } = input;
  const copy = COPY[locale];
  const price = priceLabel(copy, input.price, locale);
  const plan = interval === "year" ? copy.facts.billedYearly : copy.facts.billedMonthly;
  const perPeriod = input.price ? copy.perInterval(price, interval) : price;
  if (trialEnd) {
    const date = formatDate(trialEnd, locale, input.timezone);
    return render({
      locale,
      subject: copy.trialStarted.subject,
      title: copy.trialStarted.title,
      greeting: copy.hello(input.recipientName),
      paragraphs: [copy.trialStarted.intro, copy.trialStarted.converts(date, price, interval), copy.cancel, ...(input.remindLater ? [copy.trialStarted.heads] : []), copy.terms(input.termsUrl)],
      facts: [[copy.facts.plan, plan], [copy.facts.trialEnds, date], [copy.facts.then, perPeriod]],
      button: { label: copy.manage, url: input.accountUrl },
      footer: [copy.keep, copy.footer],
    });
  }
  return render({
    locale,
    subject: copy.purchase.subject,
    title: copy.purchase.title,
    greeting: copy.hello(input.recipientName),
    paragraphs: [copy.purchase.intro, copy.purchase.renews(price, interval), copy.cancel, copy.terms(input.termsUrl)],
    facts: [
      [copy.facts.plan, plan],
      [copy.facts.price, perPeriod],
      ...(renewsAt ? [[copy.facts.nextRenewal, formatDate(renewsAt, locale, input.timezone)] as [string, string]] : []),
    ],
    button: { label: copy.manage, url: input.accountUrl },
    footer: [copy.keep, copy.footer],
  });
}

/** Sent on Stripe's trial_will_end, three days before the trial converts: inside Bill 10's 2-10 days. */
export function buildTrialEndingEmail(input: Recipient & { interval: RenewalInterval; price: Money | null; trialEnd: number }) {
  const { locale, interval } = input;
  const copy = COPY[locale];
  const date = formatDate(input.trialEnd, locale, input.timezone);
  const price = priceLabel(copy, input.price, locale);
  return render({
    locale,
    subject: copy.trialEnding.subject(date),
    title: copy.trialEnding.title,
    greeting: copy.hello(input.recipientName),
    paragraphs: [copy.trialEnding.body(date, price, interval), copy.trialEnding.choice(date)],
    facts: [[copy.facts.trialEnds, date], [copy.facts.then, input.price ? copy.perInterval(price, interval) : price]],
    button: { label: copy.reviewOrCancel, url: input.accountUrl },
    footer: [copy.footer],
  });
}

/** Sent on Stripe's invoice.upcoming for a yearly plan. */
export function buildRenewalReminderEmail(input: Recipient & { price: Money | null; renewsAt: number }) {
  const { locale } = input;
  const copy = COPY[locale];
  const date = formatDate(input.renewsAt, locale, input.timezone);
  const price = priceLabel(copy, input.price, locale);
  return render({
    locale,
    subject: copy.renewal.subject(date),
    title: copy.renewal.title,
    greeting: copy.hello(input.recipientName),
    paragraphs: [copy.renewal.body(date, price), copy.renewal.choice(date)],
    facts: [[copy.facts.nextRenewal, date], [copy.facts.price, input.price ? copy.perInterval(price, "year") : price]],
    button: { label: copy.reviewOrCancel, url: input.accountUrl },
    footer: [copy.footer],
  });
}

/** Sent by the billing job a few days before a pause ends and billing restarts. */
export function buildPauseEndingEmail(input: Recipient & { interval: RenewalInterval; price: Money | null; resumesAt: number }) {
  const { locale, interval } = input;
  const copy = COPY[locale];
  const date = formatDate(input.resumesAt, locale, input.timezone);
  const price = input.price ? copy.perInterval(formatMoney(input.price, locale), interval) : copy.unknownPrice;
  return render({
    locale,
    subject: copy.pauseEnding.subject(date),
    title: copy.pauseEnding.title,
    greeting: copy.hello(input.recipientName),
    paragraphs: [copy.pauseEnding.body(date, price), copy.pauseEnding.choice(date)],
    button: { label: copy.reviewOrCancel, url: input.accountUrl },
    footer: [copy.footer],
  });
}

/** Sent by the billing job once a year to a monthly subscriber. Yearly plans get the renewal reminder. */
export function buildAnnualReminderEmail(input: Recipient & { price: Money | null; nextChargeAt: number | null; termsUrl: string }) {
  const { locale } = input;
  const copy = COPY[locale];
  const price = priceLabel(copy, input.price, locale);
  return render({
    locale,
    subject: copy.annual.subject,
    title: copy.annual.title,
    greeting: copy.hello(input.recipientName),
    paragraphs: [copy.annual.body(price), copy.cancel, copy.terms(input.termsUrl)],
    facts: [
      [copy.facts.plan, copy.facts.billedMonthly],
      [copy.facts.price, input.price ? copy.perInterval(price, "month") : price],
      ...(input.nextChargeAt ? [[copy.annual.nextCharge, formatDate(input.nextChargeAt, locale, input.timezone)] as [string, string]] : []),
    ],
    button: { label: copy.reviewOrCancel, url: input.accountUrl },
    footer: [copy.footer],
  });
}

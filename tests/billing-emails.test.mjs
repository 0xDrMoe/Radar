import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { code } from "./source.mjs";

// The subscription notices the law asks for: a purchase acknowledgment, a trial-ending notice with
// the date and the price (Quebec's Bill 10), a yearly renewal reminder (California's AB 2863), and a
// warning before a pause ends. Stripe's own versions are switched off, so if these break, nobody is
// told anything. The templates are rendered for real, in every language, because a notice missing
// its date or its price is the failure that matters and only rendering shows it.

const source = await readFile(new URL("../app/billing-emails.ts", import.meta.url), "utf8");
const notices = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  ).toString("base64")}`
);
const webhook = code(await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"));
const billingJob = code(await readFile(new URL("../app/api/jobs/billing/route.ts", import.meta.url), "utf8"));
const stripe = code(await readFile(new URL("../app/stripe.ts", import.meta.url), "utf8"));
const checkout = code(await readFile(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8"));
const upgradeCta = code(await readFile(new URL("../app/[locale]/pro/UpgradeCta.tsx", import.meta.url), "utf8"));

const LOCALES = ["en", "fr", "es"];
// 2026-10-20 12:00 UTC: the same calendar day in every North American timezone.
const WHEN = Date.UTC(2026, 9, 20, 12) / 1000;
const PRICE = { amount: 4999, currency: "cad" };
const base = (locale) => ({ locale, recipientName: "Sam", timezone: "America/Toronto", accountUrl: `https://radar.cheap/${locale}/dashboard/account` });

test("the locale is always one of Radar's three", () => {
  assert.equal(notices.emailLocale("fr-CA"), "fr");
  assert.equal(notices.emailLocale("ES"), "es");
  assert.equal(notices.emailLocale("de"), "en");
  assert.equal(notices.emailLocale(undefined), "en");
  assert.equal(notices.emailLocale("<script>"), "en");
});

test("money is shown in the reader's own format", () => {
  assert.match(notices.formatMoney(PRICE, "en"), /\$49\.99/);
  assert.match(notices.formatMoney(PRICE, "fr"), /49,99\s\$/);
  assert.match(notices.formatMoney({ amount: 999, currency: "usd" }, "en"), /US\$9\.99/);
  assert.match(notices.formatMoney({ amount: 500, currency: "jpy" }, "en"), /500/);
});

for (const locale of LOCALES) {
  const date = notices.formatDate(WHEN, locale, "America/Toronto");
  const price = notices.formatMoney(PRICE, locale);

  test(`${locale}: the trial notice gives the end date and the price, and how to cancel`, () => {
    const mail = notices.buildTrialEndingEmail({ ...base(locale), interval: "month", price: PRICE, trialEnd: WHEN });
    for (const part of [mail.subject, mail.text, mail.html]) assert.ok(part.includes(date), `${locale} trial notice lacks the date`);
    assert.ok(mail.text.includes(price), `${locale} trial notice lacks the price`);
    assert.ok(mail.html.includes(`/${locale}/dashboard/account`));
    assert.match(mail.html, new RegExp(`<html lang="${locale}">`));
  });

  test(`${locale}: the renewal reminder gives the renewal date and the yearly price`, () => {
    const mail = notices.buildRenewalReminderEmail({ ...base(locale), price: PRICE, renewsAt: WHEN });
    assert.ok(mail.subject.includes(date));
    assert.ok(mail.text.includes(price));
  });

  test(`${locale}: the purchase acknowledgment states the terms and how to cancel`, () => {
    const terms = { termsUrl: `https://radar.cheap/${locale}/terms`, remindLater: false };
    const paid = notices.buildPurchaseEmail({ ...base(locale), ...terms, interval: "year", price: PRICE, trialEnd: null, renewsAt: WHEN });
    assert.ok(paid.text.includes(price) && paid.text.includes(date));
    // The acknowledgment is the customer's copy of the contract, so it links the full terms.
    assert.ok(paid.text.includes(terms.termsUrl));
    const trial = notices.buildPurchaseEmail({ ...base(locale), ...terms, interval: "month", price: PRICE, trialEnd: WHEN, renewsAt: WHEN });
    assert.notEqual(trial.subject, paid.subject, "a trial start reads the same as a paid purchase");
    assert.ok(trial.text.includes(price) && trial.text.includes(date) && trial.text.includes(terms.termsUrl));
    // A three-day trial gets no second notice, so the mail must not promise one.
    const promising = notices.buildPurchaseEmail({ ...base(locale), ...terms, remindLater: true, interval: "month", price: PRICE, trialEnd: WHEN, renewsAt: WHEN });
    assert.ok(promising.text.length > trial.text.length, "remindLater changes nothing");
  });

  test(`${locale}: the annual reminder for a monthly plan gives the price and how to cancel`, () => {
    const mail = notices.buildAnnualReminderEmail({ ...base(locale), price: PRICE, nextChargeAt: WHEN, termsUrl: `https://radar.cheap/${locale}/terms` });
    assert.ok(mail.text.includes(price) && mail.text.includes(date));
    assert.ok(mail.text.includes(`/${locale}/dashboard/account`));
  });

  test(`${locale}: the pause notice gives the restart date and price`, () => {
    const mail = notices.buildPauseEndingEmail({ ...base(locale), interval: "month", price: PRICE, resumesAt: WHEN });
    assert.ok(mail.subject.includes(date));
    assert.ok(mail.text.includes(price));
  });

  test(`${locale}: an unknown price points at the account page instead of leaving a gap`, () => {
    const mail = notices.buildTrialEndingEmail({ ...base(locale), interval: "month", price: null, trialEnd: WHEN });
    assert.ok(!/undefined|null|NaN/.test(mail.text), mail.text);
  });
}

test("the notices are not in English for French or Spanish readers", () => {
  const en = notices.buildTrialEndingEmail({ ...base("en"), interval: "month", price: PRICE, trialEnd: WHEN });
  const fr = notices.buildTrialEndingEmail({ ...base("fr"), interval: "month", price: PRICE, trialEnd: WHEN });
  const es = notices.buildTrialEndingEmail({ ...base("es"), interval: "month", price: PRICE, trialEnd: WHEN });
  assert.notEqual(en.subject, fr.subject);
  assert.notEqual(en.subject, es.subject);
});

test("names are escaped in the HTML", () => {
  const mail = notices.buildTrialEndingEmail({ ...base("en"), recipientName: "<b>x</b>", interval: "month", price: PRICE, trialEnd: WHEN });
  assert.ok(!mail.html.includes("<b>x</b>"));
});

test("subscription terms read both of Stripe's shapes and refuse a mismatched currency", () => {
  const modern = notices.subscriptionTerms({
    status: "trialing", currency: "cad", trial_end: WHEN, metadata: { locale: "fr" },
    items: { data: [{ price: { unit_amount: 4999, currency: "cad", recurring: { interval: "year" } }, quantity: 1, current_period_end: WHEN }] },
  });
  assert.deepEqual(modern, { interval: "year", price: PRICE, trialEnd: WHEN, periodEnd: WHEN, locale: "fr", endsAtPeriodEnd: false });
  const multiCurrency = notices.subscriptionTerms({
    status: "active", currency: "usd", current_period_end: WHEN, cancel_at_period_end: true,
    items: { data: [{ price: { unit_amount: 4999, currency: "cad", recurring: { interval: "month" } } }] },
  });
  assert.equal(multiCurrency.price, null, "a base-currency amount was quoted in another currency");
  assert.equal(multiCurrency.trialEnd, null);
  assert.equal(multiCurrency.endsAtPeriodEnd, true);
});

test("the webhook sends each notice as transactional mail with no unsubscribe header", () => {
  for (const event of ["customer.subscription.trial_will_end", "invoice.upcoming", "checkout.session.completed"])
    assert.ok(webhook.includes(`event.type === "${event}"`), `no handler for ${event}`);
  const sender = webhook.slice(webhook.indexOf("async function sendBillingNotice"), webhook.indexOf("export async function POST"));
  assert.match(sender, /audience: "transactional"/);
  assert.ok(!/unsubscribeUrl/.test(sender), "a billing notice carries List-Unsubscribe");
  // A failed send is recorded, never thrown back at Stripe.
  assert.match(sender, /catch \(cause\)/);
  assert.match(sender, /billing_notice_failed/);
});

test("only yearly plans get a renewal reminder, and nobody who has already cancelled", () => {
  const branch = webhook.slice(webhook.indexOf('event.type === "invoice.upcoming"'), webhook.indexOf('event.type === "account.updated"'));
  assert.match(branch, /billingIntervalFor\(object\) === "year"/);
  assert.match(branch, /!terms\?\.endsAtPeriodEnd/);
  assert.match(branch, /daysAhead/);
});

test("a trial that will not convert is not told it is about to be charged", () => {
  const branch = webhook.slice(webhook.indexOf('event.type === "customer.subscription.trial_will_end"'), webhook.indexOf('event.type === "invoice.upcoming"'));
  assert.match(branch, /!terms\.endsAtPeriodEnd/);
  assert.match(branch, /subscription\.status === "trialing"/);
});

test("the pause reminder is sent once per pause and only after a successful send is it recorded", () => {
  assert.match(billingJob, /\["pauseReminders", \(\) => remindPausesEnding\(emailEnabled\)\]/);
  const step = billingJob.slice(billingJob.indexOf("async function remindPausesEnding"), billingJob.indexOf("async function sendWinbacks"));
  assert.match(step, /e\.type='pause_ending_reminder_sent' AND e\.entity_id=u\.paused_until/);
  assert.match(step, /audience: "transactional"/);
  assert.ok(step.indexOf("await sendEmail(") < step.indexOf("'pause_ending_reminder_sent',?"), "the reminder is recorded before it is sent");
});

test("the reader's language travels from the Pro page to the subscription", () => {
  assert.match(upgradeCta, /JSON\.stringify\(\{ plan, source, locale \}\)/);
  assert.match(checkout, /const locale = emailLocale\(/);
  assert.match(stripe, /"subscription_data\[metadata\]\[locale\]":locale/);
  assert.match(stripe, /locale:CHECKOUT_LOCALE\[locale\]/);
});

test("a three-day trial is noticed once, at the start, not twice", () => {
  const branch = webhook.slice(webhook.indexOf('event.type === "customer.subscription.trial_will_end"'), webhook.indexOf('event.type === "invoice.upcoming"'));
  assert.match(branch, /json_extract\(properties,'\$\.kind'\)='purchase' AND json_extract\(properties,'\$\.trial'\)=1/);
  assert.match(branch, /&& !alreadyNoticed\)/);
  assert.match(webhook, /remindLater: Boolean\(terms\.trialEnd && terms\.trialEnd \* 1000 - Date\.now\(\) > 4 \* 86_400_000\)/);
});

test("monthly subscribers get a yearly reminder, and yearly ones are not sent it twice", () => {
  assert.match(billingJob, /\["annualReminders", \(\) => remindAnnually\(emailEnabled\)\]/);
  const step = billingJob.slice(billingJob.indexOf("async function remindAnnually"), billingJob.indexOf("async function sendWinbacks"));
  // Either reminder resets the clock, so a yearly plan's renewal reminder counts as its annual one.
  assert.match(step, /IN \('annual_reminder','renewal_reminder'\)/);
  assert.match(step, /terms\.interval === "year" \|\| terms\.endsAtPeriodEnd/);
  assert.match(step, /audience: "transactional"/);
  assert.ok(step.indexOf("await sendEmail(") < step.indexOf("'billing_notice_sent',?"), "the reminder is recorded before it is sent");
});

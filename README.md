# Radar

**Find the restaurant deals, daily specials and happy hours running near you right now.**
This is the source code of the website at [radar.cheap](https://radar.cheap).

Radar answers one question: *what is actually worth going to near me, right now?* Most deal sites
list coupons and leave you to find out at the door that the offer ended months ago. Radar stores
each deal's **schedule** instead of a static coupon, so a happy hour that runs 3–6 PM Tuesday to
Friday shows as running, or not, at the minute you look. Every deal also shows its restrictions,
where the information came from, and when it was last verified.

- [What the site does](#what-the-site-does)
- [What is in this repository, and what is not](#what-is-in-this-repository-and-what-is-not)
- [How it is built](#how-it-is-built)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Deploy your own copy](#deploy-your-own-copy)
- [Contributing, security and license](#contributing-security-and-license)

---

## What the site does

### For everyone, no account needed

- **Search near you.** Search by postal or ZIP code, city or current location (only with your
  permission, and never stored), within an adjustable radius.
- **Filter and sort.** Narrow results by cuisine, price, deal type (happy hour, food deal,
  tonight) and whether a deal is *available now*. Sort by recommended, nearest, newest, most
  saved, biggest saving, price or restaurant. Flip between a list and a map.
- **Read a deal.** Each deal page shows the offer, its schedule in plain language, terms and
  restrictions, price, the participating locations with distances, the source, and the date it
  was last checked. Chain deals collapse into one card covering every branch.
- **City guides.** Server-rendered pages for each city with enough restaurants, so people
  searching for "happy hour in Ottawa" land on something useful.
- **Report a problem.** Anyone can flag a deal as ended or wrong. An open report marks the deal
  "Re-checking" and lowers it in results until staff confirm or fix it.
- **Three languages.** English, French and Spanish.

### With a free account

- Save deals and restaurants.
- Track areas and get email or push alerts when something new appears in them, at a time you
  choose.
- Download or delete all of your data from your account page.

### Radar Pro

A paid subscription (Stripe on the web) for more tracked areas, a wider alert radius and longer
notification history. Basic discovery is always free.

### For the people running it

All operator areas are English-only and live under `app/(operator)`:

- **`/admin`**: the staff workspace for deals, restaurants, drafts, reports, verification,
  reminders, users, roles, email, sponsorships and analytics. Access is role-based and enforced
  on the server, and high-risk actions need an owner's approval. Every change is written to an
  audit log. [`docs/ROLES.md`](docs/ROLES.md) is the full permission reference.
- **`/portal`**: restaurant managers update only the restaurants they have been granted. Their
  changes go through review before they are published.
- **`/creator`** and the affiliate portal: creators submit deals for review and see the traffic
  and commissions their links bring in. Payouts go through Stripe Connect.

### How Radar keeps deals trustworthy

- **Nothing submitted is trusted automatically.** Suggestions from users, restaurants and
  creators arrive as drafts and are published only after staff review them.
- **Every deal has a source and a verification date.** Visitors can see both.
- **Deals expire and get re-checked.** Expired deals are retired on an hourly schedule, and
  deals that are due for review show up as reminders in the staff workspace.
- **Sponsored placement is labelled** and never disguised as an organic result.

---

## What is in this repository, and what is not

This repository is the **website and its API**, published under the AGPL-3.0 license.

These are **not** included, and are not covered by the license:

- **The deal catalog.** Radar's restaurants, locations, deals, schedules and verification history
  are maintained separately. The database here starts empty, apart from the role presets. A few
  fictional sample restaurants are provided for local development.
- **The research and verification process** that finds new deals and keeps existing ones current.
- **The mobile app.**
- **Radar's name, logo and brand.** See [TRADEMARKS.md](TRADEMARKS.md).

---

## How it is built

| | |
| --- | --- |
| Runtime | Cloudflare Workers |
| Framework | [vinext](https://github.com/cloudflare/vinext) (Next.js App Router API on Vite), React 19 |
| Database | Cloudflare D1 (SQLite), schema in `db/schema.ts`, migrations in `drizzle/` |
| File storage | Cloudflare R2, for restaurant photos |
| Sign-in | Clerk |
| Payments | Stripe (subscriptions, customer portal, Connect for affiliate payouts) |
| Email | Resend |
| Bot protection | Cloudflare Turnstile |
| Translation | next-intl for interface text, DeepL for deal text |
| Styling | Tailwind CSS 4 |

**Request flow.** One Worker (`worker/index.ts`) serves everything. It handles security headers
and CSP, the http→https and www redirects, an edge page cache keyed on the deployment, image
optimization, and the hourly cron. Pages and `/api` routes live in `app/`.

**Deal pages are prerendered at deploy** by `scripts/prerender-deals.mjs` and served as static
files, with share images drawn by `scripts/deal-og.mjs`. Always deploy with `npm run deploy`
(build, prerender, deploy), never a bare `wrangler deploy`.

**`/api/deals` is served from a cached snapshot** keyed on a data revision (the newest
`updated_at` across deals, restaurants and locations), so an edit shows up everywhere without a
cache purge.

**The hourly cron** expires deals, geocodes tracked areas, sends alert digests at each person's
chosen local hour, runs billing housekeeping, and translates new deal text.

Most of the *why* behind the code is written beside it, as comments. `worker/index.ts` and
`wrangler.jsonc` are worth reading before changing anything about caching or routing.

---

## Run it locally

Requires **Node 22.13 or later**.

```sh
npm ci

# Create the local database and load the fictional sample deals
npx wrangler d1 migrations apply radar --local
npx wrangler d1 execute radar --local --file scripts/sample-data.sql

npm run dev
```

Sign-in needs a free [Clerk](https://clerk.com) development instance. Put its publishable key in
`.env.local` and its secret key in `.dev.vars` (both are git-ignored):

```sh
# .env.local
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# .dev.vars
CLERK_SECRET_KEY=sk_test_...
TURNSTILE_DISABLED=true
```

Everything else is optional for local development. Features that need a key, such as email,
billing and translation, stay off until their key is set. Bot protection is the exception: without
`TURNSTILE_SECRET_KEY` the public forms refuse every submission, so local development turns the
check off explicitly with `TURNSTILE_DISABLED=true`. Never set that on a deployed copy.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Production build |
| `npm test` | Type-check, build, then run the test suite in `tests/` |
| `npm run lint` | ESLint |
| `npm run test:migrations` | Apply every migration to a throwaway local database |
| `npm run db:generate` | Generate a migration after editing `db/schema.ts` |
| `npm run deploy` | Build, prerender deal pages and deploy (the only correct way to ship) |

---

## Configuration

Non-secret settings are `vars` in `wrangler.jsonc`. Credentials are Worker secrets, set with
`npx wrangler secret put NAME` (or `.dev.vars` locally), and never committed.
`cloudflare-env.d.ts` documents every one. The main ones:

| Name | Kind | Needed for |
| --- | --- | --- |
| `PUBLIC_APP_URL` | var | Links in emails and the affiliate portal |
| `OWNER_EMAIL` | var | The account that is always owner of `/admin` (blank means none) |
| `VITE_CLERK_PUBLISHABLE_KEY` | build env | Sign-in in the browser |
| `CLERK_SECRET_KEY` | secret | Sign-in on the server |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | var / secret | Bot protection on public forms (they refuse submissions without it) |
| `TURNSTILE_DISABLED` | var | `"true"` skips the bot check. Local development only |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_UNSUBSCRIBE_SECRET` | secret / var / secret | Email |
| `EMAIL_KILL_SWITCH` | var | Must be exactly `"false"` before any email is sent |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | secret | Radar Pro billing |
| `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_YEARLY` | var | Your monthly and yearly prices |
| `DEEPL_API_KEY`, `TRANSLATE_JOB_SECRET` | secret | Translating deal text into French and Spanish |
| `EMAIL_JOB_SECRET`, `BILLING_JOB_SECRET`, `GEOCODE_JOB_SECRET` | secret | The background jobs the cron runs |

---

## Deploy your own copy

1. Create a D1 database and an R2 bucket in your Cloudflare account, and put the database id and
   bucket name in `wrangler.jsonc`.
2. Set `PUBLIC_APP_URL`, `OWNER_EMAIL` and the secrets for the features you want.
3. Add your domain under `routes` in `wrangler.jsonc`.
4. Apply the migrations remotely: `npx wrangler d1 migrations apply radar --remote`.
5. Deploy: `npm run deploy`.

**Before serving it to anyone, you must rebrand it.** Replace the Radar name, logo and icons, and
replace the Terms, Privacy and Support pages and contact details with your own.
[TRADEMARKS.md](TRADEMARKS.md) lists exactly what to change. Radar's legal pages describe Radar's
own relationship with its users and do not apply to your service.

---

## Contributing, security and license

- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md). Please don't send deal or restaurant
  data as code; suggest deals at [radar.cheap](https://radar.cheap) instead.
- **Security:** please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
- **License:** [GNU Affero General Public License v3.0](LICENSE). You may use, study, modify and
  share this code. If you run a modified version as a service that people use over a network, you
  must offer those people the source code of your version under the same license.
- **Trademarks:** the license does not cover Radar's name, logo or brand. See
  [TRADEMARKS.md](TRADEMARKS.md).

Radar is operated by Cedar Tech Solutions. Questions: support@cedartechsolutions.ca

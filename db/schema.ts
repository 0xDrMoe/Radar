import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurant: text("restaurant").notNull(),
    deal: text("deal").notNull(),
    postal: text("postal").notNull(),
    schedule: text("schedule").notNull(),
    email: text("email").notNull(),
    userId: text("user_id"),
    restaurantWebsite: text("restaurant_website"),
    address: text("address"),
    title: text("title"),
    description: text("description"),
    price: text("price"),
    eligibleDays: text("eligible_days").notNull().default("[]"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    startsAt: text("starts_at"),
    expiresAt: text("expires_at"),
    restrictions: text("restrictions"),
    source: text("source"),
    relationship: text("relationship"),
    reference: text("reference"),
    rejectionReason: text("rejection_reason"),
    assignedTo: text("assigned_to"),
    priority: text("priority").notNull().default("normal"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_suggestions_status_created").on(table.status, table.createdAt),
    uniqueIndex("idx_suggestions_reference").on(table.reference),
  ],
);

export const deals = sqliteTable(
  "deals",
  {
    id: text("id").primaryKey(),
    restaurant: text("restaurant").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    cuisine: text("cuisine").notNull(),
    schedule: text("schedule").notNull(),
    city: text("city").notNull(),
    postalPrefix: text("postal_prefix").notNull(),
    address: text("address").notNull(),
    price: text("price").notNull(),
    emoji: text("emoji").notNull(),
    sourceUrl: text("source_url").notNull(),
    sponsored: integer("sponsored").notNull().default(0),
    active: integer("active").notNull().default(1),
    verifiedAt: text("verified_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    restaurantId: text("restaurant_id"),
    locationId: text("location_id"),
    status: text("status").notNull().default("live"),
    publishAt: text("publish_at"),
    expiresAt: text("expires_at"),
    terms: text("terms"),
    restrictions: text("restrictions"),
    internalNotes: text("internal_notes"),
    verificationStatus: text("verification_status")
      .notNull()
      .default("verified"),
    deletedAt: text("deleted_at"),
    slug: text("slug"),
    description: text("description"),
    locale: text("locale").notNull().default("en"),
    discountPercent: integer("discount_percent"),
    savingsCents: integer("savings_cents"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    // When this deal first entered the system — set once on insert and never touched again,
    // unlike verifiedAt (which advances every time staff re-check the deal). This is the
    // "date published" signal for surfacing recently-added deals.
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // 1-5 price tier ($ to $$$$$), independent of the free-text `price` description — staff-set,
    // left null when unrated so the UI can omit the badge rather than guess.
    priceTier: integer("price_tier"),
    // Where the offer runs. NULL: the deal's own location and its deal_locations rows. 'brand':
    // every operating branch of its restaurant (drizzle/0049). 'national': every participating
    // location of a chain whose branches Radar does not hold, placed by the restaurant's country
    // and footprint (drizzle/0050).
    locationScope: text("location_scope"),
    // How it is redeemed: a comma-separated set of in_store, app, online and code. NULL makes no
    // claim either way.
    redemption: text("redemption"),
    redemptionNote: text("redemption_note"),
    photoUrl: text("photo_url"),
    // The checkout code when redemption includes 'code' (drizzle/0050).
    promoCode: text("promo_code"),
    // A restaurant manager saying from the portal that the deal is still running (drizzle/0069).
    // Owner-sourced, so never a check: verifiedAt and verificationStatus stay staff-only.
    ownerConfirmedAt: text("owner_confirmed_at"),
  },
  (t) => [
    // Unused by the current search query (postal/radius filtering happens in JS, not SQL) —
    // kept intentionally rather than confirmed-dead; wiring it up isn't justified below
    // roughly a few thousand deals. Don't reflexively prune this.
    index("idx_deals_postal_active").on(t.postalPrefix, t.active),
    index("idx_deals_status_expiry").on(t.status, t.expiresAt),
    index("idx_deals_location_status").on(t.locationId, t.status),
    uniqueIndex("idx_deals_slug").on(t.slug),
    index("idx_deals_public_sort").on(t.status, t.verificationStatus, t.verifiedAt),
    index("idx_deals_created_at").on(t.createdAt),
    index("idx_deals_price_tier").on(t.priceTier),
    // Deals are joined to their restaurant everywhere; without this every such lookup is a full
    // scan. Its absence is most of why this account ran out D1's daily row-read budget — see
    // drizzle/0036_photo_lookup_indexes.sql.
    index("idx_deals_restaurant").on(t.restaurantId),
    // Looked up by value, not by key: the photo work asks how many rows share a given source_url,
    // to tell a restaurant's own page from an aggregator listing shared by dozens.
    index("idx_deals_source_url").on(t.sourceUrl),
  ],
);

export const restaurants = sqliteTable(
  "restaurants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    website: text("website"),
    phone: text("phone"),
    cuisine: text("cuisine").notNull(),
    amenities: text("amenities").notNull().default("[]"),
    dietaryOptions: text("dietary_options").notNull().default("[]"),
    accessibility: text("accessibility").notNull().default("[]"),
    claimed: integer("claimed").notNull().default(0),
    status: text("status").notNull().default("operating"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    slug: text("slug"),
    isChain: integer("is_chain").notNull().default(0),
    formerNames: text("former_names").notNull().default("[]"),
    photoUrl: text("photo_url"),
    // Deal vertical this business belongs to (e.g. "restaurant", "retail"). Lets the public
    // site and search API scope results to the category picked in the navbar without a
    // separate businesses table — see the "vertical" filter in app/api/deals/route.ts.
    vertical: text("vertical").notNull().default("restaurant"),
    // "quick" (you order at a counter or in an app) or "sit_down" (a table and a server), behind
    // the public Fast food / Sit-down filter. Nullable on purpose: NULL means nobody has decided,
    // which matches neither filter — see scripts/classify-service-style.mjs, which fills it.
    serviceStyle: text("service_style"),
    // The brand's own logo and further photos, as /api/photo/... paths (drizzle/0049).
    logoUrl: text("logo_url"),
    gallery: text("gallery"),
    // A brand-level row's market, trading footprint ({"TN": 214, ...}) and store finder: what a
    // 'national' deal with no location of its own is placed by (drizzle/0050).
    country: text("country"),
    footprint: text("footprint"),
    locatorUrl: text("locator_url"),
    // A brand a reader anywhere in the country would know, as against a local group that is merely
    // a chain. Shown in the homepage's nationwide section, not the local list (drizzle/0051).
    nationalChain: integer("national_chain").notNull().default(0),
    // The brand, where this row is named for one of its branches ("JOEY Burnaby" is JOEY); null
    // when the name is the brand. The nationwide section shows a card per brand (drizzle/0052).
    brand: text("brand"),
  },
  (t) => [
    index("idx_restaurants_name").on(t.name),
    uniqueIndex("idx_restaurants_slug").on(t.slug),
    index("idx_restaurants_vertical").on(t.vertical),
    // Same reason as idx_deals_source_url: matched by value, to find the pages several
    // restaurants share.
    index("idx_restaurants_website").on(t.website),
    index("idx_restaurants_service_style").on(t.serviceStyle),
  ],
);

export const restaurantManagers = sqliteTable(
  "restaurant_managers",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id").notNull(),
    invitedEmail: text("invited_email").notNull(),
    userId: text("user_id"),
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    index("idx_restaurant_managers_restaurant").on(t.restaurantId),
    index("idx_restaurant_managers_user").on(t.userId),
  ],
);

export const restaurantLocations = sqliteTable(
  "restaurant_locations",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    region: text("region"),
    country: text("country").notNull().default("CA"),
    postalPrefix: text("postal_prefix").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    timezone: text("timezone").notNull(),
    phone: text("phone"),
    status: text("status").notNull().default("operating"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    slug: text("slug"),
    neighborhood: text("neighborhood"),
    fullPostal: text("full_postal"),
    officialUrl: text("official_url"),
    /** How good latitude/longitude actually are: exact | street | city | null. See 0030. */
    geoPrecision: text("geo_precision"),
    geocodedAt: text("geocoded_at"),
  },
  (t) => [
    index("idx_locations_city_status").on(t.city, t.status),
    index("idx_locations_geo_precision").on(t.geoPrecision, t.status),
    index("idx_locations_restaurant").on(t.restaurantId),
    uniqueIndex("idx_locations_restaurant_address").on(t.restaurantId, t.address),
    uniqueIndex("idx_locations_slug").on(t.slug),
  ],
);

export const dealSchedules = sqliteTable(
  "deal_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: text("deal_id").notNull(),
    displayText: text("display_text").notNull(),
    days: text("days").notNull().default("[]"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    timezone: text("timezone").notNull(),
    recurring: integer("recurring").notNull().default(1),
    validFrom: text("valid_from"),
    validUntil: text("valid_until"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_schedules_deal").on(t.dealId)],
);

export const dealItems = sqliteTable(
  "deal_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: text("deal_id").notNull(),
    name: text("name").notNull(),
    originalPrice: text("original_price"),
    discountedPrice: text("discounted_price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_deal_items_deal").on(t.dealId)],
);

export const verificationEvents = sqliteTable(
  "verification_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: text("deal_id").notNull(),
    status: text("status").notNull(),
    method: text("method").notNull(),
    sourceUrl: text("source_url").notNull(),
    verifiedBy: text("verified_by"),
    notes: text("notes"),
    verifiedAt: text("verified_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_verification_deal_date").on(t.dealId, t.verifiedAt)],
);

// A restaurant manager's edit to a deal, held for staff review instead of written onto the live
// listing (drizzle/0065). `previous` is the deal's content when the edit was made, as JSON. At most
// one row per deal is 'pending'; see the migration for the other statuses.
export const dealChangeRequests = sqliteTable(
  "deal_change_requests",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    title: text("title").notNull(),
    price: text("price").notNull(),
    schedule: text("schedule").notNull(),
    description: text("description"),
    terms: text("terms"),
    previous: text("previous").notNull().default("{}"),
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reviewedAt: text("reviewed_at"),
  },
  (t) => [
    index("idx_deal_change_requests_status").on(t.status, t.createdAt),
    index("idx_deal_change_requests_deal").on(t.dealId, t.createdAt),
    uniqueIndex("idx_deal_change_requests_one_pending").on(t.dealId).where(sql`status = 'pending'`),
  ],
);

// A reminder in the staff workspace to renew or confirm a deal (drizzle/0066, app/staff-reminders.ts).
// One per (kind, deal, basis): `basis` is the expires_at or verified_at it is about, or 'research'.
export const staffReminders = sqliteTable(
  "staff_reminders",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    dealId: text("deal_id").notNull(),
    basis: text("basis").notNull(),
    details: text("details").notNull().default("{}"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    uniqueIndex("idx_staff_reminders_once").on(t.kind, t.dealId, t.basis),
    index("idx_staff_reminders_status").on(t.status, t.createdAt),
  ],
);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("user"),
  homePostal: text("home_postal"),
  alertDays: text("alert_days").notNull().default("1,2,3,4,5"),
  alertTime: text("alert_time").notNull().default("08:00"),
  alertsEnabled: integer("alerts_enabled").notNull().default(0),
  status: text("status").notNull().default("active"),
  // Keeps an account out of the admin user list for everyone except owners and admins. Not a
  // security boundary — a hidden account behaves exactly like any other, and anyone who can read
  // the database still sees it. It exists so a staff or test account does not have to sit in the
  // list every operator scrolls past. See docs/ROLES.md.
  hidden: integer("hidden").notNull().default(0),
  language: text("language").notNull().default("en"),
  timezone: text("timezone").notNull().default("America/Toronto"),
  country: text("country").notNull().default("CA"),
  distanceUnit: text("distance_unit").notNull().default("km"),
  theme: text("theme").notNull().default("dark"),
  accentColor: text("accent_color").notNull().default("coral"),
  // The creator handle this account arrived through, captured once at sign-up from the ?c= link
  // and never rewritten afterwards. Attribution, not authorization.
  referredBy: text("referred_by"),
  // The campaign label on the link they arrived through, if it carried one. Written beside
  // referred_by on the first insert and never rewritten, for the same reason.
  referredCampaign: text("referred_campaign"),
  plan: text("plan").notNull().default("free"),
  planStatus: text("plan_status").notNull().default("inactive"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// One row per creator account. The handle is the public half of their tracked link
// (radar.cheap/?c=<handle>) and the key every attributed visit and sign-up is stamped with, so it
// is unique and is only ever set by staff — a creator cannot choose or change their own.
export const creatorProfiles = sqliteTable(
  "creator_profiles",
  {
    userId: text("user_id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    // Basis points of each paid invoice this creator earns, per creator rather than global so a
    // founding partner can be worth more than a later one without a second rate system.
    commissionRateBps: integer("commission_rate_bps").notNull().default(2000),
    // The Stripe Express account Radar transfers commissions to. The id is the only thing stored:
    // the bank details, tax identity and verification documents live at Stripe, which is the whole
    // point of using Connect rather than collecting them here.
    stripeAccountId: text("stripe_account_id"),
    // A cache of Stripe's own answer about that account, refreshed by the account.updated webhook
    // so the portal can explain why somebody cannot be paid without a round trip. Never the source
    // of truth — the payout path re-reads the account from Stripe before it sends anything.
    payoutsEnabled: integer("payouts_enabled").notNull().default(0),
    requirementsDue: integer("requirements_due").notNull().default(0),
    connectSyncedAt: text("connect_synced_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_creator_profiles_handle").on(t.handle),
    // Two profiles pointing at one connected account would be two affiliates able to spend the
    // same balance. Drizzle cannot express the WHERE stripe_account_id IS NOT NULL half, which
    // drizzle/0048_affiliate_payouts.sql carries — see the note there.
    uniqueIndex("idx_creator_profiles_stripe_account").on(t.stripeAccountId),
  ],
);

// Someone asking to become a creator. Kept apart from creator_profiles so that table keeps
// meaning "an active creator with a handle": the handle is assigned at approval, not requested
// into existence, which is what stops an application from reserving someone else's name.
export const creatorApplications = sqliteTable(
  "creator_applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    requestedHandle: text("requested_handle").notNull(),
    channelUrl: text("channel_url").notNull(),
    audience: text("audience"),
    pitch: text("pitch"),
    status: text("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_creator_applications_status").on(t.status, t.createdAt),
    // One open application per account. Drizzle cannot express the WHERE status='pending' half,
    // which drizzle/0038_creator_affiliate_program.sql carries — see the note there.
    uniqueIndex("idx_creator_applications_open").on(t.userId),
  ],
);

// One row per paid Stripe invoice that a creator's link is credited for. Amounts are integer
// minor units in the invoice's own currency and are never converted; `rate_bps` is stamped at
// accrual so a later rate change cannot rewrite what was already earned.
export const creatorCommissions = sqliteTable(
  "creator_commissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    handle: text("handle").notNull(),
    // Nullable: a subscriber can delete their account, and the creator is still owed for
    // invoices already paid, so deletion clears this rather than removing the row.
    userId: text("user_id"),
    invoiceId: text("invoice_id").notNull(),
    subscriptionId: text("subscription_id"),
    // Copied from the user row at accrual, not joined at read time: a payout record has to keep
    // saying what it said when it was made, and the user row can be anonymised later.
    campaign: text("campaign"),
    grossAmount: integer("gross_amount").notNull(),
    currency: text("currency").notNull(),
    rateBps: integer("rate_bps").notNull(),
    commissionAmount: integer("commission_amount").notNull(),
    // pending -> approved -> paid, with void (the payment came back) and rejected (a person
    // refused it) as the two ways out. See COMMISSION_STATUSES in app/affiliate-program.ts.
    status: text("status").notNull().default("pending"),
    // Which payout settled this row. Set when a payout claims it, cleared if that payout fails,
    // and the reason a claimed commission cannot be edited by hand.
    payoutId: integer("payout_id"),
    // Why a person refused it, as opposed to Stripe reversing it.
    rejectionReason: text("rejection_reason"),
    // When the hold elapsed and the row became payable. Stamped by the job rather than derived on
    // read, so changing the hold period tomorrow cannot un-approve money already shown as ready.
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    paidAt: text("paid_at"),
  },
  (t) => [
    // The idempotency guarantee: Stripe retries, and two event ids can describe one invoice.
    uniqueIndex("idx_creator_commissions_invoice").on(t.invoiceId),
    index("idx_creator_commissions_handle").on(t.handle, t.createdAt),
    index("idx_creator_commissions_status").on(t.status),
    index("idx_creator_commissions_payout").on(t.payoutId),
  ],
);

// One row per attempt to send an affiliate money, with the Stripe object behind it.
//
// Its own table rather than a column on creator_commissions: a payout covers many commissions, it
// has a lifecycle of its own (Stripe can accept a transfer and fail the payout days later), and it
// has to survive the commissions being re-read. The link runs the other way, through
// creator_commissions.payout_id.
//
// `stripe_transfer_id` is unique for the same reason creator_commissions.invoice_id is: Stripe
// retries webhooks and two event ids can describe one transfer. Paying twice is the worst bug a
// payables table can have, so the schema refuses it rather than the code remembering to check. It
// is nullable because a payout exists in Radar for a moment before Stripe has given it an id —
// that moment is the 'pending' status, and a row that never leaves it never moved money.
export const creatorPayouts = sqliteTable(
  "creator_payouts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    handle: text("handle").notNull(),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeTransferId: text("stripe_transfer_id"),
    // Stripe's own payout to the affiliate's bank, which happens after the transfer and on the
    // connected account's schedule. Recorded when the payout.* webhook names it.
    stripePayoutId: text("stripe_payout_id"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    commissionCount: integer("commission_count").notNull().default(0),
    failureReason: text("failure_reason"),
    // Whoever authorized it: the affiliate for a self-service payout, a member of staff for one
    // settled from the management console.
    initiatedBy: text("initiated_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    paidAt: text("paid_at"),
  },
  (t) => [
    // Partial in the migration (WHERE stripe_transfer_id IS NOT NULL), which Drizzle cannot say.
    uniqueIndex("idx_creator_payouts_transfer").on(t.stripeTransferId),
    index("idx_creator_payouts_handle").on(t.handle, t.createdAt),
    index("idx_creator_payouts_status").on(t.status),
  ],
);

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id").notNull(),
    verifiedEmail: text("verified_email").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_auth_identity_provider_subject").on(t.provider, t.subject),
    uniqueIndex("idx_auth_identity_provider_user").on(t.provider, t.userId),
  ],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_role_permissions_unique").on(t.role, t.permission)],
);

export const userPermissions = sqliteTable(
  "user_permissions",
  {
    userId: text("user_id").notNull(),
    permission: text("permission").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_user_permissions_unique").on(t.userId, t.permission)],
);

// Push targets for the mobile app. One row per device, not per person: someone signs in on a
// phone and a tablet and both should ring.
//
// The token is the identity, and it belongs to the device rather than the account — the same
// handset can be handed to a different user, so the unique index is on the token and a
// registration re-points it at whoever is signed in now. A token the push service rejects as
// unregistered is marked 'revoked' rather than deleted, so a device that went quiet is
// distinguishable from one that was never there.
// Apple's side of Radar Pro. Kept out of `users` because an App Store subscription is not a
// Stripe one wearing a hat: it is keyed by Apple's originalTransactionId, it renews without us
// being asked, and its truth lives at Apple. `users.plan` is the entitlement this resolves to.
export const appleSubscriptions = sqliteTable(
  "apple_subscriptions",
  {
    originalTransactionId: text("original_transaction_id").primaryKey(),
    userId: text("user_id").notNull(),
    productId: text("product_id").notNull(),
    status: text("status").notNull(),
    // "Sandbox" or "Production". Both unlock Pro: App Review buys in the sandbox (app/appstore.ts).
    environment: text("environment").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_apple_subscriptions_user").on(t.userId)],
);

export const deviceTokens = sqliteTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("active"),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_device_tokens_token").on(t.token),
    index("idx_device_tokens_user").on(t.userId, t.status),
  ],
);

export const favorites = sqliteTable(
  "favorites",
  {
    userId: text("user_id").notNull(),
    dealId: text("deal_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_favorites_user_deal").on(t.userId, t.dealId),
    index("idx_favorites_deal").on(t.dealId),
  ],
);

export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id"),
    email: text("email"),
    type: text("type").notNull(),
    message: text("message").notNull(),
    dealId: text("deal_id"),
    market: text("market"),
    page: text("page").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    assignedTo: text("assigned_to"),
    resolution: text("resolution"),
    resolvedAt: text("resolved_at"),
    // Staff user id that closed it (drizzle/0072).
    resolvedBy: text("resolved_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_feedback_status_created").on(t.status, t.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    details: text("details"),
    actorRole: text("actor_role"),
    requestId: text("request_id"),
    reason: text("reason"),
    beforeValues: text("before_values"),
    afterValues: text("after_values"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_audit_created").on(t.createdAt)],
);

export const savedLocations = sqliteTable(
  "saved_locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    postal: text("postal").notNull(),
    radius: integer("radius").notNull().default(10),
    active: integer("active").notNull().default(1),
    isDefault: integer("is_default").notNull().default(0),
    latitude: real("latitude"),
    longitude: real("longitude"),
    city: text("city"),
    region: text("region"),
    country: text("country").notNull().default("CA"),
    timezone: text("timezone").notNull().default("America/Toronto"),
    preferences: text("preferences").notNull().default("{}"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_saved_locations_user").on(t.userId)],
);

export const dealLocations = sqliteTable(
  "deal_locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: text("deal_id").notNull(),
    locationId: text("location_id").notNull(),
    eligibility: text("eligibility").notNull().default("needs_review"),
    sourceUrl: text("source_url"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_deal_locations_unique").on(t.dealId, t.locationId),
    index("idx_deal_locations_location_eligibility").on(t.locationId, t.eligibility),
  ],
);

export const dealAliases = sqliteTable(
  "deal_aliases",
  {
    aliasId: text("alias_id").primaryKey(),
    canonicalDealId: text("canonical_deal_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_deal_aliases_canonical").on(t.canonicalDealId)],
);

export const searchTerms = sqliteTable(
  "search_terms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    term: text("term").notNull(),
    weight: integer("weight").notNull().default(10),
    source: text("source").notNull().default("generated"),
    locale: text("locale").notNull().default("en"),
  },
  (t) => [
    uniqueIndex("idx_search_terms_unique").on(t.entityType, t.entityId, t.term, t.locale),
    index("idx_search_terms_term_weight").on(t.term, t.weight),
    index("idx_search_terms_entity").on(t.entityType, t.entityId),
  ],
);

export const postalCache = sqliteTable(
  "postal_cache",
  {
    normalizedPostal: text("normalized_postal").primaryKey(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    neighborhood: text("neighborhood"),
    city: text("city").notNull(),
    region: text("region").notNull(),
    country: text("country").notNull(),
    timezone: text("timezone").notNull(),
    provider: text("provider").notNull(),
    // 'resolved' = real geocode; 'unsupported' = negative cache (both geocoders and the
    // offline fallback failed) — sentinel lat/lng/city/etc. below, never read back into a
    // real response. Prevents re-hitting Mapbox/Zippopotam for the same bad postal code.
    status: text("status").notNull().default("resolved"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_postal_cache_city").on(t.country, t.region, t.city)],
);

export const savedRestaurants = sqliteTable(
  "saved_restaurants",
  {
    userId: text("user_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    collection: text("collection"),
    notes: text("notes"),
    notificationsEnabled: integer("notifications_enabled").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_saved_restaurants_unique").on(t.userId, t.restaurantId)],
);

export const excludedRestaurants = sqliteTable(
  "excluded_restaurants",
  {
    userId: text("user_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_excluded_restaurants_unique").on(t.userId, t.restaurantId),
    index("idx_excluded_restaurants_user").on(t.userId),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    savedLocationId: integer("saved_location_id"),
    frequency: text("frequency").notNull().default("selected_days"),
    categories: text("categories").notNull().default("[]"),
    days: text("days").notNull().default("[1,2,3,4,5]"),
    deliveryTime: text("delivery_time").notNull().default("08:00"),
    timezone: text("timezone").notNull().default("America/Toronto"),
    quietHours: text("quiet_hours").notNull().default("{}"),
    enabled: integer("enabled").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_notification_preferences_due").on(t.enabled, t.deliveryTime, t.timezone)],
);

export const emailConsents = sqliteTable(
  "email_consents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    source: text("source").notNull(),
    policyVersion: text("policy_version").notNull(),
    language: text("language").notNull().default("en"),
    consentedAt: text("consented_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_email_consents_user_status").on(t.userId, t.status)],
);

export const emailSuppressions = sqliteTable(
  "email_suppressions",
  {
    email: text("email").primaryKey(),
    reason: text("reason").notNull(),
    providerEventId: text("provider_event_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const emailCampaigns = sqliteTable(
  "email_campaigns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    subject: text("subject").notNull(),
    previewText: text("preview_text"),
    segment: text("segment").notNull().default("{}"),
    scheduledAt: text("scheduled_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_email_campaigns_status_schedule").on(t.status, t.scheduledAt)],
);

export const emailCampaignSnapshots = sqliteTable(
  "email_campaign_snapshots",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    plainText: text("plain_text").notNull(),
    segment: text("segment").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_email_campaign_snapshots_campaign").on(t.campaignId, t.createdAt)],
);

export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id"),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull().default("queued"),
    errorCode: text("error_code"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_email_deliveries_user_created").on(t.userId, t.createdAt),
    uniqueIndex("idx_email_deliveries_provider").on(t.providerMessageId),
  ],
);

export const emailEvents = sqliteTable(
  "email_events",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id"),
    providerEventId: text("provider_event_id"),
    type: text("type").notNull(),
    payload: text("payload").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("idx_email_events_provider").on(t.providerEventId)],
);

export const emailJobRuns = sqliteTable(
  "email_job_runs",
  {
    id: text("id").primaryKey(),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
    status: text("status").notNull().default("running"),
    recipients: integer("recipients").notNull().default(0),
    details: text("details").notNull().default("{}"),
  },
);

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id"),
    email: text("email"),
    dealId: text("deal_id").notNull(),
    locationId: text("location_id"),
    category: text("category").notNull(),
    notes: text("notes"),
    sourceUrl: text("source_url"),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    assignedTo: text("assigned_to"),
    resolution: text("resolution"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
    // Staff user id that closed it (drizzle/0072).
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("idx_reports_status_priority").on(t.status, t.priority, t.createdAt)],
);

export const sponsorships = sqliteTable(
  "sponsorships",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    market: text("market").notNull(),
    status: text("status").notNull().default("draft"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    impressionLimit: integer("impression_limit"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    frequencyCap: integer("frequency_cap").notNull().default(1),
    contractReference: text("contract_reference"),
    invoiceReference: text("invoice_reference"),
    approvedBy: text("approved_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_sponsorships_market_status_dates").on(t.market, t.status, t.startsAt, t.endsAt)],
);

export const marketCoverage = sqliteTable(
  "market_coverage",
  {
    market: text("market").primaryKey(),
    region: text("region").notNull(),
    country: text("country").notNull(),
    status: text("status").notNull().default("researching"),
    minimumOffers: integer("minimum_offers").notNull().default(20),
    notes: text("notes"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const productEvents = sqliteTable(
  "product_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    type: text("type").notNull(),
    market: text("market"),
    entityId: text("entity_id"),
    properties: text("properties").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_product_events_type_created").on(t.type, t.createdAt),
    // deal_click rows are read per deal — the creator workspace and the restaurant portal both
    // group them by entity_id — and the type-first index above cannot serve that.
    index("idx_product_events_entity_type").on(t.entityId, t.type),
  ],
);

// Page views as counters, one row per day and combination (drizzle/0062_pageviews.sql, which is the
// source of truth: it is WITHOUT ROWID, which this builder cannot say). No row names a visitor.
export const pageviewsDaily = sqliteTable(
  "pageviews_daily",
  {
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    locale: text("locale").notNull(),
    country: text("country").notNull(),
    source: text("source").notNull(),
    views: integer("views").notNull().default(0),
  },
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: text("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [index("idx_rate_limits_window").on(t.windowStart)],
);

// A lightweight interest list for visitors who want deal alerts but haven't created an account —
// distinct from notification_preferences/email_consents, which require a real Clerk user_id.
// Captured leads are followed up manually or invited to complete real signup; this table never
// feeds the digest job directly.
export const emailLeads = sqliteTable(
  "email_leads",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    postal: text("postal"),
    source: text("source").notNull().default("homepage"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    confirmedAt: text("confirmed_at"),
    confirmationSentAt: text("confirmation_sent_at"),
    consentMethod: text("consent_method"),
  },
  (t) => [uniqueIndex("idx_email_leads_email").on(t.email)],
);

export const mutationKeys = sqliteTable(
  "mutation_keys",
  {
    key: text("key").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    response: text("response").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_mutation_keys_created").on(t.createdAt)],
);

// Machine-translated copy of a deal's free-text fields, one row per (deal, non-English locale).
// English itself is never stored here — the `deals` row already is the English copy. A field is
// left NULL when translation hasn't run yet or failed for that field, and callers fall back to
// the English `deals` value rather than showing a blank. `sourceUpdatedAt` is a copy of
// `deals.updated_at` taken at translation time; the translate job compares it against the live
// `deals.updated_at` to know a row is stale (edited since it was last translated) without needing
// a separate dirty flag on `deals` itself.
export const dealTranslations = sqliteTable(
  "deal_translations",
  {
    dealId: text("deal_id").notNull(),
    locale: text("locale").notNull(),
    title: text("title"),
    description: text("description"),
    schedule: text("schedule"),
    price: text("price"),
    terms: text("terms"),
    restrictions: text("restrictions"),
    sourceUpdatedAt: text("source_updated_at").notNull(),
    translatedAt: text("translated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("idx_deal_translations_deal_locale").on(t.dealId, t.locale),
  ],
);

// Hour-precision idempotency guard for the translation cron, mirroring `email_job_runs` (same
// "claim the row, skip if it already exists" pattern used by the digest job).
export const translationJobRuns = sqliteTable(
  "translation_job_runs",
  {
    id: text("id").primaryKey(),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
    status: text("status").notNull().default("running"),
    translated: integer("translated").notNull().default(0),
    details: text("details").notNull().default("{}"),
  },
);

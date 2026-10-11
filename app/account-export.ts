import { env } from "cloudflare:workers";

// "Download my data": everything Radar holds about the signed-in person, in one JSON file.
//
// PIPEDA principle 4.9 and Quebec's Law 25 (s. 27, and the portability right in force since
// 2024) give a person the right to the personal information an organization holds about them.
// The export is how Radar answers that without a support ticket, so it has to be complete: a
// table that is left out is a quiet "no" to a request nobody gets to see.
//
// Every table with a user_id column is read here. tests/account-export.test.mjs checks that
// against the migrations, the same way tests/account-deletion.test.mjs checks the deletion list,
// so a new table holding personal rows fails the build until it is exported.
//
// What is left out, on purpose, falls into three groups:
//
//   - Credentials and processor references: push tokens, Clerk subjects, Stripe customer,
//     subscription, account, transfer and payout ids, Apple transaction ids. They identify the
//     person to another system rather than describe them, and a downloaded file is easy to leak.
//     The billing record itself lives at Stripe or Apple, where the person can already see it.
//   - Other people: the staff member who reviewed, assigned or granted something, and, in a
//     creator's commissions, the subscriber and invoice each one came from.
//   - Internal triage: priority, assignee, and staff notes on a creator profile. These are
//     working fields for the review queue, not information about the person.

type Row = Record<string, unknown>;

const many = async (sql: string, ...binds: unknown[]): Promise<Row[]> =>
  (await env.DB.prepare(sql).bind(...binds).all<Row>()).results ?? [];

/** Builds the export for one account, or null when the account no longer exists. */
export async function buildAccountExport(userId: string) {
  const profile = await env.DB.prepare(
    `SELECT id,email,name,role,status,home_postal,language,timezone,country,distance_unit,theme,accent_color,
       alert_days,alert_time,alerts_enabled,plan,plan_status,past_due_since,paused_until,trial_used,winback_sent_at,
       referred_by,referred_campaign,created_at
     FROM users WHERE id=?`,
  ).bind(userId).first<Row>();
  if (!profile) return null;
  const email = String(profile.email ?? "");

  // A creator's commissions and payouts are keyed by handle, not user_id, so they follow the profile.
  const creator = await env.DB.prepare(
    "SELECT handle,display_name,status,commission_rate_bps,payouts_enabled,requirements_due,created_at,updated_at FROM creator_profiles WHERE user_id=?",
  ).bind(userId).first<Row>();
  const handle = creator ? String(creator.handle) : null;

  const [
    signInMethods, permissions, favorites, trackedAreas, savedRestaurants, excludedRestaurants,
    notificationPreferences, emailConsentHistory, emailDeliveryHistory, emailSignups, emailSuppressions,
    devices, appleSubscriptions, planGrants, cancellationReasons, saveOffers, suggestions, reports,
    feedback, restaurantAccess, creatorApplications, referralCredits, activity,
    creatorCommissions, creatorPayouts,
  ] = await Promise.all([
    many("SELECT provider,verified_email,created_at FROM auth_identities WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT permission,created_at FROM user_permissions WHERE user_id=? ORDER BY permission", userId),
    many("SELECT deal_id,created_at FROM favorites WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT label,postal,radius,city,region,country,latitude,longitude,timezone,preferences,is_default,active,sort_order,created_at FROM saved_locations WHERE user_id=? ORDER BY sort_order,created_at", userId),
    many("SELECT restaurant_id,collection,notes,notifications_enabled,created_at FROM saved_restaurants WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT restaurant_id,created_at FROM excluded_restaurants WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT frequency,categories,days,delivery_time,timezone,quiet_hours,enabled,created_at,updated_at FROM notification_preferences WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT email,status,source,policy_version,language,consented_at,revoked_at,created_at FROM email_consents WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT email,status,error_code,sent_at,created_at FROM email_deliveries WHERE user_id=? ORDER BY created_at", userId),
    // The pre-account interest list and the do-not-email list are keyed by address, not account.
    many("SELECT email,postal,source,consent_method,confirmation_sent_at,confirmed_at,created_at FROM email_leads WHERE lower(email)=lower(?)", email),
    many("SELECT email,reason,created_at FROM email_suppressions WHERE lower(email)=lower(?)", email),
    many("SELECT platform,status,last_seen_at,created_at FROM device_tokens WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT product_id,status,environment,expires_at,created_at,updated_at FROM apple_subscriptions WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT reason,expires_at,revoked_at,created_at FROM plan_grants WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT reason,detail,plan_status,created_at FROM cancellation_reasons WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT reason,offer,accepted,created_at FROM save_offers WHERE user_id=? ORDER BY created_at", userId),
    many(
      `SELECT reference,restaurant,restaurant_website,address,title,deal,description,price,postal,schedule,eligible_days,start_time,end_time,
         starts_at,expires_at,restrictions,source,relationship,email,status,rejection_reason,created_at,updated_at
       FROM suggestions WHERE user_id=? ORDER BY created_at`,
      userId,
    ),
    many("SELECT deal_id,location_id,category,notes,source_url,email,status,resolution,created_at,resolved_at FROM reports WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT type,message,deal_id,market,page,email,status,resolution,created_at,resolved_at FROM feedback WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT restaurant_id,invited_email,status,created_at,accepted_at,revoked_at FROM restaurant_managers WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT requested_handle,email,channel_url,audience,pitch,status,rejection_reason,reviewed_at,created_at,updated_at FROM creator_applications WHERE user_id=? ORDER BY created_at", userId),
    // As a subscriber: which creator's link was credited for their payments. The amounts are the
    // creator's earnings, not the subscriber's information, so only the attribution is shown.
    many("SELECT handle,campaign,created_at FROM creator_commissions WHERE user_id=? ORDER BY created_at", userId),
    many("SELECT type,market,entity_id,properties,created_at FROM product_events WHERE user_id=? ORDER BY created_at", userId),
    // As a creator: what they earned and were paid, without the subscriber or invoice behind each row.
    handle
      ? many("SELECT campaign,gross_amount,currency,rate_bps,commission_amount,status,rejection_reason,approved_at,created_at,paid_at FROM creator_commissions WHERE handle=? ORDER BY created_at", handle)
      : Promise.resolve([]),
    handle
      ? many("SELECT amount,currency,status,commission_count,failure_reason,created_at,updated_at,paid_at FROM creator_payouts WHERE handle=? ORDER BY created_at", handle)
      : Promise.resolve([]),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    signInMethods,
    permissions,
    subscription: { appleSubscriptions, planGrants, cancellationReasons, saveOffers },
    favorites,
    trackedAreas,
    savedRestaurants,
    excludedRestaurants,
    notificationPreferences,
    emailConsentHistory,
    emailDeliveryHistory,
    emailSignups,
    emailSuppressions,
    devices,
    suggestions,
    reports,
    feedback,
    restaurantAccess,
    referralCredits,
    creator: { profile: creator ?? null, applications: creatorApplications, commissions: creatorCommissions, payouts: creatorPayouts },
    activity,
  };
}

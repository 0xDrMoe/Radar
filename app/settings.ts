import { env } from "cloudflare:workers";

/**
 * Operator switches that take effect without a deploy.
 *
 * Environment variables are the right home for a secret and the wrong one for something somebody
 * wants to turn on for a weekend: changing one needs a deploy, a deploy needs CI, and CI is minutes.
 * These live in `app_settings` and change the moment they are saved.
 *
 * The allow-list below is what makes the table safe. A key that is not in it means nothing, so a
 * stray row cannot become a feature flag nobody knows about, and a typo in the admin workspace is
 * refused rather than written.
 */

export const SETTINGS = {
  /**
   * Whether a new subscriber is offered a free trial.
   *
   * Off by default, on purpose. A trial is a standing giveaway when it is left on and forgotten —
   * the point of putting it here is that it can be switched on for a launch, a press mention or a
   * creator's video, and switched off again the same day.
   *
   * Turning it off does not touch anybody already trialing: Stripe owns the running subscription,
   * `trialing` stays an entitled status, and their trial finishes the way it was sold to them.
   */
  trials_enabled: { type: "boolean", default: false, label: "Free trials for new subscribers" },
} as const;

export type SettingKey = keyof typeof SETTINGS;

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SETTINGS, value);
}

/**
 * Read every setting, with defaults filled in for keys nothing has written yet.
 *
 * One query rather than one per key: there are a handful of them and every caller that wants one
 * generally wants to show all of them. A missing row is not an error — it means "never changed from
 * the default", which is the ordinary state of a switch that has never been used.
 */
export async function readSettings(): Promise<Record<SettingKey, boolean>> {
  const stored = await env.DB.prepare("SELECT key,value FROM app_settings").all<{ key: string; value: string }>();
  const byKey = new Map((stored.results || []).map((row) => [row.key, row.value]));
  const resolved = {} as Record<SettingKey, boolean>;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const raw = byKey.get(key);
    resolved[key] = raw === undefined ? SETTINGS[key].default : raw === "true";
  }
  return resolved;
}

/**
 * One setting, for the code paths that only care about one.
 *
 * Falls back to the default when the row is missing *and* when the read fails. A switch whose
 * storage is unavailable should behave like a switch that was never touched, not take down the
 * checkout it gates.
 */
export async function readSetting(key: SettingKey): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind(key).first<{ value: string }>();
    return row ? row.value === "true" : SETTINGS[key].default;
  } catch {
    return SETTINGS[key].default;
  }
}

/** Write one setting. The caller has already checked the permission; this only checks the key. */
export async function writeSetting(key: SettingKey, value: boolean, actorId: string) {
  await env.DB.prepare(
    `INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
  ).bind(key, value ? "true" : "false", actorId).run();
}

import { env } from "cloudflare:workers";

// Apple's App Store Server API, and the one rule this file exists to enforce: nothing a client
// sends is evidence of anything.
//
// A purchase arrives as a signed JWS, and the documented way to trust it is to verify that
// signature against Apple's certificate chain — parsing x5c, walking to the Apple Root CA,
// checking validity windows — in a Worker, by hand, correctly, forever. Getting that subtly wrong
// does not fail loudly; it grants Radar Pro to anyone who can craft a payload.
//
// So it is not done. The device sends a transaction id and nothing else, and the server asks Apple
// what that transaction actually is, over TLS, authenticated with our own key. The answer is
// Apple's, and the only thing the client influenced is which id was looked up. The same applies to
// App Store Server Notifications: the POST body is treated purely as a nudge saying "something
// changed, go and ask" — its contents are never believed, so its signature never has to be.
//
// The cost is one round trip to Apple per purchase and per notification. That is a good trade for
// deleting an entire class of "we verified it wrong" bugs.

const PRODUCTION = "https://api.storekit.itunes.apple.com";
const SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";

function runtime() { return env as unknown as Record<string, string>; }

export function appStoreConfigured() {
  const value = runtime();
  return Boolean(value.APPLE_IAP_KEY_ID && value.APPLE_IAP_ISSUER_ID && value.APPLE_IAP_PRIVATE_KEY && value.APPLE_IAP_BUNDLE_ID);
}


function base64url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The .p8 Apple hands out, as a key WebCrypto will sign with.
 *
 * Everything outside the base64 alphabet is stripped rather than just the PEM headers and
 * whitespace. The key reaches the Worker by being piped through a shell into `wrangler secret put`,
 * and a byte-order mark, a stray carriage return or a smart quote picked up on the way all break
 * atob() — at the point of a purchase, as an unexplained failure, long after anyone would connect
 * it to how the secret was pasted.
 */
async function signingKey() {
  const pem = runtime().APPLE_IAP_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const der = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0));
    // importKey is inside the try as well: base64 that decodes but is not a PKCS#8 EC key fails
    // here, and it is the same mistake with the same fix.
    return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch {
    throw new Error("APPLE_IAP_PRIVATE_KEY is not a readable .p8 — re-set the secret from the file Apple issued.");
  }
}

/**
 * The bearer token the App Store Server API wants: ES256, our key, twenty minutes.
 *
 * Not cached. A Worker isolate may serve one request or thousands and holding a token across them
 * saves a signature that takes under a millisecond, in exchange for a class of bug where an expired
 * token is reused and every purchase fails until the isolate recycles.
 */
async function bearerToken() {
  const value = runtime();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: value.APPLE_IAP_KEY_ID, typ: "JWT" };
  const payload = {
    iss: value.APPLE_IAP_ISSUER_ID,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
    bid: value.APPLE_IAP_BUNDLE_ID,
  };
  const body = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await signingKey(),
    new TextEncoder().encode(body),
  );
  return `${body}.${base64url(signature)}`;
}

/**
 * Reads the payload of a JWS without verifying it.
 *
 * Safe only because of where these come from: Apple's own API over TLS, authenticated with our
 * key. Never call this on something a client sent.
 */
function decodeSignedPayload<T>(jws: string): T | null {
  const segment = jws.split(".")[1];
  if (!segment) return null;
  try {
    const json = atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

type StatusResponse = {
  environment?: string;
  bundleId?: string;
  data?: Array<{
    lastTransactions?: Array<{
      originalTransactionId?: string;
      status?: number;
      signedTransactionInfo?: string;
      signedRenewalInfo?: string;
    }>;
  }>;
};

type TransactionInfo = {
  originalTransactionId?: string;
  appAccountToken?: string;
  productId?: string;
  expiresDate?: number;
  bundleId?: string;
  environment?: string;
  revocationDate?: number;
};

/** What Apple says about a subscription, in the only terms this app cares about. */
export type AppleSubscription = {
  originalTransactionId: string;
  productId: string;
  /** Apple's numeric status: 1 active, 2 expired, 3 in billing retry, 4 in grace period, 5 revoked. */
  status: number;
  environment: string;
  expiresAt: string | null;
  /** Whether this should currently unlock Pro. Grace period counts; billing retry does not. */
  entitled: boolean;
  /** The account the app said it was buying for (appAccountTokenFor), or null for older builds. */
  appAccountToken: string | null;
};

/**
 * The UUID the app passes to StoreKit as `appAccountToken` when this account buys Pro.
 *
 * Apple signs it into the transaction, so the server can tell which Radar account a purchase was
 * made for instead of believing whichever signed-in account reports the transaction id first. Derived
 * from the user id rather than stored: the same account always gets the same token, on any device,
 * with no column to keep. It is not a secret - knowing it lets nobody claim anything, since a
 * purchase can only carry the token the buyer's app put in it.
 */
export async function appAccountTokenFor(userId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`radar-app-account:${userId}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5 (name-based, SHA)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ENTITLING = new Set([1, 4]);

/**
 * Asks Apple about one transaction, trying production first and falling back to sandbox.
 *
 * The fallback is not optional and is the classic way an IAP integration passes review and then
 * fails in the wild, or the reverse: App Review tests against sandbox with a production build, and
 * Apple's own guidance is to try production and re-try sandbox on the 4040010 "not found" error.
 */
export async function subscriptionStatus(transactionId: string): Promise<AppleSubscription | null> {
  if (!appStoreConfigured()) return null;
  const token = await bearerToken();
  for (const host of [PRODUCTION, SANDBOX]) {
    const response = await fetch(`${host}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) continue;
    if (!response.ok) return null;
    const body = (await response.json()) as StatusResponse;
    const last = body.data?.[0]?.lastTransactions?.[0];
    if (!last?.signedTransactionInfo) return null;
    const info = decodeSignedPayload<TransactionInfo>(last.signedTransactionInfo);
    if (!info) return null;

    // The bundle id is checked because the key is ours but the transaction id came from a client.
    // Without this, a transaction from any other app of ours would unlock Radar Pro.
    if (info.bundleId && info.bundleId !== runtime().APPLE_IAP_BUNDLE_ID) return null;

    const environment = info.environment || body.environment || (host === SANDBOX ? "Sandbox" : "Production");
    const status = last.status ?? 0;
    return {
      originalTransactionId: last.originalTransactionId || info.originalTransactionId || transactionId,
      productId: info.productId || "",
      status,
      environment,
      expiresAt: info.expiresDate ? new Date(info.expiresDate).toISOString() : null,
      // Either environment. App Review buys Pro in Apple's sandbox, with the build the App Store
      // ships, and a purchase that unlocks nothing there is a rejection. Nobody can buy in the
      // sandbox from the App Store: only App Review, TestFlight testers and the sandbox accounts
      // made in App Store Connect, whose purchases are free. The status still decides - billing
      // retry, expired and revoked unlock nothing in either.
      entitled: ENTITLING.has(status) && !info.revocationDate,
      appAccountToken: info.appAccountToken ? info.appAccountToken.toLowerCase() : null,
    };
  }
  return null;
}

/**
 * The transaction id inside a server notification, read without trusting anything else in it.
 *
 * The id is only ever used to look the subscription up at Apple and to match a row we already
 * wrote, so a forged notification can at worst make us re-ask Apple about a real subscription and
 * write down the answer Apple gave.
 */
export function transactionIdFromNotification(signedPayload: string): string | null {
  const payload = decodeSignedPayload<{ data?: { signedTransactionInfo?: string } }>(signedPayload);
  const info = payload?.data?.signedTransactionInfo ? decodeSignedPayload<TransactionInfo>(payload.data.signedTransactionInfo) : null;
  return info?.originalTransactionId || null;
}

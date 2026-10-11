import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { code } from "./source.mjs";

// The lead list, and the two ways a "we'll let you know" turns into spam.
//
// There are two forms on the homepage posting to one endpoint: a digest signup ("hear about
// nearby deals") and the iPhone waitlist ("hear when the app ships"). They are different
// promises. Under CASL each send has to go to people who consented to that message, so the only
// thing separating a welcome email from an unsolicited one is the `source` column being right.
//
// These tests hold the two properties that keep it right: the column can only ever contain a
// value we know how to honor, and a second signup cannot quietly move somebody off the list
// they joined.

const route = code(await readFile(new URL("../app/api/email/capture/route.ts", import.meta.url), "utf8"));
const home = code(await readFile(new URL("../app/HomeClient.tsx", import.meta.url), "utf8"));

test("the source is a closed set, not whatever the client sends", () => {
  // Without the allowlist, a typo in the client — or anyone posting to the endpoint — creates a
  // segment no campaign targets, so those people are collected and then never heard from, or
  // worse, swept into a send meant for a different audience.
  assert.match(route, /const SOURCES = new Set\(\[/);
  assert.match(route, /SOURCES\.has\(String\(body\.source \|\| ""\)\)\s*\?\s*String\(body\.source\)\s*:\s*"homepage"/);
});

test("both lists the UI can write are ones the endpoint accepts", () => {
  // The failure this prevents is silent: the form posts a source the server does not recognize,
  // every signup lands in "homepage", and nobody notices until launch day when the waitlist is
  // empty.
  const allowed = new Set(
    [...route.matchAll(/const SOURCES = new Set\(\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((inner) => inner[1])),
  );
  assert.ok(allowed.size >= 2, "the allowlist could not be read");
  for (const [, sent] of home.matchAll(/source:\s*"([^"]+)"/g)) {
    assert.ok(allowed.has(sent), `the homepage posts source "${sent}", which the endpoint rejects`);
  }
});

test("signing up twice does not move you off the list you joined", () => {
  // Someone joins the app waitlist, then later types their address into the digest form. The
  // upsert must not rewrite their source, or they drop off the launch list on the day it sends.
  assert.ok(
    !/ON CONFLICT\(email\) DO UPDATE SET[^"]*source=/.test(route),
    "the upsert overwrites source, dropping people off the list they first joined",
  );
  // And a later signup that carries no postal must not erase the one already stored.
  assert.match(route, /postal=COALESCE\(excluded\.postal,email_leads\.postal\)/);
});

test("the waitlist is offered to signed-in people too", () => {
  // The digest form is deliberately signed-out only, because signing in is the better version of
  // it. The waitlist is not: having an account says nothing about wanting an email when the app
  // ships, and account holders are the likeliest day-one installs. So the app teaser must not sit
  // inside a `session ?` branch the way the digest form does.
  const teaser = home.indexOf('className="app-teaser"');
  assert.ok(teaser > 0, "the app teaser section is gone");
  const form = home.indexOf("captureAppLead", teaser);
  const section = home.slice(teaser, form > 0 ? form : teaser + 2000);
  assert.ok(!/\bsession \?/.test(section), "the waitlist is hidden from signed-in visitors");
});

test("what the waitlist is for is stated where consent is given", () => {
  // CASL: consent is only express if the person was told what they were consenting to, at the
  // point they gave it — not in a policy page they did not open.
  assert.match(home, /appTeaser\.leadCaptureConsent/);
});

test("the capture endpoint still refuses what it always refused", () => {
  // Adding a parameter is a good moment to drop a guard by accident. All four of these predate
  // the waitlist and none of them is optional on a public unauthenticated write.
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /rateLimit\(await clientKey\("email-capture"\)/);
  assert.match(route, /verifyTurnstile\(request/);
  assert.match(route, /email\.length > 254 \|\| !\/\^\[\^\\s<>\]\+@/);
});

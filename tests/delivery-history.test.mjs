import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/delivery-history.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { deliveryReason, deliveryState, deliveryTone } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("every status the send path and the webhook can write has a label", () => {
  // These are the exact values written by app/api/jobs/digests, app/api/user, and the Resend
  // webhook. If one of those learns a new status, this list is where it has to be taught.
  for (const status of ["queued", "sent", "delivered", "bounced", "complained", "delayed", "failed"]) {
    assert.equal(deliveryState(status), status);
  }
});

test("an unrecognised status understates rather than alarming", () => {
  assert.equal(deliveryState("scheduled"), "sent");
  assert.equal(deliveryState(null), "sent");
  assert.equal(deliveryState(undefined), "sent");
});

test("tone separates arrived, in flight, and did not arrive", () => {
  assert.equal(deliveryTone("delivered"), "good");
  assert.equal(deliveryTone("queued"), "pending");
  assert.equal(deliveryTone("sent"), "pending");
  assert.equal(deliveryTone("delayed"), "warn");
  for (const state of ["bounced", "complained", "failed"]) assert.equal(deliveryTone(state), "bad");
});

test("raw provider errors bucket into something a person can read", () => {
  assert.equal(deliveryReason("550 5.1.1 The email account that you tried to reach does not exist"), "rejected");
  assert.equal(deliveryReason("Recipient mailbox is full"), "rejected");
  assert.equal(deliveryReason("Too many requests"), "throttled");
  assert.equal(deliveryReason("429"), "throttled");
  assert.equal(deliveryReason("fetch failed"), "unreachable");
  assert.equal(deliveryReason("Request timed out"), "unreachable");
  assert.equal(deliveryReason("Address is on the suppression list"), "suppressed");
  assert.equal(deliveryReason("UNKNOWN"), "unknown");
});

test("no error means no reason line at all", () => {
  assert.equal(deliveryReason(null), null);
  assert.equal(deliveryReason(""), null);
});

test("the three locales all translate the closed vocabulary", async () => {
  const states = ["queued", "sent", "delivered", "delayed", "bounced", "complained", "failed"];
  const reasons = ["suppressed", "rejected", "throttled", "unreachable", "unknown"];
  for (const locale of ["en", "fr", "es"]) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
    const history = messages.dashboard.history;
    for (const state of states) assert.ok(history.state[state], `${locale} is missing state.${state}`);
    for (const reason of reasons) assert.ok(history.reason[reason], `${locale} is missing reason.${reason}`);
    for (const key of ["opened", "timeUnknown", "approximate"]) assert.ok(history[key], `${locale} is missing ${key}`);
  }
});

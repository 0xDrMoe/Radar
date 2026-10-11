import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The admission gate's bookkeeping (worker/admission.ts), run rather than read, on a clock the test
// moves by hand. Its wiring into the Worker - the heartbeat timer, the release in `finally` - is
// exercised against the build in tests/worker-reliability.test.mjs.
const load = async () => {
  const source = await readFile(new URL("../worker/admission.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(`${compiled}\n// ${Math.random()}`).toString("base64")}`);
};

const MAX_AGE = 10_000;

function fill(gate, now) {
  const ids = [];
  for (let slot = 0; slot < 12; slot += 1) {
    const id = gate.admit(now);
    assert.notEqual(id, null, `slot ${slot + 1} of 12 is admitted`);
    ids.push(id);
  }
  return ids;
}

test("twelve at once, and the thirteenth is refused until one is given back", async () => {
  const { createAdmissionGate, MAX_CONCURRENT_REQUESTS } = await load();
  assert.equal(MAX_CONCURRENT_REQUESTS, 12);
  const gate = createAdmissionGate(MAX_AGE);
  const ids = fill(gate, 0);
  assert.equal(gate.admit(10), null);
  gate.release(ids[3]);
  assert.notEqual(gate.admit(20), null, "a released slot is free at once");
  assert.equal(gate.admit(30), null);
});

// A request the runtime kills for CPU never runs its `finally`, so its slot used to be held until it
// aged out. A run of killed requests left the isolate answering OVERLOADED with nothing in flight.
// A killed request's heartbeat dies with it, and its slot goes with that.
test("slots whose requests have stopped beating are let go within STALE_AFTER_MS", async () => {
  const { createAdmissionGate, STALE_AFTER_MS, HEARTBEAT_MS } = await load();
  assert.ok(STALE_AFTER_MS >= 3 * HEARTBEAT_MS, "a live request can miss a beat or two without losing its slot");
  assert.ok(STALE_AFTER_MS <= 2_000, "a killed request's slot comes back within two seconds");
  const gate = createAdmissionGate(MAX_AGE);
  fill(gate, 0);
  assert.equal(gate.admit(STALE_AFTER_MS), null, "not before the window has passed");
  assert.notEqual(gate.admit(STALE_AFTER_MS + 1), null, "all twelve quiet slots are gone just after it");
  assert.equal(gate.inFlight(STALE_AFTER_MS + 1), 1);
});

test("a live request keeps its slot however long it runs, up to the age limit", async () => {
  const { createAdmissionGate, HEARTBEAT_MS } = await load();
  const gate = createAdmissionGate(MAX_AGE);
  const ids = fill(gate, 0);
  // Twelve slow requests, each beating on time: the isolate stays full, which is the protection the
  // gate exists for, whatever the heartbeat is for.
  for (let now = HEARTBEAT_MS; now < MAX_AGE; now += HEARTBEAT_MS) {
    for (const id of ids) gate.beat(id, now);
    assert.equal(gate.admit(now), null, `still refused at ${now} ms`);
  }
  // Past the age limit even a live slot is dropped, as before (worker/index.ts says why).
  for (const id of ids) gate.beat(id, MAX_AGE + 1);
  assert.notEqual(gate.admit(MAX_AGE + 1), null);
});

test("a late beat is tolerated; a beat for a slot already let go changes nothing", async () => {
  const { createAdmissionGate, STALE_AFTER_MS } = await load();
  const gate = createAdmissionGate(MAX_AGE);
  const ids = fill(gate, 0);
  // Every live request's timer runs late on a busy isolate: still inside the window, still held.
  for (const id of ids) gate.beat(id, STALE_AFTER_MS - 100);
  assert.equal(gate.admit(STALE_AFTER_MS + 500), null);
  // One request goes quiet from here on and is let go; the others keep beating.
  for (const id of ids.slice(1)) gate.beat(id, 2 * STALE_AFTER_MS - 200);
  const replacement = gate.admit(2 * STALE_AFTER_MS);
  assert.notEqual(replacement, null);
  assert.equal(gate.beat(ids[0], 2 * STALE_AFTER_MS + 1), false, "its heartbeat is told to stop");
  assert.equal(gate.inFlight(2 * STALE_AFTER_MS + 1), 12, "the dropped slot does not come back");
  assert.equal(gate.admit(2 * STALE_AFTER_MS + 2), null);
});

// A heartbeat that outlives its slot keeps nothing alive but the request, and a request that never
// answers should not be kept alive: the runtime ends a request that has hung only when it has
// nothing left pending, and a live interval is something pending. So a beat says when to stop.
test("a beat says whether to keep beating: yes while the slot is held, no once it is gone", async () => {
  const { createAdmissionGate, HEARTBEAT_MS, STALE_AFTER_MS } = await load();
  const gate = createAdmissionGate(MAX_AGE);
  const [released, aged, live] = [gate.admit(0), gate.admit(0), gate.admit(0)];
  assert.equal(gate.beat(live, HEARTBEAT_MS), true);
  gate.release(released);
  assert.equal(gate.beat(released, HEARTBEAT_MS), false, "given back");
  // Held right up to the age limit while it beats, and not a moment past it.
  for (let now = HEARTBEAT_MS; now <= MAX_AGE; now += HEARTBEAT_MS) assert.equal(gate.beat(aged, now), true, `held at ${now} ms`);
  assert.equal(gate.beat(aged, MAX_AGE + 1), false, "past the age limit");
  assert.equal(gate.inFlight(MAX_AGE + 1), 0, "and none of the three is counted any more");
  // A slot let go for going quiet stays gone, whatever its request does next.
  const quiet = gate.admit(MAX_AGE + 1);
  assert.equal(gate.inFlight(MAX_AGE + 2 + STALE_AFTER_MS), 0);
  assert.equal(gate.beat(quiet, MAX_AGE + 2 + STALE_AFTER_MS), false, "let go");
});

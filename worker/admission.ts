// The admission gate's bookkeeping: which requests this isolate is working on right now.
//
// Kept apart from worker/index.ts, and free of imports, so tests can load it on its own (the entry
// imports vinext's handler, which plain Node cannot). worker/index.ts says why the gate exists and
// where each piece is used.
//
// The gap it has to close is a request the runtime kills. A request that goes over the platform's
// CPU allowance is ended by the runtime without its `finally` ever running, so the slot it was
// admitted into is never given back. Were slots dropped only by age, an isolate that had just had
// a run of killed requests would keep refusing every request as OVERLOADED until they aged out,
// with nothing at all in flight: one kind of failure turned into a second, longer one.
//
// So a request that is alive says so. While it holds a slot it touches it every HEARTBEAT_MS, from a
// timer of its own; a request the runtime kills loses its timers with it, and its slot goes quiet.
// A slot that has been quiet for STALE_AFTER_MS is let go. (Were a killed request's timer ever to
// outlive it, its slot would simply age out at MAX_REQUEST_AGE_MS, exactly as every slot did
// before.) A live request that keeps beating keeps its slot however long it takes, up to
// MAX_REQUEST_AGE_MS as before - so MAX_CONCURRENT_REQUESTS slow requests still fill the isolate
// and the next one is still refused, which is the protection the gate is for.
//
// A beat also says whether to keep beating: false once the slot is gone - given back, let go, or
// past the age limit. The heartbeat stops there, because nothing depends on it any more, and a
// timer left running would keep a request that has hung from ever looking hung to the runtime,
// which otherwise ends such a request itself.
//
// STALE_AFTER_MS is four beats, not one, because a timer is a turn of the event loop like any other:
// on a busy isolate a live request's beat can be late by however much work is queued ahead of it.
// A full isolate's worth of renders at the worst CPU cost a request can spend before the runtime
// kills it queues well inside that margin.

export const MAX_CONCURRENT_REQUESTS = 12;
export const HEARTBEAT_MS = 500;
export const STALE_AFTER_MS = 2_000;

type Slot = { startedAt: number; seenAt: number };

export type AdmissionGate = {
  /** A slot id for a request starting now, or null when the isolate is full. */
  admit(now: number): number | null;
  /** A live request's proof of life. False when its slot is gone and the heartbeat should stop. */
  beat(id: number, now: number): boolean;
  /** Gives a slot back. Every admitted request that finishes calls this. */
  release(id: number): void;
  /** Slots held after dropping the dead ones, for tests and logs. */
  inFlight(now: number): number;
};

/**
 * @param maxAgeMs  How long any slot may be held, alive or not. worker/index.ts passes the render
 *   deadline plus a margin: a page render always answers by then (the render watchdog), so an older
 *   slot is a request the runtime killed, or an /api request that has run past anything normal.
 */
export function createAdmissionGate(
  maxAgeMs: number,
  { max = MAX_CONCURRENT_REQUESTS, staleAfterMs = STALE_AFTER_MS }: { max?: number; staleAfterMs?: number } = {},
): AdmissionGate {
  let nextId = 0;
  const slots = new Map<number, Slot>();
  const prune = (now: number) => {
    for (const [id, slot] of slots) {
      if (now - slot.startedAt > maxAgeMs || now - slot.seenAt > staleAfterMs) slots.delete(id);
    }
  };
  return {
    admit(now) {
      prune(now);
      if (slots.size >= max) return null;
      const id = nextId++;
      slots.set(id, { startedAt: now, seenAt: now });
      return id;
    },
    beat(id, now) {
      const slot = slots.get(id);
      if (!slot) return false;
      // The same age limit prune applies; a slot past it would be dropped at the next admission.
      if (now - slot.startedAt > maxAgeMs) {
        slots.delete(id);
        return false;
      }
      if (now > slot.seenAt) slot.seenAt = now;
      return true;
    },
    release(id) {
      slots.delete(id);
    },
    inFlight(now) {
      prune(now);
      return slots.size;
    },
  };
}

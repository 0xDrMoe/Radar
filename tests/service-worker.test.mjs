import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { code } from "./source.mjs";

// public/sw.js, run rather than read: its event handlers are loaded into a stand-in for a service
// worker's global scope — Cache Storage, fetch, cookieStore — and handed navigations.
//
// Version 1 stored every page it navigated to, forever, in one cache: signed-in dashboard, admin,
// affiliate and portal pages stayed on the device after sign-out, and a 503 or other error page
// could replace the good copy of a page and be replayed offline. The rules now are: only a 200 HTML
// page that the server did not mark no-store, outside the private areas, fetched without a session.
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

// A same-origin fetch in a browser has type "basic"; a Response built in Node says "default", and
// so does any clone of it. The worker checks the type, so the stand-in has to tell the truth.
class BasicResponse extends Response {
  get type() { return "basic"; }
  clone() { return Object.setPrototypeOf(super.clone(), BasicResponse.prototype); }
}

function page(body, { status = 200, cacheControl = "private, no-cache", type = "text/html; charset=utf-8" } = {}) {
  return new BasicResponse(body, { status, headers: { "content-type": type, "cache-control": cacheControl } });
}

function cacheStorage() {
  const named = new Map();
  const keyOf = (request) => (typeof request === "string" ? new URL(request, "https://radar.cheap").href : request.url);
  const open = async (name) => {
    if (!named.has(name)) named.set(name, new Map());
    const store = named.get(name);
    return {
      async put(request, response) {
        const key = keyOf(request);
        store.delete(key);
        store.set(key, response);
      },
      async match(request, options = {}) {
        const key = keyOf(request);
        if (store.has(key)) return store.get(key).clone();
        if (options.ignoreSearch) {
          const bare = key.split("?")[0];
          for (const [stored, response] of store) if (stored.split("?")[0] === bare) return response.clone();
        }
        return undefined;
      },
      async keys() { return [...store.keys()].map((url) => ({ url })); },
      async delete(request) { return store.delete(keyOf(request)); },
    };
  };
  return {
    named,
    api: {
      open,
      keys: async () => [...named.keys()],
      delete: async (name) => named.delete(name),
      match: async (request) => {
        for (const name of named.keys()) {
          const hit = await (await open(name)).match(request);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
}

// Loads sw.js into a fresh scope. `network` answers each fetch; `session` is what cookieStore says.
function serviceWorker({ origin = "https://radar.cheap", network, session = false, cookieStore = true } = {}) {
  const listeners = {};
  const storage = cacheStorage();
  const self = {
    location: new URL(origin),
    addEventListener: (type, listener) => { listeners[type] = listener; },
    skipWaiting() {},
    clients: { claim() {} },
    cookieStore: cookieStore ? { get: async (name) => (session && name === "__session" ? { name, value: "token" } : null) } : undefined,
  };
  new Function("self", "caches", "fetch", "Response", SOURCE)(self, storage.api, network, Response);

  async function dispatch(type, fields) {
    const pending = [];
    let responded;
    listeners[type]({
      ...fields,
      respondWith(promise) { responded = Promise.resolve(promise); },
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    });
    let response = responded ? await responded : undefined;
    // The browser reads the page it was given. That matters here: the worker stores from a clone,
    // and canceling one branch of a clone settles only once the other branch has been read.
    if (response && response.type !== "error") {
      const { status, headers } = response;
      response = new Response(await response.text(), { status, headers });
    }
    // waitUntil can be called from inside the respondWith chain, so keep draining.
    while (pending.length) await pending.shift();
    return response;
  }

  return {
    storage,
    navigate: (path) => dispatch("fetch", { request: { url: new URL(path, origin).href, method: "GET", mode: "navigate" } }),
    activate: () => dispatch("activate", {}),
    message: (data) => dispatch("message", { data }),
    // Every cache, not just the one pages are meant to go in: a page stored anywhere is stored.
    pages: () => [...storage.named.values()].flatMap((store) => [...store.keys()]).map((url) => new URL(url).pathname + new URL(url).search),
  };
}

test("an anonymous public page is stored for reading offline", async () => {
  const sw = serviceWorker({ network: async () => page("<html>deal</html>") });
  const response = await sw.navigate("/en/deals/some-deal");
  assert.equal(await response.text(), "<html>deal</html>", "the visitor gets the network response");
  assert.deepEqual(sw.pages(), ["/en/deals/some-deal"]);
});

test("nothing personal, private or broken is stored", async () => {
  const cases = [
    ["a page the server marked no-store", "/en/pro", page("x", { cacheControl: "no-store, must-revalidate" })],
    ["a 503", "/en", page("busy", { status: 503, cacheControl: "no-store" })],
    ["a 503 without no-store", "/fr", page("busy", { status: 503 })],
    ["a 404", "/en/nothing", page("gone", { status: 404 })],
    ["something that is not HTML", "/en/feed", page("{}", { type: "application/json" })],
  ];
  for (const path of [
    "/admin", "/admin/deals", "/portal", "/portal-invite/abc", "/affiliate/earnings", "/creator",
    "/en/dashboard", "/fr/dashboard/settings", "/es/sign-in", "/en/sign-up/verify",
  ]) {
    cases.push([`the private area ${path}`, path, page("mine")]);
  }
  for (const [label, path, response] of cases) {
    const sw = serviceWorker({ network: async () => response });
    await sw.navigate(path);
    assert.deepEqual(sw.pages(), [], `${label} must not be stored`);
  }
  // A browser keeps `redirected` on a clone, so the stand-in does too.
  class RedirectedResponse extends BasicResponse {
    get redirected() { return true; }
    clone() { return Object.setPrototypeOf(super.clone(), RedirectedResponse.prototype); }
  }
  const redirected = Object.setPrototypeOf(page("x"), RedirectedResponse.prototype);
  const sw = serviceWorker({ network: async () => redirected });
  await sw.navigate("/");
  assert.deepEqual(sw.pages(), [], "a redirected response must not be stored");
});

test("a page fetched with a session is not stored, whatever its headers say", async () => {
  const sw = serviceWorker({ session: true, network: async () => page("<html>signed in</html>") });
  await sw.navigate("/en/deals/some-deal");
  assert.deepEqual(sw.pages(), []);
});

test("the affiliate portal's own hostname stores nothing", async () => {
  const sw = serviceWorker({ origin: "https://affiliate.radar.cheap", network: async () => page("<html>portal</html>") });
  await sw.navigate("/earnings");
  assert.deepEqual(sw.pages(), []);
});

test("activation drops version 1's cache, and sign-out clears stored pages", async () => {
  const sw = serviceWorker({ network: async () => page("<html>home</html>") });
  await (await sw.storage.api.open("radar-shell-v1")).put("https://radar.cheap/en/dashboard", page("old"));
  await sw.navigate("/en");
  await sw.activate();
  assert.deepEqual((await sw.storage.api.keys()).sort(), ["radar-pages-v2"], "radar-shell-v1 must be deleted");
  await sw.message({ type: "radar:clear-pages" });
  assert.deepEqual(sw.pages(), []);
  assert.ok(!(await sw.storage.api.keys()).includes("radar-pages-v2"));

  // The message comes from the page: InstallPrompt notices a load with no session after one with.
  const prompt = code(readFileSync(new URL("../app/InstallPrompt.tsx", import.meta.url), "utf8"));
  assert.match(prompt, /postMessage\(\{ type: "radar:clear-pages" \}\)/);
  assert.match(prompt, /__session=/);
});

test("offline, a navigation falls back to the stored page, then to its language's home page", async () => {
  let online = true;
  const sw = serviceWorker({
    network: async (request) => {
      if (!online) throw new TypeError("Failed to fetch");
      return page(`<html>${new URL(request.url).pathname}</html>`);
    },
  });
  await sw.navigate("/fr");
  await sw.navigate("/fr/deals/one");
  online = false;
  assert.equal(await (await sw.navigate("/fr/deals/one")).text(), "<html>/fr/deals/one</html>");
  assert.equal(await (await sw.navigate("/fr/deals/one?return=%2Ffr")).text(), "<html>/fr/deals/one</html>");
  assert.equal(await (await sw.navigate("/fr/deals/never-seen")).text(), "<html>/fr</html>");
  const nothing = await sw.navigate("/es/deals/never-seen");
  assert.equal(nothing.type, "error", "with nothing stored, the browser shows its own offline page");
});

test("the page cache keeps only the most recent pages", async () => {
  const sw = serviceWorker({ network: async (request) => page(`<html>${request.url}</html>`) });
  for (let index = 0; index < 45; index += 1) await sw.navigate(`/en/deals/deal-${index}`);
  const stored = sw.pages();
  assert.equal(stored.length, 40);
  assert.equal(stored[0], "/en/deals/deal-5", "the oldest go first");
  assert.equal(stored.at(-1), "/en/deals/deal-44");
});

test("without a Cookie Store API, the server's no-store is what keeps a signed-in page out", async () => {
  // Firefox and Safari have no cookieStore in a service worker. Every page the Worker renders for a
  // request carrying __session keeps the framework's no-store, so it is refused on that alone.
  const sw = serviceWorker({ cookieStore: false, network: async () => page("<html>signed in</html>", { cacheControl: "no-store, must-revalidate" }) });
  await sw.navigate("/en");
  assert.deepEqual(sw.pages(), []);
});

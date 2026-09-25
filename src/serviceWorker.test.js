import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const scope = "https://example.test/SceneCards/";
const html = (version) => `<script type="module" src="./assets/${version}.js"></script>`;

function worker() {
  const handlers = {};
  const entries = new Map();
  let online = true;
  let version = "old";
  let brokenAsset = false;
  let pageStatus = 200;
  const key = (request) => typeof request === "string" ? request : request.url;
  const fetch = async (request) => {
    if (!online) throw new TypeError("offline");
    const url = key(request);
    if (url.includes("/assets/")) return new Response("script", { status: brokenAsset ? 404 : 200 });
    return new Response(html(version), { status: pageStatus });
  };
  const cache = {
    match: async (request) => entries.get(key(request))?.clone(),
    put: async (request, response) => entries.set(key(request), response.clone()),
    addAll: async (urls) => {
      const responses = await Promise.all(urls.map(fetch));
      if (responses.some(r => !r.ok)) throw new Error("asset missing");
      responses.forEach((r, i) => entries.set(urls[i], r.clone()));
    },
  };
  vm.runInNewContext(source, {
    URL, Response, fetch,
    caches: { open: async () => cache, match: cache.match, keys: async () => [], delete: async () => true },
    self: {
      registration: { scope }, location: { origin: "https://example.test" },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
      addEventListener: (name, handler) => { handlers[name] = handler; },
    },
  });
  return {
    entries,
    set: (options) => {
      online = options.online ?? online;
      version = options.version ?? version;
      brokenAsset = options.brokenAsset ?? brokenAsset;
      pageStatus = options.pageStatus ?? pageStatus;
    },
    install: () => new Promise((resolve, reject) => handlers.install({ waitUntil: p => p.then(resolve, reject) })),
    navigate: (suffix = "") => new Promise((resolve, reject) => handlers.fetch({
      request: { url: scope + suffix, method: "GET", mode: "navigate" },
      respondWith: p => p.then(resolve, reject),
    })),
  };
}

test("a newly visited release is available offline with its matching script", async () => {
  const app = worker();
  await app.install();
  app.set({ version: "new" });
  assert.equal(await (await app.navigate()).text(), html("new"));
  assert.ok(app.entries.has(scope + "assets/new.js"));
  app.set({ online: false });
  assert.equal(await (await app.navigate("?from=homescreen")).text(), html("new"));
});

test("a deployment with a missing script preserves the working offline release", async () => {
  const app = worker();
  await app.install();
  app.set({ version: "broken", brokenAsset: true });
  assert.equal(await (await app.navigate()).text(), html("old"));
  app.set({ online: false });
  assert.equal(await (await app.navigate()).text(), html("old"));
});

test("a server error falls back to the installed release", async () => {
  const app = worker();
  await app.install();
  app.set({ pageStatus: 503 });
  assert.equal(await (await app.navigate()).text(), html("old"));
});

test("an empty offline cache returns a readable page instead of an invalid response", async () => {
  const app = worker();
  app.set({ online: false });
  const response = await app.navigate();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Connect to the internet/);
});

test("startup recovery only clears app-shell caches and preserves local card data", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = Object.fromEntries([
    "startup-recovery", "recovery-status", "recover-app", "backup-before-recovery", "root",
  ].map(id => [id, { hidden: true, children: [] }]));
  const timers = [];
  const deleted = [];
  let unregistered = 0;
  let reloaded = "";
  const savedData = '{"cards":[{"id":"existing","repetitions":12}],"reviews":[{"id":"review"}]}';
  const localStorage = Object.freeze({ getItem: () => savedData });
  const registration = { scope, unregister: async () => { unregistered++; } };
  vm.runInNewContext(script, {
    URL, Blob, Promise, Date, localStorage,
    location: { href: scope, protocol: "https:", replace: url => { reloaded = url; } },
    document: { getElementById: id => elements[id], addEventListener: () => {} },
    window: { addEventListener: () => {}, caches: {} },
    setTimeout: callback => { timers.push(callback); },
    fetch: async () => new Response("shell"),
    navigator: { onLine: true, serviceWorker: {
      register: async () => registration,
      getRegistrations: async () => [registration, { scope: "https://example.test/another/" }],
    } },
    caches: {
      keys: async () => ["scenecards-shell-v4", "other-app-data"],
      delete: async key => { deleted.push(key); },
    },
  });
  timers[0]();
  assert.equal(elements["startup-recovery"].hidden, false);
  await elements["recover-app"].onclick();
  assert.deepEqual(deleted, ["scenecards-shell-v4"]);
  assert.equal(unregistered, 1);
  assert.match(reloaded, /recovery=/);
  assert.equal(localStorage.getItem("scenecards.data.v1"), savedData);
});

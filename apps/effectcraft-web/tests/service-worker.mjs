// Upstream 0.16: cache failures must not break network fallback or escape as rejections.
// Run with: node apps/effectcraft-web/tests/service-worker.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../web/sw.js", import.meta.url), "utf8"))
  .replace('"__EC_VERSION__"', '"test"').replace("__EC_FILES__", "[]");
function worker({ openFails = false, matchFails = false, putFails = false, hit = null, networkFails = false } = {}) {
  const handlers = new Map();
  const lookups = [];
  let fetches = 0;
  let writes = 0;
  const response = { ok: true, type: "basic", clone() { return this; } };
  const cache = {
    async match(key, options) {
      lookups.push([key, options.ignoreSearch]);
      if (matchFails) throw new Error("cache lookup failed");
      return hit;
    },
    async put() {
      writes++;
      if (putFails) throw new Error("cache quota exceeded");
    },
  };
  runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://example.test" },
      registration: { scope: "https://example.test/editor/" },
      addEventListener(name, callback) { handlers.set(name, callback); },
    },
    caches: { async open() { if (openFails) throw new Error("cache unavailable"); return cache; } },
    async fetch() {
      fetches++;
      if (networkFails) throw new Error("offline");
      return response;
    },
  });
  return {
    response, lookups,
    get fetches() { return fetches; },
    get writes() { return writes; },
    request({ url = "https://example.test/editor/?android", method = "GET", mode = "navigate" } = {}) {
      let result;
      handlers.get("fetch")({ request: { url, method, mode }, respondWith(promise) { result = promise; } });
      return result;
    },
  };
}

for (const fault of [{}, { openFails: true }, { matchFails: true }, { putFails: true }]) {
  const w = worker(fault);
  assert.equal(await w.request(), w.response, `usable response with ${JSON.stringify(fault)}`);
  // Give rejected fire-and-forget puts time to surface as unhandled rejections (Node fails).
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.fetches, 1);
  assert.equal(w.writes, fault.openFails ? 0 : 1);
}
const cached = { cached: true };
const offline = worker({ hit: cached, networkFails: true });
assert.equal(await offline.request(), cached, "offline navigation stays cache-first");
assert.equal(offline.fetches, 0);
assert.deepEqual(offline.lookups, [["https://example.test/editor/", true]], "navigation ignores query flags");
const assets = worker({ hit: cached });
assert.equal(await assets.request({ url: "https://example.test/editor/worker.js", mode: "cors" }), cached);
assert.equal(assets.lookups[0][0].url, "https://example.test/editor/worker.js");
assert.equal(assets.lookups[0][1], false, "asset lookups preserve their query");
const ignored = worker();
assert.equal(ignored.request({ method: "POST" }), undefined);
assert.equal(ignored.request({ url: "https://other.test/file" }), undefined);
assert.equal(ignored.fetches, 0, "non-GET and remote requests are not intercepted");
await assert.rejects(worker({ openFails: true, networkFails: true }).request(), /offline/, "a real network failure remains visible");
console.log("service-worker: ok");

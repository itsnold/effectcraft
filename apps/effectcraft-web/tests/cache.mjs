// Upstream 0.16 OPFS cache writes, including older Android WebView capabilities.
// Run with: node apps/effectcraft-web/tests/cache.mjs
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

globalThis.self = globalThis;
const files = new Map();
const created = [];
const moved = [];
const removed = [];
let synchronous = false;
let moveFails = false;
let closes = 0;
class Handle {
  async move(dir, name) {
    if (moveFails) throw new Error("move failed");
    moved.push([this.name, name]);
    files.set(name, files.get(this.name));
    files.delete(this.name);
  }
}
const dir = {
  async getDirectoryHandle() { return this; },
  async removeEntry(name) { removed.push(name); files.delete(name); },
  async getFileHandle(name) {
    created.push(name);
    const handle = new Handle();
    handle.name = name;
    if (synchronous) {
      handle.createSyncAccessHandle = async () => ({
        truncate() { files.set(name, new Uint8Array()); },
        write(bytes) { files.set(name, bytes.slice()); return bytes.length; },
        flush() {},
        close() { closes++; },
      });
    } else {
      handle.createWritable = async () => ({
        async write(bytes) { files.set(name, bytes.slice()); },
        async close() { closes++; },
      });
    }
    return handle;
  },
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => dir } } });
globalThis.FileSystemHandle = Handle;
const setCrypto = (value) => Object.defineProperty(globalThis, "crypto", { configurable: true, value });
const host = await import("../js/host.js");
const bytes = new Uint8Array([1, 2, 3, 4]);
let uuidCalls = 0;
setCrypto({ randomUUID() { uuidCalls++; return webcrypto.randomUUID(); } });

// Both page streams and worker synchronous handles write via a unique secure temporary.
for (const sync of [false, true]) {
  synchronous = sync;
  const name = sync ? "worker.ecc" : "page.ecc";
  assert.equal(await host.cacheWrite(name, bytes), bytes.length);
  assert.match(created.at(-1), new RegExp(`^${name.replace(".", "\\.")}\\.tmp\\.[0-9a-f-]{36}$`));
  assert.deepEqual(files.get(name), bytes);
  assert.equal(files.has(created.at(-1)), false, "temporary moved into place");
  assert.deepEqual(moved.at(-1), [created.at(-1), name]);
}
assert.equal(uuidCalls, 2, "each temporary uses crypto.randomUUID");
assert.equal(closes, 2, "both write paths close their handles");

// Old WebViews may have move but no randomUUID, no crypto, or no file move API.
for (const crypto of [{}, undefined]) {
  setCrypto(crypto);
  assert.equal(await host.cacheWrite("fallback.ecc", bytes), bytes.length);
  assert.equal(created.at(-1), "fallback.ecc", "no unavailable UUID call or insecure temporary");
  assert.deepEqual(files.get("fallback.ecc"), bytes);
}
setCrypto({ randomUUID() { throw new Error("UUID must not be needed without move"); } });
for (const handle of [class {}, undefined]) {
  globalThis.FileSystemHandle = handle;
  assert.equal(await host.cacheWrite("no-move.ecc", bytes), bytes.length);
  assert.equal(created.at(-1), "no-move.ecc");
}

// A failed replacement reports its error, removes the temporary and keeps the old entry.
globalThis.FileSystemHandle = Handle;
setCrypto(webcrypto);
moveFails = true;
const old = new Uint8Array([9]);
files.set("page.ecc", old);
await assert.rejects(host.cacheWrite("page.ecc", bytes), /move failed/);
assert.deepEqual(files.get("page.ecc"), old);
assert.equal(removed.at(-1), created.at(-1));
assert.equal(files.has(created.at(-1)), false);
console.log("cache: ok");

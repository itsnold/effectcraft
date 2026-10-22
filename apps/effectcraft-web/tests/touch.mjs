import assert from "node:assert/strict";
import { TouchGesture, transferAndroidBlob } from "../web/touch.js";

// Browser timers reject an arbitrary object as their receiver (Node timers do not).
// Exercise the DEFAULT timer path, not just the injected fake scheduler below.
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
try {
  globalThis.setTimeout = function () { assert.equal(this, globalThis); return 123; };
  globalThis.clearTimeout = function () { assert.equal(this, globalThis); };
  const realDefaults = new TouchGesture(() => {});
  realDefaults.down(1, { x: 10, y: 10 });
  realDefaults.cancelAll();
} finally {
  globalThis.setTimeout = nativeSetTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
}

const events = [];
let timer;
const gesture = new TouchGesture((event) => events.push(event), (fn) => { timer = fn; return fn; }, (id) => { if (timer === id) timer = null; });
const p = (x, y) => ({ x, y });
const types = () => events.splice(0).map((e) => [e.type, e.button]);
gesture.down(1, p(20, 30));
assert.deepEqual(types(), [], "delay primary press: a hold must not select, drag or edit first");
gesture.up(1, p(20, 30));
assert.deepEqual(types(), [["move", 0], ["down", 0], ["up", 0]]);
assert.equal(timer, null);

gesture.down(1, p(20, 30)); timer();
gesture.up(1, p(20, 30));
assert.deepEqual(types(), [["move", 0], ["down", 2], ["up", 2], ["haptic", undefined]], "hold = one right click, no left click");

gesture.down(1, p(20, 30));
gesture.move(1, p(22, 33));
assert.deepEqual(types(), [], "finger jitter does not start a drag");
gesture.move(1, p(50, 30));
assert.equal(timer, null, "drag cancels long press");
gesture.up(1, p(70, 30));
assert.deepEqual(types(), [["move", 0], ["down", 0], ["move", 0], ["up", 0]]);

gesture.down(1, p(100, 100));
gesture.down(2, p(200, 100));
gesture.move(2, p(250, 100));
const pinch = events.splice(0);
assert.equal(pinch[1].type, "wheel");
assert.equal(pinch[1].zoom, true);
assert(pinch[1].dy < 0, "spreading fingers zooms in");
gesture.up(2, p(250, 100));
gesture.move(1, p(140, 100));
gesture.up(1, p(140, 100));
assert.deepEqual(types(), [], "remaining finger after pinch cannot drag a layer");

gesture.down(1, p(100, 100));
gesture.down(2, p(200, 100));
gesture.move(1, p(100, 130));
assert.equal(events[1].zoom, false, "parallel movement scrolls instead of zooming");
assert(events[1].dy < 0);
types(); gesture.cancelAll();
assert.equal(gesture.points.size, 0);
assert.equal(timer, null);

gesture.down(1, p(10, 10));
gesture.up(1, p(10, 10), true);
assert.deepEqual(types(), [], "system cancellation cannot click");
gesture.down(1, p(10, 10)); gesture.move(1, p(40, 10)); types();
gesture.down(2, p(100, 10));
assert.equal(events[0].type, "up", "second finger releases any active primary press");
types(); gesture.cancelAll();
gesture.down(1, p(NaN, 1));
assert.equal(gesture.points.size, 0, "nonfinite coordinates ignored");
console.log("touch: tap, hold, jitter, drag, pinch, pan, cancellation and multi-touch transition passed");

const payload = Uint8Array.from({ length: 500000 }, (_, i) => i % 256);
let chunks = [];
let finished = false;
let aborted = false;
const bridge = {
  begin(name, mime, size) { assert.equal(name, "render.mp4"); assert.equal(mime, "video/mp4"); assert.equal(size, payload.length); return ""; },
  chunk(data) { assert(data.length <= 262144); chunks.push(Buffer.from(data, "base64")); return ""; },
  finish() { finished = true; return ""; },
  abort() { aborted = true; },
};
const blob = new Blob([payload], { type: "video/mp4" });
await transferAndroidBlob(bridge, "render.mp4", blob);
assert.equal(chunks.length, 3, "large exports are chunked");
assert.deepEqual(Buffer.concat(chunks), Buffer.from(payload));
assert(finished && !aborted);
chunks = []; finished = false;
await assert.rejects(transferAndroidBlob({ ...bridge, chunk: () => "disk full" }, "render.mp4", blob), /disk full/);
assert(aborted && !finished, "failed transfer aborts, never reports success");
aborted = false;
await assert.rejects(transferAndroidBlob({ ...bridge, begin: () => "export too large" }, "render.mp4", blob), /too large/);
assert(aborted && !finished);
console.log("android exports: binary multi-chunk round trip and failed-transfer handling passed");

import assert from "node:assert/strict";
import { TouchGesture, transferAndroidBlob, touchTarget, applyAndroidDefaults } from "../web/touch.js";

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
assert.deepEqual(types(), [["haptic", undefined], ["move", 0], ["down", 2], ["up", 2]], "stationary hold release = one right click, no left click");

// A hold on an editable timeline target must not open a menu before the user can drag.
gesture.down(1, p(100, 200), "hold-drag"); timer();
assert.deepEqual(types(), [["haptic", undefined]], "hold arms editing without selecting or opening a menu");
gesture.move(1, p(102, 202)); assert.deepEqual(types(), [], "armed jitter is not a drag");
gesture.move(1, p(145, 200)); gesture.up(1, p(165, 200));
let held = events.splice(0);
assert.deepEqual(held.map(e => [e.type, e.button]), [["move", 0], ["down", 0], ["move", 0], ["move", 0], ["up", 0]]);
assert.equal(held[1].x, 100, "grab the original bar/key, not the pointer's later location");
gesture.down(1, p(100, 200), "hold-drag"); timer(); types();
gesture.up(1, p(100, 200));
assert.deepEqual(types(), [["move", 0], ["down", 2], ["up", 2]], "stationary release retains context options");
gesture.down(1, p(100, 200), "hold-drag"); gesture.move(1, p(50, 201)); gesture.up(1, p(50, 201));
held = events.splice(0);
assert(held.some(e => e.type === "wheel"));
assert(!held.some(e => e.type === "down"), "an ordinary quick swipe over a layer still scrolls safely");
for (const end of ["cancel", "second-finger"]) {
  gesture.down(1, p(100, 200), "hold-drag"); timer(); types();
  if (end === "second-finger") gesture.down(2, p(200, 200));
  gesture.cancelAll();
  assert.deepEqual(types(), [], `${end} while armed never clicks or edits`);
}
gesture.down(1, p(100, 200), "hold-drag"); timer(); types();
gesture.up(1, p(160, 200));
assert(types().some(([type, button]) => type === "down" && button === 0), "coalesced release after a hold is a drag, not a menu");

gesture.down(1, p(20, 30));
gesture.move(1, p(22, 33));
assert.deepEqual(types(), [], "finger jitter does not start a drag");
gesture.move(1, p(50, 30));
assert.equal(timer, null, "drag cancels long press");
gesture.up(1, p(70, 30));
assert.deepEqual(types(), [["move", 0], ["down", 0], ["move", 0], ["move", 0], ["up", 0]]);

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

// A vertical swipe scrolls without selecting/editing the row under it, and locks its axis.
gesture.down(1, p(100, 200), "auto");
gesture.move(1, p(102, 198)); // jitter must not discard the beginning of a swipe
assert.deepEqual(types(), []);
gesture.move(1, p(103, 140));
let scroll = events.splice(0);
assert.deepEqual(scroll.map(e => e.type), ["move", "wheel"]);
assert.equal(scroll[1].dy, 60);
assert.equal(scroll[1].dx, 0);
assert.equal(scroll[1].x, 100);
gesture.move(1, p(300, 100));
scroll = events.splice(0);
assert.equal(scroll[1].x, 100, "scroll remains anchored in the originating panel");
assert.equal(scroll[1].dx, 0, "diagonal motion cannot turn vertical scrolling into horizontal scrolling");
gesture.up(1, p(300, 100));
assert.deepEqual(types(), [], "swiping never emits a click or release");
// Auto keeps horizontal property scrubbing; Drag keeps vertical layer reordering.
for (const [policy, end] of [["auto", p(160, 205)], ["drag", p(100, 100)]]) {
  gesture.down(1, p(100, 200), policy); gesture.move(1, end); gesture.up(1, end);
  assert.deepEqual(types().map(e => e[0]), ["move", "down", "move", "move", "up"]);
}
gesture.down(1, p(100, 200), "scroll"); gesture.move(1, p(50, 202));
scroll = events.splice(0);
assert.equal(scroll[1].dx, 50); assert.equal(scroll[1].dy, 0);
gesture.cancelAll(); assert.deepEqual(types(), []);
gesture.down(1, p(0, 0)); gesture.move(1, p(30, 0)); types();
gesture.cancelAll(); assert.deepEqual(types(), [["up", 0]], "blur/resize releases the pressed button");

// Density + UI zoom + inset mapping, including the enlarged scrollbar target.
const layout = { pixelsPerPoint: 3, viewers: [[100, 0, 300, 200]], scrollbars: [[80, 10, 4, 180]], overlay: false };
const bounds = { left: 10, top: 20 };
assert.equal(touchTarget(p(200, 100), layout, bounds, 2).policy, "drag");
assert.equal(touchTarget(p(30, 100), layout, bounds, 2).policy, "auto");
assert.equal(touchTarget(p(200, 100), { ...layout, overlay: true }, bounds, 2).policy, "auto", "modal/menu must override viewer underneath");
const target = touchTarget(p(122, 100), layout, bounds, 2);
assert.equal(target.policy, "drag");
assert.equal(target.offset.x, 11, "snap a near miss to the real 4-point track");
assert.equal(touchTarget(p(200, 100), layout, bounds, 2, "scroll").policy, "scroll");
assert.equal(touchTarget(p(30, 100), { ...layout, drags: [[0, 0, 30, 200]] }, bounds, 2).policy, "drag", "panel dividers and tabs retain vertical editing drags");
assert.equal(touchTarget(p(30, 100), null, bounds, 2).policy, "auto", "before first frame, vertical scrolling is still safe");

const timelineLayout = { pixelsPerPoint: 2.5, scrolls: [[0, 0, 300, 400]] };
const safeTarget = touchTarget(p(120, 160), timelineLayout, bounds, 2);
assert.equal(safeTarget.policy, "scroll", "Auto protects timeline bars and keys on both axes");
gesture.down(1, p(240, 200), safeTarget.policy);
gesture.move(1, p(140, 202));
gesture.move(1, p(80, 280));
gesture.up(1, p(80, 280));
scroll = events.splice(0);
assert(scroll.some(e => e.type === "wheel" && e.dx > 0));
assert(scroll.filter(e => e.type === "wheel").every(e => e.dy === 0), "sideways swipe locks its axis");
assert(!scroll.some(e => e.type === "down" || e.type === "up"), "scrolling across a key must not press or release it");
assert.equal(touchTarget(p(120, 160), timelineLayout, bounds, 2, "drag").policy, "drag", "explicit Drag still edits");
assert.equal(touchTarget(p(120, 160), { ...timelineLayout, overlay: true }, bounds, 2).policy, "auto", "an overlaid dialog keeps value dragging");
const editingLayout = { ...timelineLayout, scrubs: [[40, 80, 40, 24]], holdDrags: [[80, 80, 100, 32]] };
assert.equal(touchTarget(p(80, 130), editingLayout, bounds, 2).policy, "scrub", "real numeric widgets override timeline scrolling");
assert.equal(touchTarget(p(150, 130), editingLayout, bounds, 2).policy, "hold-drag", "visible bars, keys and layer names can be held to edit");
assert.equal(touchTarget(p(80, 130), { ...editingLayout, overlay: true }, bounds, 2).policy, "scrub", "modal numeric widgets remain usable");
assert.equal(touchTarget(p(150, 130), { ...editingLayout, overlay: true }, bounds, 2).policy, "auto", "dialogs block held layers underneath");
assert.equal(touchTarget(p(80, 130), editingLayout, bounds, 2, "scroll").policy, "scroll", "Scroll explicitly overrides numeric scrubbing");
for (const [end, expected] of [[p(160, 201), "down"], [p(101, 140), "wheel"]]) {
  gesture.down(1, p(100, 200), "scrub"); gesture.move(1, end); gesture.up(1, end);
  const scrubbed = events.splice(0);
  assert(scrubbed.some(e => e.type === expected), "horizontal numeric drags edit; vertical swipes scroll");
}

// Timeline navigation is not a layer edit: keep the ruler, playhead and zoom controls draggable
// in Auto, with the same inset/density conversion as the protected layer rows.
const navigationLayout = { pixelsPerPoint: 3, scrolls: [[0, 0, 400, 400]],
  controls: [[100, 20, 250, 34], [100, 330, 150, 20]],
  controlTracks: [[100, 338, 150, 4]] };
assert.equal(touchTarget(p(235, 75), navigationLayout, bounds, 2).policy, "drag", "ruler scrub takes precedence over timeline scroll");
assert.equal(touchTarget(p(235, 75), navigationLayout, bounds, 2, "scroll").policy, "scroll", "explicit Scroll still overrides scrubbing");
assert.equal(touchTarget(p(235, 75), { ...navigationLayout, overlay: true }, bounds, 2).policy, "auto", "dialogs do not scrub the timeline underneath");
assert.equal(touchTarget(p(235, 180), navigationLayout, bounds, 2).policy, "scroll", "a playhead line through layer rows must not become a drag target");
const zoomTarget = touchTarget(p(235, 526), { ...navigationLayout, controls: [] }, bounds, 2);
assert.equal(zoomTarget.policy, "drag", "near a thin zoom track, snap onto the control");
assert.equal(zoomTarget.offset.y, 4, "preserve the finger's horizontal position when snapping a zoom track");
assert.equal(zoomTarget.offset.x, 0);
gesture.down(1, p(235, 75), "drag"); gesture.move(1, p(300, 75)); gesture.up(1, p(300, 75));
assert(types().some(([type]) => type === "down"), "scrubbing emits a real press/drag rather than a wheel");

// Selection boxes and enlarged clip edges use the completed UI geometry at any density.
const editingBounds = { left: 12, top: 68 };
const editingScale = 1.5;
const css = (x, y) => p(editingBounds.left + x * editingScale, editingBounds.top + y * editingScale);
const clip = [100, 40, 300, 240];
const edgeLayout = { pixelsPerPoint: 3, scrolls: [clip], marquees: [clip],
  marqueeBlocks: [[180, 80, 120, 30]], holdDrags: [[180, 80, 120, 30]],
  trims: [{ rect: [176, 80, 9, 30], clip }, { rect: [295, 80, 9, 30], clip }] };
for (const [x, center] of [[170, 180.5], [190, 180.5], [290, 299.5], [310, 299.5]]) {
  const edge = touchTarget(css(x, 95), edgeLayout, editingBounds, 2);
  assert.equal(edge.policy, 'hold-drag', 'near either side of an edge arms trim instead of a context menu');
  assert(Math.abs(css(x, 95).x + edge.offset.x - css(center, 95).x) < 1e-6, 'snap to the real trim zone, not the bar body');
  assert.equal(touchTarget(css(x, 95), edgeLayout, editingBounds, 2, 'trim').policy, 'drag', 'Trim edits without a hold');
  assert.equal(touchTarget(css(x, 95), edgeLayout, editingBounds, 2, 'scroll').policy, 'scroll');
  assert.equal(touchTarget(css(x, 95), { ...edgeLayout, overlay: true }, editingBounds, 2, 'trim').policy, 'auto', 'menus block edges beneath them');
}
assert.equal(touchTarget(css(240, 95), edgeLayout, editingBounds, 2, 'trim').policy, 'scroll', 'Trim never moves a bar body');
assert.equal(touchTarget(css(240, 95), edgeLayout, editingBounds, 2, 'box').policy, 'scroll', 'Box select never grabs a bar');
const empty = css(240, 150);
assert.equal(touchTarget(empty, edgeLayout, editingBounds, 2).policy, 'hold-drag', 'hold on empty space arms a selection rectangle');
assert.equal(touchTarget(empty, edgeLayout, editingBounds, 2, 'box').policy, 'drag', 'Box select draws immediately');
assert.equal(touchTarget(empty, { ...edgeLayout, overlay: true }, editingBounds, 2, 'box').policy, 'auto');
for (const [policy, wait, expected] of [['hold-drag', true, 'down'], ['hold-drag', false, 'wheel'], ['drag', false, 'down']]) {
  gesture.down(1, empty, policy);
  if (wait) { timer(); assert.deepEqual(types(), [['haptic', undefined]], 'holding empty timeline space does not open a menu'); }
  gesture.move(1, p(empty.x + 40, empty.y - 30)); gesture.up(1, p(empty.x + 40, empty.y - 30));
  const output = events.splice(0);
  assert(output.some(e => e.type === expected));
  assert(!output.some(e => e.button === 2), 'selection drag cannot become a right click');
}
const shortEdges = { ...edgeLayout, trims: [{ rect: [202, 80, 6, 30], clip }, { rect: [196, 80, 6, 30], clip }] };
assert.equal(touchTarget(css(197, 95), shortEdges, editingBounds, 2).offset.x, 3, 'overlapping edge targets choose the nearest, not the first');
const boundary = { ...edgeLayout, trims: [{ rect: [100, 80, 5, 30], clip }] };
assert.notEqual(touchTarget(css(96, 95), boundary, editingBounds, 2).policy, 'hold-drag', 'expanded edge cannot reach another panel');
assert.equal(touchTarget(css(170, 95), { ...edgeLayout, trims: [] }, editingBounds, 2, 'trim').policy, 'scroll', 'missing/locked edges do not trim');
console.log('Timeline touch: selection boxes, edge near misses, nearest short-clip edge, modes, overlays and safe swiping passed');

// Fresh installs, one-time upgrade from the forced scale, custom settings and failed writes.
function preferences(initial = {}, scale = 125) {
  const stored = new Map(Object.entries(initial)), writes = [];
  return { stored, writes, api: {
    execute: async (id, params) => { if (id === "prefs.get") return scale; writes.push(params.values); },
    flush: async () => {},
  }, storage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } };
}
let prefs = preferences(); await applyAndroidDefaults(prefs.api, prefs.storage);
assert.equal(prefs.writes[0]["appearance.uiScale"], 100); assert.equal(prefs.writes[0]["memory.layerCacheMb"], 128);
await applyAndroidDefaults(prefs.api, prefs.storage); assert.equal(prefs.writes.length, 1);
prefs = preferences({ "ecdroid.defaults.v1": "1" }); await applyAndroidDefaults(prefs.api, prefs.storage);
assert.deepEqual(prefs.writes, [{ "appearance.uiScale": 100 }], "upgrade doesn't reset cache preferences");
prefs = preferences({ "ecdroid.defaults.v1": "1" }, 85); await applyAndroidDefaults(prefs.api, prefs.storage);
assert.deepEqual(prefs.writes, [], "preserve non-default user scale");
prefs = preferences({ "ecdroid.defaults.v1": "1" }); prefs.api.flush = async () => { throw new Error("quota"); };
await assert.rejects(applyAndroidDefaults(prefs.api, prefs.storage), /quota/);
assert(!prefs.stored.has("ecdroid.scale.v2"), "retry migration after failed persistence");
console.log("Android usability: swipe axes, editing overrides, scrollbar hit targets, density, cancellation and scale migration passed");
// A coalesced quick swipe must not become a tap; cancellation coordinates may be (0,0).
gesture.down(1, p(100, 200), "auto"); gesture.up(1, p(100, 160));
scroll = events.splice(0); assert.deepEqual(scroll.map(e => e.type), ["move", "wheel"]);
assert.equal(scroll[1].dy, 40);
gesture.down(1, p(100, 200)); gesture.move(1, p(140, 200)); types();
gesture.up(1, p(0, 0), true);
const cancelledDrag = events.splice(0);
assert(cancelledDrag.every(e => e.x === 140 && e.y === 200), "capture loss must not jump an edit to the screen origin");

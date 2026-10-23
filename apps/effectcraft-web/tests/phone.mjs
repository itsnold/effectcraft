import assert from "node:assert/strict";
import { PhoneWorkspace, wantsPhoneLayout } from "../web/phone.js";

assert(wantsPhoneLayout(390, 390, 844), "portrait phone");
assert(wantsPhoneLayout(844, 844, 390), "landscape phone");
assert(wantsPhoneLayout(480, 1280, 800), "narrow split window");
assert(!wantsPhoneLayout(1280, 1280, 800), "tablet retains docked workspace");
assert(!wantsPhoneLayout(NaN, 390, 844));

const calls = [];
let fail = false;
const api = { async request(method, params) {
  if (fail) { fail = false; throw new Error("layout request failed"); }
  calls.push([method, params]);
} };
const workspace = new PhoneWorkspace(api);
workspace.compact = true;
await workspace.sync();
assert.equal(calls.length, 0, "no engine calls before ready");
workspace.ready = true;
await workspace.sync();
assert.deepEqual(calls.at(-1), ["ui.set", { phonePanel: "Composition" }]);
await workspace.setPanel("Timeline");
assert.deepEqual(calls.at(-1), ["ui.set", { phonePanel: "Timeline" }]);
await workspace.sync();
assert.equal(calls.length, 2, "resizing/rotating within phone layout does not reset the panel");
await workspace.setMode("desktop");
assert.deepEqual(calls.at(-1), ["ui.set", { phonePanel: null }]);
assert(!workspace.enabled);
await workspace.setMode("phone");
assert.deepEqual(calls.at(-1), ["ui.set", { phonePanel: "Timeline" }]);
await Promise.all([workspace.setPanel("Project"), workspace.setPanel("EffectsPresets"), workspace.setMode("desktop")]);
assert.deepEqual(calls.at(-1), ["ui.set", { phonePanel: null }], "latest state wins after fast mode/tab changes");
await workspace.setMode("auto");
workspace.compact = false;
await workspace.sync();
assert(!workspace.enabled);
fail = true;
await assert.rejects(workspace.setMode("phone"), /layout request failed/);
await workspace.sync();
assert(workspace.enabled, "a failed request does not poison the controller queue");
assert.equal(workspace.pending, 0);
await assert.rejects(workspace.setPanel("bad-panel"), /Unknown/);
await assert.rejects(workspace.setMode("bad-mode"), /Unknown/);
assert(calls.every(([method, params]) => method === "ui.set" && Object.keys(params).join() === "phonePanel"), "never replace the dock or modify document content");
console.log("phone workspace: detection, portrait/landscape, split window, panel selection, layout override and error recovery passed");

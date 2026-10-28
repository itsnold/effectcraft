import assert from "node:assert/strict";
import { PhoneWorkspace, wantsPhoneLayout, menuLevel, timingParams } from "../web/phone.js";

const menuItems = [
  {id:'file.open',label:'Open',path:['File']},
  {id:'render',label:'MP4',path:['File','Export'],params:{format:'mp4'}},
  {id:'render',label:'GIF',path:['File','Export'],params:{format:'gif'},enabled:false},
  {id:'grid',label:'Grid',path:['View'],checked:true},
];
assert.deepEqual(menuLevel(menuItems).groups,['File','View']);
assert.deepEqual(menuLevel(menuItems,['File']).groups,['Export']);
assert.equal(menuLevel(menuItems,['File']).actions[0].id,'file.open');
assert.deepEqual(menuLevel(menuItems,['File','Export']).actions,menuItems.slice(1,3),'bound parameters and disabled entries survive');
assert.equal(menuLevel(menuItems,[], 'EXPORT').actions.length,2,'search matches submenu paths');
assert.equal(menuLevel(Array.from({length:100},()=>menuItems[0]),[], 'open').actions.length,100,'never truncate menus/search results');
assert.deepEqual(timingParams([7],'in',60,30),{layers:[7],in:2});
assert.deepEqual(timingParams([7,8],'delta',-1,30000/1001),{layers:[7,8],delta:-1001/30000});
for (const [field,frames,fps] of [['bad',1,30],['in',1.5,30],['out',Infinity,30],['in',1,0],['in',1,NaN]])
  assert.throws(()=>timingParams([7],field,frames,fps));
assert.throws(()=>timingParams([],'in',1,30));

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

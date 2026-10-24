// Full editor in Android mode, real Chromium touch input via CDP. No npm dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const dist = resolve(arg("dist", "target/web/dist"));
const out = resolve(arg("out", "target/android-smoke"));
const webgl4096 = process.argv.includes("--webgl-4096");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "ecdroid-chrome-"));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = resolve(dist, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = Number(arg("port", "9337"));
const chrome = spawn(arg("chrome", "google-chrome"), [
  "--headless=new", "--no-sandbox", "--no-first-run", "--enable-unsafe-swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
chrome.stderr.on("data", (bytes) => { stderr = (stderr + bytes).slice(-10000); });
let ws;
const waiting = new Map();
let id = 0;
const errors = [];
const report = {};
async function send(method, params = {}) {
  const call = ++id;
  const promise = new Promise((res, rej) => waiting.set(call, { res, rej }));
  ws.send(JSON.stringify({ id: call, method, params }));
  return promise;
}
async function js(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await js(expression); if (value) return value; await pause(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function touch(type, points) {
  await send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ id: i + 1, radiusX: 2, radiusY: 2, ...p })) });
}
async function sidewaysOverKey() {
  await js("effectcraft.request('ui.set',{timeline:{pps:innerWidth<600?100:300,start:0}})");
  await pause(200);
  const key = (await js("effectcraft.request('ui.elements',{prefix:'timeline.key.'})")).find(e => e.rect[2] > 0);
  assert(key, "a real keyframe is visible for the scrolling regression");
  const bounds = await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()");
  const ratio = await js("effectcraft.inspect().then(i=>i.pixelsPerPoint/devicePixelRatio)");
  const point = { x: bounds.x + (key.rect[0] + key.rect[2] / 2) * ratio, y: bounds.y + (key.rect[1] + key.rect[3] / 2) * ratio };
  const before = await js("effectcraft.inspect()");
  const documentBefore = await js("Promise.all([effectcraft.execute('comp.info'),effectcraft.execute('layer.tree')])");
  await touch("touchStart", [point]);
  for (let n = 1; n <= 5; n++) { await touch("touchMove", [{ x: point.x - n * 20, y: point.y + n }]); await pause(30); }
  await touch("touchEnd", []); await pause(250);
  const after = await js("effectcraft.inspect()");
  assert(after.ui.timeline.start > before.ui.timeline.start + 0.15, "horizontal swipe over a key scrolls through time");
  assert.deepEqual(after.selectedLayers, before.selectedLayers, "swipe does not select a layer");
  assert.equal(after.selectedKeys, before.selectedKeys, "swipe does not select a key");
  assert.deepEqual(await js("Promise.all([effectcraft.execute('comp.info'),effectcraft.execute('layer.tree')])"), documentBefore, "layer timing and keyframes are unchanged");
  return after.ui.timeline.start;
}
async function checkTimelineNavigation() {
  await js("effectcraft.request('ui.set',{timeline:{pps:innerWidth<600?100:300,start:0}})");
  await js("effectcraft.execute('time.set',{frame:1})");
  await pause(200);
  const initial = await js("effectcraft.inspect()");
  const documentBefore = await js("Promise.all([effectcraft.execute('comp.info'),effectcraft.execute('layer.tree',{time:0})])");
  const fps = documentBefore[0].frameRate;
  const ratio = initial.pixelsPerPoint / await js("devicePixelRatio");
  const bounds = await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()");
  const point = (rect, fx = 0.5, fy = 0.5) => ({ x: bounds.x + (rect[0] + rect[2] * fx) * ratio, y: bounds.y + (rect[1] + rect[3] * fy) * ratio });
  const element = async (id) => {
    const found = (await js(`effectcraft.request('ui.elements',{prefix:${JSON.stringify(id)}})`)).find(e => e.id === id);
    assert(found, `navigation control ${id} is visible`); return found;
  };
  const drag = async (a, b) => {
    await touch("touchStart", [a]);
    for (let n = 1; n <= 6; n++) { await touch("touchMove", [{ x: a.x + (b.x - a.x) * n / 6, y: a.y + (b.y - a.y) * n / 6 }]); await pause(35); }
    await touch("touchEnd", []); await pause(150);
  };
  // Scrub on the ruler, including its formerly non-interactive upper portion.
  const scrub = await element("timeline.scrub"), ruler = await element("timeline.ruler");
  await drag(point(scrub.rect, 0.3, 0.2), point(scrub.rect, 0.65, 0.2));
  const scrubbed = await js("effectcraft.inspect()");
  const [viewStart, pps] = ruler.label.split(',').map(Number);
  const expected = viewStart + (scrub.rect[0] + scrub.rect[2] * 0.65 - ruler.rect[0] - 6) / pps;
  assert(Math.abs(scrubbed.time - expected) <= 1 / fps, `ruler drag reaches the requested frame: ${scrubbed.time} vs ${expected}`);
  assert(Math.abs(scrubbed.time * fps - Math.round(scrubbed.time * fps)) < 1e-5, "scrubbing snaps to an actual frame");
  assert.equal(scrubbed.ui.timeline.start, initial.ui.timeline.start, "scrubbing within the ruler is not a sideways scroll");
  // Grab the visible playhead head itself, not only an arbitrary spot on the ruler.
  const head = await element("timeline.cti");
  await drag(point(head.rect), point(scrub.rect, 0.4));
  assert((await js("effectcraft.inspect()")).time < scrubbed.time - 1 / fps, "playhead head drags backward to another frame");
  // The timeline slider must not be swallowed as a horizontal scroll.
  const slider = await element("timeline.zoomSlider");
  const beforeSlider = (await js("effectcraft.inspect()")).ui.timeline.pps;
  await drag(point(slider.rect, 0.1), point(slider.rect, 0.55));
  assert((await js("effectcraft.inspect()")).ui.timeline.pps > beforeSlider, "dragging time-zoom slider zooms in");
  // Actual fingertip taps on the enlarged in/out buttons, not control-channel clicks.
  const beforeButton = (await js("effectcraft.inspect()")).ui.timeline.pps;
  await touch("touchStart", [point((await element("timeline.zoomInButton")).rect)]); await touch("touchEnd", []); await pause(150);
  assert((await js("effectcraft.inspect()")).ui.timeline.pps > beforeButton * 1.1, "zoom-in button works with touch");
  // Navigator end handles change the visible time span directly too.
  await js("effectcraft.request('ui.set',{timeline:{pps:null,start:0}})"); await pause(150);
  const nav = await element("timeline.navigator"), end = await element("timeline.navigator.end");
  await drag(point(end.rect), point(nav.rect, 0.5));
  assert((await js("effectcraft.inspect()")).ui.timeline.pps > 0, "navigator handle leaves Fit and zooms time");
  // Pinch over the time bars: it must zoom, not move/select the bar underneath.
  const rows = await element("timeline.layerMarquee"), timeRuler = await element("timeline.ruler");
  const middle = point([timeRuler.rect[0], rows.rect[1], timeRuler.rect[2], 70]);
  const beforePinch = (await js("effectcraft.inspect()")).ui.timeline.pps;
  await touch("touchStart", [{ x: middle.x - 30, y: middle.y }, { x: middle.x + 30, y: middle.y }]);
  await touch("touchMove", [{ x: middle.x - 55, y: middle.y }, { x: middle.x + 55, y: middle.y }]);
  await pause(120); await touch("touchEnd", []); await pause(150);
  assert((await js("effectcraft.inspect()")).ui.timeline.pps > beforePinch * 1.1, "two-finger pinch zooms timeline time");
  // Frame-step shortcuts supply precision beyond what fits under one finger.
  await js("effectcraft.execute('time.set',{frame:1})");
  await js("document.querySelector('#touch-bar button[aria-label=\"Move playhead one frame forward\"]').click()");
  await until(`effectcraft.inspect().then(i=>Math.abs(i.time-${2 / fps})<0.00001)`);
  await js("document.querySelector('#touch-bar button[aria-label=\"Move playhead one frame backward\"]').click()");
  await until(`effectcraft.inspect().then(i=>Math.abs(i.time-${1 / fps})<0.00001)`);
  const after = await js("effectcraft.inspect()");
  assert.deepEqual(after.selectedLayers, initial.selectedLayers);
  assert.equal(after.selectedKeys, initial.selectedKeys);
  assert.deepEqual(await js("Promise.all([effectcraft.execute('comp.info'),effectcraft.execute('layer.tree',{time:0})])"), documentBefore, "timeline navigation must not retime layers or keys");
  return { scrubTime: scrubbed.time, slider: true, navigator: true, pinch: true, frameStep: true };
}
// Revealing "selected" depends on a selection that layer.select and touch edits can clear.
// Reveal by stable layer/property ids instead; this is idempotent, unlike reveal.opacity.
async function revealEditingProperty(layer, path) {
  const property = await js(`effectcraft.execute('prop.get',${JSON.stringify({layer,path})})`);
  await js(`effectcraft.request('ui.menu.invoke',${JSON.stringify({id:'timeline.revealProps',params:{props:[{layer,prop:property.uid}]}})})`);
  await js("effectcraft.request('ui.menu.invoke',{id:'timeline.scrollToLayer'})");
  await pause(150);
  return property;
}
async function checkTouchEditing() {
  await js("effectcraft.execute('layer.select',{layers:['Sideways gesture guard']})");
  await js("effectcraft.request('ui.menu.invoke',{id:'timeline.scrollToLayer'})");
  await js("effectcraft.request('ui.set',{timeline:{pps:100,start:0}})");
  await pause(200);
  const layer = (await js("effectcraft.execute('layer.tree',{depth:0})")).id;
  const element = async (id) => {
    const e = (await js(`effectcraft.request('ui.elements',{prefix:${JSON.stringify(id)}})`)).find(e=>e.id===id);
    assert(e, `${id} is visible for editing`); return e;
  };
  const point = async (rect, fx=0.5, fy=0.5) => {
    const bounds = await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()");
    const ratio = await js("effectcraft.inspect().then(i=>i.pixelsPerPoint/devicePixelRatio)");
    return {x:bounds.x+(rect[0]+rect[2]*fx)*ratio,y:bounds.y+(rect[1]+rect[3]*fy)*ratio};
  };
  const drag = async (a,b,hold=true) => {
    await touch('touchStart',[a]); if(hold) await pause(600);
    assert(!(await js("effectcraft.touchLayout().overlay")), "holding an editable target does not open a menu first");
    for(let n=1;n<=8;n++) { await touch('touchMove',[{x:a.x+(b.x-a.x)*n/8,y:a.y+(b.y-a.y)*n/8}]); await pause(35); }
    await touch('touchEnd',[]); await pause(200);
  };
  const state = () => js("effectcraft.execute('comp.info')");
  let before = await state();
  const bar = (await element(`timeline.layer.${layer}.bar`)).rect;
  const ruler = (await element('timeline.ruler')).rect;
  const left = Math.max(bar[0]+16,ruler[0]+16), right = Math.min(bar[0]+bar[2]-16,ruler[0]+ruler[2]-40);
  assert(right>left,"there is visible bar body to hold");
  let a = await point([left,bar[1],right-left,bar[3]],0.3);
  await drag(a,{x:a.x+45,y:a.y});
  const moved = (await state()).layers.find(l=>l.id===layer), old = before.layers.find(l=>l.id===layer);
  assert(moved.start>old.start,"hold + horizontal drag moves the layer in time");
  assert(Math.abs((moved.out-moved.in)-(old.out-old.in))<1e-6,"moving a layer keeps its duration");
  await js("effectcraft.execute('edit.undo')"); assert.deepEqual(await state(),before,"layer move is one undo step");
  // Drag the actual visible name, not a switch/twirl or an engine arrange command.
  const name = await element(`timeline.layer.${layer}.reorder`);
  const names = await js("effectcraft.request('ui.elements',{prefix:'timeline.layer.'})");
  const next = names.filter(e=>e.id.endsWith('.reorder')&&e.rect[3]>0&&e.rect[1]>name.rect[1]).sort((a,b)=>a.rect[1]-b.rect[1])[0];
  assert(next,"another visible layer can be reordered past");
  a = await point(name.rect);
  const target = await point(next.rect,0.5,0.8);
  await drag(a,{x:a.x,y:target.y});
  assert.notDeepEqual((await state()).layers.map(l=>l.id),before.layers.map(l=>l.id),"hold + vertical name drag changes front/back order");
  await js("effectcraft.execute('edit.undo')"); assert.deepEqual(await state(),before,"reordering is one undo step");
  const opacity = await revealEditingProperty(layer, 'transform/opacity');
  assert(opacity.keys.length>0,"fixture has an opacity keyframe to retime");
  const key = (await js(`effectcraft.request('ui.elements',{prefix:'timeline.key.${opacity.uid}.'})`))[0];
  assert(key,"keyframe is visible for a held drag");
  a = await point(key.rect); await drag(a,{x:a.x+40,y:a.y});
  assert.notDeepEqual((await js("effectcraft.execute('prop.get',{path:'transform/opacity'})")).keys,opacity.keys,"held keyframe drag changes key time");
  await js("effectcraft.execute('edit.undo')");
  assert.deepEqual((await js("effectcraft.execute('prop.get',{path:'transform/opacity'})")).keys,opacity.keys,"key drag is one undo step");
  // Position fields must scrub immediately even inside the timeline's protected scroll region.
  const position = await revealEditingProperty(layer, 'transform/position');
  for(const delta of [40,-40]) {
    const value = await element(`timeline.prop.${position.uid}.value.0`);
    a = await point(value.rect); await drag(a,{x:a.x+delta,y:a.y},false);
    const after = await js("effectcraft.execute('prop.get',{path:'transform/position'})");
    assert((after.value[0]-position.value[0])*delta>0,"left/right numeric swipes decrease/increase position");
    assert.deepEqual(after.value.slice(1),position.value.slice(1),"scrubbing X leaves the other coordinates unchanged");
    await js("effectcraft.execute('edit.undo')");
    assert.deepEqual((await js("effectcraft.execute('prop.get',{path:'transform/position'})")).value,position.value,"numeric scrub is one undo step");
  }
  await revealEditingProperty(layer, 'transform/opacity');
  return {layerMove:true,layerReorder:true,keyRetime:true,positionScrub:true,undo:true};
}
const deadline = setTimeout(() => { console.error("Android smoke test exceeded 5 minutes"); chrome.kill(); process.exit(1); }, 300000);
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === "page"); }
    catch { await pause(100); }
  }
  assert(page, `Chromium did not start: ${stderr}`);
  console.log("Chromium started; loading Android-mode editor");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (waiting.has(message.id)) {
      const { res, rej } = waiting.get(message.id); waiting.delete(message.id);
      if (message.error) rej(new Error(JSON.stringify(message.error))); else res(message.result);
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (webgl4096) {
    // Reproduce the reported Android startup failure on desktop CI: prevent WebGPU selection
    // and make WebGL advertise only 4096px textures. No device-request error is intercepted.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      Object.defineProperty(navigator, 'gpu', {value: undefined, configurable: true});
      const original = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        const value = original.call(this, parameter);
        return [this.MAX_TEXTURE_SIZE, this.MAX_CUBE_MAP_TEXTURE_SIZE, this.MAX_RENDERBUFFER_SIZE].includes(parameter)
          ? Math.min(value, 4096) : value;
      };
    ` });
  }
  // A fake native export sink lets us verify the real Rust-generated blob download end to end.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.addEventListener('error',e=>window.ecdroidStartupError=String(e.error||e.message));
    window.addEventListener('unhandledrejection',e=>window.ecdroidStartupError=String(e.reason));
    window.nativeExports=[];window.ECDroidNative={
      begin(name,mime,size){this.current={name,mime,size,received:0};return ''},
      chunk(data){this.current.received+=atob(data).length;return ''},
      finish(){nativeExports.push(this.current);return ''},abort(){}
    };
  ` });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?android&nosw&frameworkers=1&nogpuworkers` });
  const load = await until("window.effectcraftLoad?.error || window.effectcraftLoad?.readyMs || window.ecdroidStartupError");
  assert.equal(typeof load, "number", String(load));
  console.log(`Editor ready after ${Math.round(load)} ms`);
  report.info = await js("effectcraft.info()");
  const manifest = await readFile(new URL("../../../Cargo.toml", import.meta.url), "utf8");
  const expectedVersion = manifest.match(/^version = "([^"]+)"/m)?.[1];
  assert(expectedVersion, "workspace version is declared");
  assert.equal(report.info.version, expectedVersion, "bundled editor runs this checkout's engine version");
  if (webgl4096) {
    assert.equal(report.info.backend, "Gl", "exercise the WebGL2 presentation path");
    assert.equal(report.info.graphicsLimits.adapterMaxTextureDimension2D, 4096, "synthetic adapter really exposes 4096");
    assert.equal(report.info.graphicsLimits.deviceMaxTextureDimension2D, 4096, "device request respects the adapter");
    report.webgl4096 = true;
  }
  assert.equal(await js("effectcraft.execute('prefs.get',{key:'appearance.uiScale'})"), 100, "Android defaults to desktop density");
  assert.notEqual(report.info.storage.backend, "memory", "private storage must persist");
  assert(await js("document.querySelectorAll('#touch-bar button').length >= 12"));
  await js("document.querySelector('#touch-bar button[aria-label=\"Hand tool (drag to pan the composition)\"]').click()");
  await until("effectcraft.inspect().then(i=>i.ui.tool==='Hand')");
  await js("effectcraft.request('ui.set',{tool:'Selection'})");
  await js("effectcraft.request('ui.menu.invoke',{id:'window.maximizePanel',params:{panel:'Timeline'}})");
  await pause(150); // Let the new layout replace the previous frame's automation rectangles.
  const elements = await js("effectcraft.request('ui.elements',{prefix:'timeline.'})");
  const row = elements.find((e) => /^timeline\.layer\.\d+\.row$/.test(e.id));
  // Long-press on a layer row, not a synthetic API click: validates capture and right-click routing.
  if (!row) throw new Error(`No layer row found: ${elements.map((e) => e.id).slice(0, 100)}`);
  const twirl = elements.find((e) => e.id === row.id.replace(/\.row$/, ".twirl"));
  assert(twirl, "layer twirl identifies the name column independently of visible switches");
  const [, y, , height] = row.rect;
  // Registry coordinates are egui points, whereas CDP expects CSS pixels (UI Scale may be customized).
  const cssPerPoint = await js("effectcraft.inspect().then(i=>i.pixelsPerPoint/devicePixelRatio)");
  // The registered row includes switch/parent cells; only its name/number area owns the layer menu.
  // Aim beyond the twirl and layer icon, not at an arbitrary percentage of the whole left panel.
  report.longPressTarget = { x: (twirl.rect[0] + twirl.rect[2] + 24) * cssPerPoint, y: (y + height / 2) * cssPerPoint };
  await touch("touchStart", [report.longPressTarget]);
  await pause(650);
  await touch("touchEnd", []);
  await until("effectcraft.request('ui.elements',{prefix:'timeline.layerMenu'}).then(e=>e.length>0)");
  report.longPressMenu = true;
  console.log("Touch bar and real-touch long-press menu passed");
  await js("effectcraft.request('ui.key',{key:'Escape'})");
  await js("effectcraft.execute('layer.newNull',{name:'Sideways gesture guard'})");
  await js("effectcraft.execute('prop.addKey',{path:'transform/opacity',time:1,value:100})");
  await js("effectcraft.request('ui.menu.invoke',{id:'timeline.reveal.opacity'})");
  report.sidewaysOverKey = await sidewaysOverKey();
  report.tabletTimelineNavigation = await checkTimelineNavigation();
  report.tabletTouchEditing = await checkTouchEditing();
  // Make the timeline genuinely overflow, then swipe on a layer name. No synthetic
  // UI scroll command: only CDP finger input may change the scroll offset.
  await js("(async()=>{for(let i=0;i<45;i++)await effectcraft.execute('layer.newNull',{name:'Touch scroll '+i})})()");
  await pause(200);
  const scrollBefore = await js("effectcraft.inspect()");
  const targetRow = (await js("effectcraft.request('ui.elements',{prefix:'timeline.'})"))
    .filter(e => /^timeline\.layer\.\d+\.row$/.test(e.id) && e.rect[3] > 0)[8];
  assert(targetRow, "overflowing timeline has a visible scroll target");
  const ratio = scrollBefore.pixelsPerPoint / await js("devicePixelRatio");
  const swipe = { x: 260 * ratio, y: (targetRow.rect[1] + targetRow.rect[3] / 2) * ratio };
  const wasSelected = scrollBefore.selectedLayers;
  await touch("touchStart", [swipe]);
  for (let n = 1; n <= 5; n++) { await touch("touchMove", [{ x: swipe.x + n, y: swipe.y - n * 20 }]); await pause(30); }
  await touch("touchEnd", []); await pause(250);
  const scrollAfter = await js("effectcraft.inspect()");
  assert(scrollAfter.ui.timeline.scroll_y > scrollBefore.ui.timeline.scroll_y + 50, "one-finger swipe scrolls timeline rows");
  assert.deepEqual(scrollAfter.selectedLayers, wasSelected, "scrolling does not select/reorder layers");
  report.oneFingerScroll = scrollAfter.ui.timeline.scroll_y;
  // Thin scrollbars must accept a near miss and drag the real track.
  const track = (await js("effectcraft.request('ui.elements',{prefix:'timeline.scroll'})"))[0];
  assert(track, "overflowing timeline draws a scrollbar");
  const [tx, ty, tw, th] = track.rect;
  const start = { x: (tx + tw / 2) * ratio - 8, y: (ty + th / 2) * ratio };
  await touch("touchStart", [start]);
  await touch("touchMove", [{ x: start.x, y: start.y + 30 }]); await pause(100);
  await touch("touchEnd", []); await pause(150);
  assert((await js("effectcraft.inspect()")).ui.timeline.scroll_y > scrollAfter.ui.timeline.scroll_y, "near-track scrollbar drag is functional");
  report.scrollbarDrag = true;
  console.log("Real-touch timeline swipe and enlarged scrollbar target passed");
  // Maximise the viewer, then pinch. A remaining finger must not modify layer selection.
  await js("effectcraft.request('ui.menu.invoke',{id:'window.maximizePanel',params:{panel:'Composition'}})");
  await pause(150);
  const before = await js("effectcraft.inspect()");
  await touch("touchStart", [{ x: 500, y: 350 }, { x: 700, y: 350 }]);
  await touch("touchMove", [{ x: 430, y: 350 }, { x: 770, y: 350 }]);
  await pause(150); await touch("touchEnd", []); await pause(150);
  const after = await js("effectcraft.inspect()");
  assert(after.ui.viewer.zoom > (before.ui.viewer.zoom || 0), "pinch reaches the viewer zoom");
  assert.deepEqual(after.selectedLayers, before.selectedLayers);
  report.pinchZoom = after.ui.viewer.zoom;
  await js("effectcraft.execute('file.saveAs',{path:'/android-smoke.ecproj'})");
  const saved = await until("nativeExports.find(e=>e.name==='android-smoke.ecproj')");
  assert(saved.received > 0 && saved.received === saved.size, "Rust save reaches native export bridge without truncation");
  report.saved = saved;
  await js("effectcraft.flush()");
  await writeFile(join(out, "tablet.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const tabletUi = (await js("effectcraft.inspect()")).ui;
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until("effectcraft.touchLayout()?.phonePanel==='Composition'");
  await js("document.querySelector('#phone-nav button[aria-label=Timeline]').click()");
  await until("effectcraft.touchLayout()?.phonePanel==='Timeline'");
  await js("effectcraft.execute('layer.select',{layers:['Sideways gesture guard']})");
  const phoneLayer = (await js("effectcraft.execute('layer.tree',{depth:0})")).id;
  await revealEditingProperty(phoneLayer, 'transform/opacity');
  report.phoneSidewaysOverKey = await sidewaysOverKey();
  report.phoneTimelineNavigation = await checkTimelineNavigation();
  report.phoneTouchEditing = await checkTouchEditing();
  const preview = (await js("effectcraft.request('ui.elements',{prefix:'phone.preview'})"))[0];
  const phoneTimeline = (await js("effectcraft.request('ui.elements',{prefix:'panel.Timeline'})"))[0];
  assert(preview && preview.rect[1]+preview.rect[3]<phoneTimeline.rect[1],"live preview stays visible above the phone timeline");
  report.phoneLivePreview = true;
  const splitter = (await js("effectcraft.request('ui.elements',{prefix:'dock.gutter.phonePreview'})"))[0];
  assert(splitter,"live preview has a touch resize handle");
  const canvasBounds = await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()");
  const splitterScale = await js("effectcraft.inspect().then(i=>i.pixelsPerPoint/devicePixelRatio)");
  const splitterPoint = {x:canvasBounds.x+(splitter.rect[0]+splitter.rect[2]/2)*splitterScale,y:canvasBounds.y+(splitter.rect[1]+splitter.rect[3]/2)*splitterScale};
  await touch('touchStart',[splitterPoint]);
  for(let n=1;n<=4;n++) { await touch('touchMove',[{x:splitterPoint.x,y:splitterPoint.y+n*8}]); await pause(35); }
  await touch('touchEnd',[]); await pause(150);
  assert((await js("effectcraft.request('ui.elements',{prefix:'phone.preview'})"))[0].rect[3]>preview.rect[3]+10,"preview divider resizes with a real finger drag");
  report.phonePreviewResize = true;
  await js("effectcraft.request('ui.set',{phonePreview:false})"); await pause(150);
  assert.equal((await js("effectcraft.request('ui.elements',{prefix:'phone.preview'})")).length,0,"preview can be hidden for more editing room");
  await js("effectcraft.request('ui.set',{phonePreview:true})"); await pause(150);
  const phoneRuler = (await js("effectcraft.request('ui.elements',{prefix:'timeline.ruler'})"))[0];
  assert(phoneRuler.rect[2] > 180, "compact outline leaves useful space for time bars");
  await writeFile(join(out, "phone-portrait.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  for (const [label, panel] of [["Media", "Project"], ["Effects", "EffectsPresets"], ["Preview", "Composition"]]) {
    await js(`document.querySelector('#phone-nav button[aria-label=${label}]').click()`);
    await until(`effectcraft.touchLayout()?.phonePanel==='${panel}'`);
    assert((await js(`effectcraft.request('ui.elements',{prefix:'panel.${panel}'})`)).length > 0, `${label} tab shows its panel`);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  assert.equal(await js("effectcraft.touchLayout()?.phonePanel"), "Composition", "phone layout survives landscape rotation");
  await js("document.querySelector('#phone-nav button[aria-label=Timeline]').click()");
  await until("effectcraft.touchLayout()?.phonePanel==='Timeline'"); await pause(150);
  const landscapePreview = (await js("effectcraft.request('ui.elements',{prefix:'phone.preview'})"))[0];
  const landscapeTimeline = (await js("effectcraft.request('ui.elements',{prefix:'panel.Timeline'})"))[0];
  assert(landscapePreview && landscapePreview.rect[0]+landscapePreview.rect[2]<landscapeTimeline.rect[0],"landscape preview is beside the timeline");
  report.landscapeLivePreview = true;
  await writeFile(join(out, "phone-landscape.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: true });
  await until("effectcraft.touchLayout()?.phonePanel===null");
  const restoredUi = (await js("effectcraft.inspect()")).ui;
  assert.deepEqual(restoredUi.dock, tabletUi.dock, "returning to tablet restores the original dock");
  assert.deepEqual(restoredUi.floating, tabletUi.floating);
  assert.equal(restoredUi.maximized, tabletUi.maximized);
  report.phonePanelsAndRotation = true;
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Android-mode editor: startup, storage, touch bar, long press, pinch, save bridge and resize passed");
} catch (error) {
  report.error = String(error.stack || error);
  report.chromeStderr = stderr;
  console.error(report.error);
  if (ws?.readyState === WebSocket.OPEN) {
    try { await writeFile(join(out, "failure.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); } catch {}
  }
  process.exitCode = 1;
} finally {
  report.errors = errors;
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  ws?.close(); chrome.kill(); server.close(); clearTimeout(deadline);
}

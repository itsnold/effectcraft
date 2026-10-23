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
  await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 450, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  await writeFile(join(out, "phone-landscape.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
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

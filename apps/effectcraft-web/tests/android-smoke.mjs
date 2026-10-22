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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  // A fake native export sink lets us verify the real Rust-generated blob download end to end.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.nativeExports=[];window.ECDroidNative={
      begin(name,mime,size){this.current={name,mime,size,received:0};return ''},
      chunk(data){this.current.received+=atob(data).length;return ''},
      finish(){nativeExports.push(this.current);return ''},abort(){}
    };
  ` });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?android&nosw&frameworkers=1&nogpuworkers` });
  const load = await until("window.effectcraftLoad?.error || window.effectcraftLoad?.readyMs");
  assert.equal(typeof load, "number", String(load));
  report.info = await js("effectcraft.info()");
  assert.notEqual(report.info.storage.backend, "memory", "private storage must persist");
  assert(await js("document.querySelectorAll('#touch-bar button').length >= 12"));
  await js("document.querySelector('#touch-bar button[aria-label=\"Hand tool (drag to pan the composition)\"]').click()");
  await until("effectcraft.inspect().then(i=>i.ui.tool==='Hand')");
  await js("effectcraft.request('ui.set',{tool:'Selection'})");
  await js("effectcraft.request('ui.menu.invoke',{id:'window.maximizePanel',params:{panel:'Timeline'}})");
  const elements = await js("effectcraft.request('ui.elements',{prefix:'timeline.'})");
  const row = elements.find((e) => /^timeline\.layer\.\d+\.row$/.test(e.id));
  // Long-press on a layer row, not a synthetic API click: validates capture and right-click routing.
  if (!row) throw new Error(`No layer row found: ${elements.map((e) => e.id).slice(0, 100)}`);
  const [x, y, width, height] = row.rect;
  await touch("touchStart", [{ x: x + width * 0.65, y: y + height / 2 }]);
  await pause(650);
  await touch("touchEnd", []);
  await until("effectcraft.request('ui.elements',{prefix:'timeline.layerMenu'}).then(e=>e.length>0)");
  report.longPressMenu = true;
  await js("effectcraft.request('ui.key',{key:'Escape'})");
  // Maximise the viewer, then pinch. A remaining finger must not modify layer selection.
  await js("effectcraft.request('ui.menu.invoke',{id:'window.maximizePanel',params:{panel:'Composition'}})");
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
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.errors = errors;
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  ws?.close(); chrome.kill(); server.close(); clearTimeout(deadline);
}

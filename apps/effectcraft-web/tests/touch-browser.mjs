// Real Chromium finger input through the DOM adapter; independent of a WASM build.
// node apps/effectcraft-web/tests/touch-browser.mjs --chrome /path/to/chrome
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const chromeAt = process.argv.indexOf("--chrome");
const executable = chromeAt < 0 ? "google-chrome" : process.argv[chromeAt + 1];
const profile = await mkdtemp(join(tmpdir(), "ec-touch-"));
const source = await readFile(new URL("../web/touch.js", import.meta.url));
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}canvas{position:absolute;inset:0;width:100%;height:100%}</style>
<canvas id="effectcraft_canvas"></canvas><script type="module">
import { installTouch, installTouchBar, dismissTouchOverlay } from '/touch.js';
window.events=[];window.calls=[];window.scale=100;
window.layout={pixelsPerPoint:devicePixelRatio,viewers:[[200,0,400,500]],scrollbars:[[620,40,4,400]],overlay:false};
window.effectcraft={dismissTouchOverlay,touchLayout:()=>layout,request:async(...a)=>calls.push(a),
 execute:async(id,p)=>id==='prefs.get'?scale:(scale=p.values['appearance.uiScale']),flush:async()=>{}};
const canvas=document.querySelector('canvas');
window.adapter=installTouch(canvas);installTouchBar(canvas,adapter);
for(const type of ['pointerdown','pointerup','mousemove','wheel','mouseleave'])
 document.addEventListener(type,e=>events.push({type,pointerType:e.pointerType,x:e.clientX,y:e.clientY,
 buttons:e.buttons,button:e.button,dx:e.deltaX,dy:e.deltaY,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,trusted:e.isTrusted}));
window.ready=true;
</script>`;
const server = createServer((req, res) => res.writeHead(200, {"Content-Type": req.url === "/touch.js" ? "text/javascript" : "text/html"}).end(req.url === "/touch.js" ? source : html));
await new Promise(r => server.listen(0, "127.0.0.1", r));
const chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {stdio:["ignore","ignore","pipe"]});
let stderr="", ws, seq=0;
const errors=[];
const pending=new Map();
chrome.stderr.on("data", b => stderr=(stderr+b).slice(-10000));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={}) { return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}); }
async function js(expression) { const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value; }
const touch=(type,points)=>send("Input.dispatchTouchEvent",{type,touchPoints:points.map((p,i)=>({id:i+1,radiusX:2,radiusY:2,...p}))});
async function swipe(start,end) {
 await touch("touchStart",[start]);
 for(let n=1;n<=5;n++){await touch("touchMove",[{x:start.x+(end.x-start.x)*n/5,y:start.y+(end.y-start.y)*n/5}]);await pause(20);}
 await touch("touchEnd",[]);await pause(50);
}
const deadline=setTimeout(()=>{console.error("touch browser timed out",stderr);chrome.kill();process.exit(1);},60000);
try {
 let port;
 for(let i=0;i<100&&!port;i++){try{port=(await readFile(join(profile,"DevToolsActivePort"),"utf8")).split('\n')[0];}catch{await pause(50);}}
 assert(port,stderr);
 const page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 await send("Page.enable");await send("Runtime.enable");
 await send("Emulation.setDeviceMetricsOverride",{width:800,height:600,deviceScaleFactor:2,mobile:true});
 await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
 await send("Page.navigate",{url:`http://127.0.0.1:${server.address().port}`});
 for(let i=0;i<100&&!await js("window.ready");i++)await pause(50);
 assert(await js("window.ready"),JSON.stringify({location:await js("location.href"),errors,stderr}));
 await swipe({x:100,y:300},{x:103,y:180});
 let events=await js("events.splice(0)");
 assert(events.some(e=>e.type==='wheel'&&e.dy>0&&e.dx===0));
 assert(!events.some(e=>e.type==='pointerdown'),"panel swipe must not press a widget");
 await swipe({x:300,y:300},{x:300,y:180});events=await js("events.splice(0)");
 assert.equal(events.filter(e=>e.type==='pointerdown'&&e.pointerType==='mouse').length,1);
 assert(events.some(e=>e.type==='mousemove'&&e.buttons===1));
 assert.equal(events.filter(e=>e.type==='pointerup'&&e.pointerType==='mouse').length,1);
 assert(!events.some(e=>e.type==='wheel'),"viewer movement stays a drag");
 await swipe({x:613,y:150},{x:613,y:250});events=await js("events.splice(0)");
 assert(events.some(e=>e.type==='pointerdown'&&e.x===622),"near-track touch snaps to actual scrollbar");
 assert(events.some(e=>e.type==='mousemove'&&e.x===622&&e.buttons===1));
 await js("adapter.modifiers.shiftKey=true;adapter.modifiers.altKey=true;adapter.modifiers.ctrlKey=true");
 await swipe({x:100,y:300},{x:100,y:200});events=await js("events.splice(0)");
 assert(events.filter(e=>e.type==='wheel').every(e=>!e.ctrl&&!e.shift&&!e.alt),"latched editing modifiers cannot hijack scrolling");
 for(let i=0;i<events.length;i++)if(events[i].type==='wheel') {
  const hover=events[i-1];assert.equal(hover.type,'mousemove');
  assert(!hover.ctrl&&!hover.alt&&!hover.shift,"eframe RawInput modifiers are also cleared before scrolling");
 }
 await js("adapter.modifiers.shiftKey=false;adapter.modifiers.altKey=false;adapter.modifiers.ctrlKey=false");
 await touch("touchStart",[{x:300,y:300},{x:400,y:300}]);
 await touch("touchMove",[{x:260,y:300},{x:440,y:300}]);await pause(30);
 await touch("touchEnd",[{x:260,y:300}]);await touch("touchMove",[{x:220,y:300}]);await touch("touchEnd",[]);
 events=await js("events.splice(0)");assert(events.some(e=>e.type==='wheel'&&e.ctrl));assert(!events.some(e=>e.type==='pointerdown'));
 await js("adapter.controls.mode='scroll'");
 await swipe({x:400,y:300},{x:280,y:300});events=await js("events.splice(0)");
 assert(events.some(e=>e.type==='wheel'&&e.dx>0&&e.dy===0));
 await js("adapter.controls.mode='drag'");
 await swipe({x:100,y:300},{x:100,y:200});events=await js("events.splice(0)");assert(events.some(e=>e.type==='pointerdown'));
 await js("adapter.controls.mode='auto'");
 await touch("touchStart",[{x:300,y:300}]);await touch("touchMove",[{x:300,y:250}]);
 await js("dispatchEvent(new Event('blur'))");await touch("touchEnd",[]);events=await js("events.splice(0)");
 assert.equal(events.filter(e=>e.type==='pointerup').length,1,"blur releases a drag exactly once");
 // Native mouse and pen do not take the touch path.
 for(const pointerType of ['mouse','pen']) {
  await send("Input.dispatchMouseEvent",{type:'mousePressed',x:100,y:100,button:'left',clickCount:1,pointerType});
  await send("Input.dispatchMouseEvent",{type:'mouseReleased',x:100,y:100,button:'left',clickCount:1,pointerType});
 }
 events=await js("events.splice(0)");assert(events.some(e=>e.type==='pointerdown'&&e.pointerType==='pen'&&e.trusted));
 assert(events.some(e=>e.type==='pointerdown'&&e.pointerType==='mouse'&&e.trusted));
 // The shortcut bar must itself pan horizontally, without firing a shortcut while swiping.
 await swipe({x:650,y:575},{x:100,y:575});
 assert(await js("document.querySelector('#touch-bar').scrollLeft>100"));
 assert.equal(await js("calls.length"),0,"scrolling shortcut bar cannot trigger actions");
 await js("document.querySelector('#touch-bar button[aria-label=\"Adjust editor UI scale\"]').click()");
 await pause(50);assert(await js("!!document.querySelector('#touch-error select')"));
 await js("document.querySelector('#touch-error select').value='85';[...document.querySelectorAll('#touch-error button')].find(b=>b.textContent==='Apply').click()");
 await pause(50);assert.equal(await js("scale"),85);
 // Back dismisses DOM dialogs, engine menus and text edits before allowing exit.
 await js("document.querySelector('#touch-bar button[aria-label=\"Adjust editor UI scale\"]').click()");
 await pause(50);assert.equal(await js("effectcraft.dismissTouchOverlay()"),true);
 assert.equal(await js("!!document.querySelector('#touch-error')"),false);
 await js("layout.overlay=true");assert.equal(await js("effectcraft.dismissTouchOverlay()"),true);
 assert.equal(await js("calls.at(-1)[1].key"),'Escape');
 await js("layout.overlay=false;layout.keyboardFocus=true");assert.equal(await js("effectcraft.dismissTouchOverlay()"),true);
 await js("layout.keyboardFocus=false");assert.equal(await js("effectcraft.dismissTouchOverlay()"),false);
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log("touch browser: real finger swipes, viewer/scrollbar drags, overrides, pinch, modifiers, blur, mouse/pen, shortcut-bar scrolling scale picker and Back dismissal passed");
} finally {
 clearTimeout(deadline);ws?.close();chrome.kill();server.close();
 await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}

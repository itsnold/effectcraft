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
const phoneSource = await readFile(new URL("../web/phone.js", import.meta.url));
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}canvas{position:absolute;inset:0;width:100%;height:100%}</style>
<canvas id="effectcraft_canvas"></canvas><script type="module">
import { installTouch, installTouchBar, dismissTouchOverlay } from '/touch.js';
window.events=[];window.calls=[];window.scale=100;
 window.layout={pixelsPerPoint:devicePixelRatio,viewers:[[200,0,400,500]],scrolls:[[0,0,200,500]],
   holdDrags:[[20,160,160,40]],scrubs:[[20,220,100,24]],marquees:[[0,260,200,200]],
   marqueeBlocks:[[20,160,160,40]],trims:[{rect:[16,160,9,40],clip:[0,0,200,500]}],
 controls:[[0,20,200,34]],controlTracks:[[20,480,160,4]],scrollbars:[[620,40,4,400]],overlay:false};
window.effectcraft={dismissTouchOverlay,touchLayout:()=>layout,request:async(...a)=>{
 calls.push(a);if(a[0]==='ui.set'&&'phonePanel' in a[1])layout.phonePanel=a[1].phonePanel;
 if(a[0]==='ui.menu.list')return [{id:'comp.new',label:'New Composition',path:['Composition'],enabled:true}];
},
 execute:async(id,p)=>id==='prefs.get'?scale:(scale=p.values['appearance.uiScale']),flush:async()=>{}};
const canvas=document.querySelector('canvas');
window.adapter=installTouch(canvas);installTouchBar(canvas,adapter);
 for(const type of ['pointerdown','pointerup','mousemove','wheel','mouseleave','click'])
 document.addEventListener(type,e=>events.push({type,pointerType:e.pointerType,x:e.clientX,y:e.clientY,
 buttons:e.buttons,button:e.button,dx:e.deltaX,dy:e.deltaY,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,trusted:e.isTrusted}));
window.ready=true;
</script>`;
const server = createServer((req, res) => res.writeHead(200, {"Content-Type": req.url?.endsWith(".js") ? "text/javascript" : "text/html"}).end(req.url === "/touch.js" ? source : req.url === "/phone.js" ? phoneSource : html));
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
const deadline=setTimeout(()=>{console.error("touch browser timed out",stderr);chrome.kill();process.exit(1);},90000);
try {
 let port;
 // Cold CI browsers can take more than five seconds to publish their debugging port.
 const startupDeadline=Date.now()+30000;
 while(!port&&Date.now()<startupDeadline){
  try{port=(await readFile(join(profile,"DevToolsActivePort"),"utf8")).split('\n')[0];}catch{await pause(100);}
 }
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
  await swipe({x:180,y:300},{x:50,y:302});events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='wheel'&&e.dx>0&&e.dy===0),"Auto scrolls sideways in timeline/list regions");
   assert(!events.some(e=>e.type==='pointerdown'),"sideways scrolling cannot grab a layer or key");
  await swipe({x:50,y:35},{x:150,y:35});events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='pointerdown'&&e.pointerType==='mouse'),"Auto allows ruler/playhead scrubbing");
  assert(events.some(e=>e.type==='mousemove'&&e.buttons===1));
  assert(!events.some(e=>e.type==='wheel'),"scrubbing must not scroll");
  await swipe({x:40,y:475},{x:140,y:475});events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='pointerdown'&&e.y===482),"nearby zoom track is a real drag, snapped onto the slider");
  assert(events.some(e=>e.type==='mousemove'&&e.buttons===1&&e.y===482));
  assert(!events.some(e=>e.type==='wheel'));
  // The actual DOM path must wait for the hold, then emit only a primary drag.
  await touch("touchStart",[{x:80,y:180}]);await pause(600);
  events=await js("events.splice(0)");assert(!events.some(e=>e.type==='pointerdown'),"arming cannot right-click first");
  await touch("touchMove",[{x:120,y:180}]);await pause(30);await touch("touchEnd",[]);
  events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='pointerdown'&&e.button===0&&e.x===80));
  assert(events.some(e=>e.type==='mousemove'&&e.buttons===1));
  assert(!events.some(e=>e.button===2||e.type==='wheel'),"held editing is neither a context menu nor a scroll");
  await touch("touchStart",[{x:80,y:180}]);await pause(600);await touch("touchEnd",[]);
   events=await js("events.splice(0)");assert(events.some(e=>e.type==='pointerdown'&&e.button===2),"release a stationary hold for options");
   // A near miss just outside the narrow native trim zone must arm, not right-click.
   await touch("touchStart",[{x:10,y:180}]);await pause(600);
   assert(!(await js("events.splice(0)")).some(e=>e.type==='pointerdown'));
   await touch("touchMove",[{x:50,y:180}]);await pause(30);await touch("touchEnd",[]);
   events=await js("events.splice(0)");
   assert(events.some(e=>e.type==='pointerdown'&&e.button===0&&e.x===20.5));
   assert(!events.some(e=>e.button===2||e.type==='wheel'));
   await js("document.querySelector('#touch-bar button[aria-label=\"Toggle clip trimming: drag the left or right edge\"]').click()");
   await pause(30);assert.equal(await js("adapter.controls.mode"),'trim');
   await swipe({x:10,y:180},{x:50,y:180});events=await js("events.splice(0)");
   assert(events.some(e=>e.type==='pointerdown'&&e.button===0&&e.x===20.5),'Trim starts at the true edge without holding');
   assert(!events.some(e=>e.button===2||e.type==='wheel'));
   await js("document.querySelector('#touch-bar button[aria-label=\"Toggle clip trimming: drag the left or right edge\"]').click()");
   await pause(30);assert.equal(await js("adapter.controls.mode"),'auto');
   // Empty timeline space supports a held marquee in Auto, or immediate Box select.
   await touch("touchStart",[{x:100,y:330}]);await pause(600);
   assert(!(await js("events.splice(0)")).some(e=>e.type==='pointerdown'));
   await touch("touchMove",[{x:150,y:290}]);await pause(30);await touch("touchEnd",[]);
   events=await js("events.splice(0)");
   assert(events.some(e=>e.type==='pointerdown'&&e.button===0));
   assert(!events.some(e=>e.button===2||e.type==='wheel'));
   await js("document.querySelector('#touch-bar button[aria-label=\"Toggle timeline box selection: drag from empty space\"]').click()");
   await pause(30);assert.equal(await js("adapter.controls.mode"),'box');
   assert.equal(await js("document.querySelector('#touch-bar button[aria-label=\"Toggle timeline box selection: drag from empty space\"]').getAttribute('aria-pressed')"),'true');
   await swipe({x:100,y:330},{x:150,y:290});events=await js("events.splice(0)");
   assert(events.some(e=>e.type==='pointerdown'&&e.button===0));
   assert(!events.some(e=>e.button===2||e.type==='wheel'));
   await swipe({x:80,y:180},{x:140,y:180});events=await js("events.splice(0)");
   assert(events.some(e=>e.type==='wheel'),'Box select cannot move a bar underneath the finger');
   assert(!events.some(e=>e.type==='pointerdown'));
   await js("document.querySelector('#touch-bar button[aria-label=\"Toggle timeline box selection: drag from empty space\"]').click()");
   await pause(30);assert.equal(await js("adapter.controls.mode"),'auto');
  await swipe({x:40,y:230},{x:140,y:230});events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='mousemove'&&e.buttons===1),"horizontal scrub works inside a scrollable panel");
  assert(!events.some(e=>e.type==='wheel'));
  await swipe({x:40,y:230},{x:41,y:290});events=await js("events.splice(0)");
  assert(events.some(e=>e.type==='wheel'&&e.dy<0),"vertical swipe over a number still scrolls");
  assert(!events.some(e=>e.type==='pointerdown'));
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
   // Shortcuts are direct buttons again: swiping the bar must not invoke any of them.
   assert.equal(await js("!!document.querySelector('#touch-bar button[aria-label=\"Open editing tools\"]')"),false);
   const callsBeforeSwipe = await js("calls.length");
   await swipe({x:650,y:575},{x:100,y:575});
   // A fling keeps scrolling after touchEnd; a tap during that motion only stops it.
   await pause(800);
   assert(await js("document.querySelector('#touch-bar').scrollLeft>100"));
   assert.equal(await js("calls.length"),callsBeforeSwipe,"scrolling shortcut bar cannot trigger actions");
   await js("document.querySelector('#touch-bar button[aria-label=\"Adjust editor UI scale\"]').scrollIntoView({block:'nearest',inline:'center'})");
   await pause(100);
   const scaleButton = await js("(()=>{const b=document.querySelector('#touch-bar button[aria-label=\"Adjust editor UI scale\"]');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,display:getComputedStyle(b).display}})()");
   assert.notEqual(scaleButton.display,'none');
   assert.equal(await js(`document.elementFromPoint(${scaleButton.x},${scaleButton.y})?.getAttribute('aria-label')`),'Adjust editor UI scale','tap lands on the direct shortcut');
   await js('events.splice(0)');
   await touch('touchStart',[{x:scaleButton.x,y:scaleButton.y}]);await pause(30);await touch('touchEnd',[]);await pause(100);
   assert(await js("!!document.querySelector('#touch-error')"),JSON.stringify({scaleButton,events:await js('events.splice(0)'),calls:await js('calls')}));
   assert.equal(await js("document.querySelector('#touch-error').tagName"),'DIALOG');
   assert(await js("document.querySelector('#touch-error').matches(':modal')"));
   assert(await js("!!document.querySelector('#touch-error select')"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await pause(50);
  assert.equal(await js("!!document.querySelector('#touch-error')"),false);
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
  // Phone chrome, tab selection, searchable menu and rotation use the actual DOM.
  await js("(async()=>{window.phone=(await import('/phone.js')).installPhoneWorkspace(effectcraft);await phone.start()})()");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await pause(100);
  assert.equal(await js("document.documentElement.dataset.phoneLayout"),'true');
  await js("document.querySelector('#phone-nav button[aria-label=Timeline]').click()");await pause(100);
  assert.equal(await js("layout.phonePanel"),'Timeline');
  const canvasBox=await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width}})()");
  assert.equal(canvasBox.top,68);assert.equal(canvasBox.bottom,744);assert.equal(canvasBox.width,390);
   await js("document.querySelector('#phone-toolbar button[aria-label=Menu]').click()");await pause(100);
   assert.equal(await js("document.querySelector('#touch-error').getAttribute('role')"),'dialog','normal menus are not error alerts');
   assert(await js("(()=>{const r=document.querySelector('#touch-error').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight+1})()"),'phone sheet fits the viewport');
   assert.equal(await js("document.querySelector('#phone-commands button').textContent"),'Composition ›');
   await js("document.querySelector('#phone-commands button').click()");await pause(50);
   await js("[...document.querySelectorAll('#phone-commands button')].find(b=>b.textContent==='New Composition').click()");await pause(100);
  assert.equal(await js("calls.at(-1)[1].id"),'comp.new');
  for(const [label,id] of [['Zoom timeline in','timeline.zoomIn'],['Zoom timeline out','timeline.zoomOut'],
   ['Fit the whole composition in the timeline','timeline.zoomFit'],['Move playhead one frame forward','time.nextFrame'],['Move playhead one frame backward','time.previousFrame']]) {
   await js(`document.querySelector('#touch-bar button[aria-label="${label}"]').click()`);await pause(30);
   assert.equal(await js("calls.at(-1)[1].id"),id);
  }
  await send("Emulation.setDeviceMetricsOverride",{width:844,height:390,deviceScaleFactor:2,mobile:true});await pause(100);
  assert.equal(await js("document.documentElement.dataset.phoneLayout"),'true');
  assert.equal(await js("layout.phonePanel"),'Timeline',"rotation keeps the current phone panel");
  await js("document.querySelector('#phone-nav button[aria-label=More]').click()");await pause(50);
  await js("[...document.querySelectorAll('#touch-error button')].find(b=>b.textContent==='Tablet layout').click()");await pause(100);
  assert.equal(await js("layout.phonePanel"),null);assert.equal(await js("document.documentElement.dataset.phoneLayout"),'false');
  await js("phone.controller.setMode('auto')");
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:800,deviceScaleFactor:2,mobile:true});await pause(100);
  assert.equal(await js("document.documentElement.dataset.phoneLayout"),'false');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log("touch browser: real finger swipes, viewer/scrollbar drags, overrides, pinch, modifiers, blur, mouse/pen, shortcut-bar scrolling scale picker and Back dismissal passed");
} finally {
 clearTimeout(deadline);ws?.close();chrome.kill();server.close();
 await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}

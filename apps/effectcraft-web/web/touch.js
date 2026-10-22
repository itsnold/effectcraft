// Original Android/tablet input adapter. No proprietary UI code or artwork.
// Keep gesture arbitration independent of the DOM so it can be regression-tested under Node.
export class TouchGesture {
  constructor(emit, schedule = setTimeout, cancel = clearTimeout) {
    this.emit = emit;
    this.schedule = schedule;
    this.cancel = cancel;
    this.points = new Map();
    this.reset();
  }
  reset() {
    this.cancel(this.timer);
    this.timer = null;
    this.mode = "idle";
    this.origin = null;
    this.previous = null;
  }
  pointer(type, p, button = 0) { this.emit({ type, ...p, button }); }
  pair() {
    const [a, b] = [...this.points.values()];
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  down(id, p) {
    if (![p.x, p.y].every(Number.isFinite)) return;
    this.points.set(id, p);
    if (this.points.size === 1) {
      this.reset();
      this.origin = p;
      this.mode = "pending";
      this.timer = this.schedule(() => {
        if (this.mode !== "pending") return;
        this.mode = "held";
        this.pointer("move", p);
        this.pointer("down", p, 2);
        this.pointer("up", p, 2);
        this.emit({ type: "haptic" });
      }, 500);
    } else {
      this.cancel(this.timer);
      if (this.mode === "drag") this.pointer("up", this.points.values().next().value);
      this.mode = this.points.size === 2 ? "two" : "ignore";
      this.previous = this.pair();
      this.anchor = this.previous;
    }
  }
  move(id, p) {
    if (!this.points.has(id) || ![p.x, p.y].every(Number.isFinite)) return;
    this.points.set(id, p);
    if (this.points.size === 1) {
      if (this.mode === "pending" && Math.hypot(p.x - this.origin.x, p.y - this.origin.y) > 9) {
        this.cancel(this.timer);
        this.mode = "drag";
        this.pointer("move", this.origin);
        this.pointer("down", this.origin);
      }
      if (this.mode === "drag") this.pointer("move", p);
      return;
    }
    if (this.points.size !== 2 || this.mode === "ignore") return;
    const pair = this.pair();
    if (this.mode === "two") {
      const zoom = Math.abs(Math.log(pair.distance / this.anchor.distance));
      const pan = Math.hypot(pair.x - this.anchor.x, pair.y - this.anchor.y);
      if (zoom > 0.045) this.mode = "pinch";
      else if (pan > 8) this.mode = "pan";
      else return;
    }
    this.pointer("move", pair);
    if (this.mode === "pinch") {
      this.emit({ type: "wheel", x: pair.x, y: pair.y, dx: 0, dy: -100 * Math.log(pair.distance / this.previous.distance), zoom: true });
    } else if (this.mode === "pan") {
      this.emit({ type: "wheel", x: pair.x, y: pair.y, dx: this.previous.x - pair.x, dy: this.previous.y - pair.y, zoom: false });
    }
    this.previous = pair;
  }
  up(id, p, cancelled = false) {
    if (!this.points.has(id)) return;
    this.cancel(this.timer);
    if (this.mode === "pending" && !cancelled) {
      this.pointer("move", p);
      this.pointer("down", p);
      this.pointer("up", p);
    } else if (this.mode === "drag") this.pointer("up", p);
    this.points.delete(id);
    // A remaining finger after a two-finger gesture must NOT turn into a click or layer drag.
    if (this.points.size) this.mode = "ignore";
    else this.reset();
  }
  cancelAll() {
    if (this.mode === "drag" && this.points.size) this.pointer("up", this.points.values().next().value);
    this.points.clear();
    this.reset();
  }
}

export function installTouch(canvas) {
  const modifiers = { shiftKey: false, altKey: false, ctrlKey: false };
  const gesture = new TouchGesture((event) => {
    if (event.type === "haptic") { navigator.vibrate?.(15); return; }
    const common = { bubbles: true, cancelable: true, clientX: event.x, clientY: event.y, ...modifiers };
    if (event.type === "wheel") {
      canvas.dispatchEvent(new WheelEvent("wheel", { ...common, deltaX: event.dx, deltaY: event.dy, deltaMode: 0, ctrlKey: event.zoom }));
    } else if (event.type === "move") {
      canvas.dispatchEvent(new MouseEvent("mousemove", common));
    } else {
      canvas.dispatchEvent(new PointerEvent(event.type === "down" ? "pointerdown" : "pointerup", {
        ...common, pointerType: "mouse", button: event.button,
        buttons: event.type === "down" ? (event.button === 2 ? 2 : 1) : 0,
      }));
    }
  });
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return; // Mouse and stylus keep their native precision/pressure.
    stop(e);
    canvas.setPointerCapture?.(e.pointerId);
    gesture.down(e.pointerId, { x: e.clientX, y: e.clientY });
  }, { capture: true, passive: false });
  for (const type of ["pointermove", "pointerup", "pointercancel"]) {
    document.addEventListener(type, (e) => {
      if (e.pointerType !== "touch" || !gesture.points.has(e.pointerId)) return;
      stop(e);
      const p = { x: e.clientX, y: e.clientY };
      if (type === "pointermove") gesture.move(e.pointerId, p);
      else gesture.up(e.pointerId, p, type === "pointercancel");
    }, { capture: true, passive: false });
  }
  // eframe also listens for legacy touch events; don't feed the same gesture to it twice.
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel", "contextmenu"]) {
    canvas.addEventListener(type, stop, { capture: true, passive: false });
  }
  window.addEventListener("blur", () => gesture.cancelAll());
  document.addEventListener("visibilitychange", () => { if (document.hidden) gesture.cancelAll(); });
  return modifiers;
}

export function installTouchBar(canvas, modifiers) {
  const bar = document.createElement("nav");
  bar.id = "touch-bar";
  bar.setAttribute("aria-label", "Touch editing shortcuts");
  const style = document.createElement("style");
  style.textContent = `
    #touch-bar { position:fixed; bottom:0; left:0; right:0; height:52px; display:flex;
      gap:6px; padding:4px 8px; box-sizing:border-box; overflow-x:auto; background:#202126;
      border-top:1px solid #444; font:14px system-ui; z-index:5; }
    #touch-bar button { flex-shrink:0; min-width:48px; min-height:44px; padding:0 12px;
      border:1px solid #555; border-radius:8px; background:#30323a; color:#fff; font:inherit; }
    #touch-bar button[aria-pressed=true] { background:#245c9c; }
    #effectcraft_canvas { height:calc(100% - 52px) !important; bottom:52px; }
    #touch-error { position:fixed; inset:10%; z-index:20; background:#25262c; color:white;
      padding:24px; font:16px system-ui; overflow:auto; border:1px solid #888; }
    #touch-error button { min-height:48px; margin:8px; padding:8px 20px; }
  `;
  document.head.append(style);
  const button = (label, title, action) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    // Avoid stealing text-editor focus until the action has been delivered.
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.onclick = () => Promise.resolve().then(action).catch((e) => showTouchError(String(e)));
    bar.append(b);
    return b;
  };
  const invoke = (id, params = {}) => window.effectcraft.request("ui.menu.invoke", { id, params });
  button("Undo", "Undo", () => invoke("edit.undo"));
  button("Redo", "Redo", () => invoke("edit.redo"));
  button("Play", "Play / stop preview", () => window.effectcraft.request("ui.playback", {}));
  button("Save", "Save project to an Android document", () => invoke("file.save"));
  button("Open", "Open an existing project using the system picker", () => invoke("file.open"));
  button("Import", "Import media using the system picker", () => invoke("file.import"));
  button("Select", "Selection tool", () => window.effectcraft.request("ui.set", { tool: "Selection" }));
  button("Hand", "Hand tool (drag to pan the composition)", () => window.effectcraft.request("ui.set", { tool: "Hand" }));
  button("Fit", "Fit composition to viewer", () => window.effectcraft.request("ui.set", { viewer: { zoom: null, pan: [0, 0] } }));
  for (const [label, key] of [["Shift", "shiftKey"], ["Alt", "altKey"], ["Ctrl", "ctrlKey"]]) {
    const b = button(label, `Toggle ${label} for multi-select / modified drags`, () => {
      modifiers[key] = !modifiers[key]; b.setAttribute("aria-pressed", String(modifiers[key]));
    });
    b.setAttribute("aria-pressed", "false");
  }
  button("Viewer", "Maximize / restore Composition panel", () => invoke("window.maximizePanel", { panel: "Composition" }));
  button("Timeline", "Maximize / restore Timeline panel", () => invoke("window.maximizePanel", { panel: "Timeline" }));
  button("Help", "Touch controls and Android limitations", () => showTouchError(
    "Tap to select. Drag to move or trim. Hold still for 0.5 seconds for a right-click menu. " +
    "Pinch with two fingers to zoom the timeline or composition; move two fingers together to scroll panels and the timeline. " +
    "Use Hand to pan the composition. Shift enables multi-select; tap it again when finished. " +
    "Viewer / Timeline expands that panel. Settings > Appearance > UI Scale enlarges editor controls. " +
    "Landscape or a tablet is recommended. Save exports an .ecproj; session recovery alone is not a backup. " +
    "Android alpha: small projects first; software rendering and video export can be slow."
  ));
  document.body.append(bar);
}

export function showTouchError(message, retry) {
  const old = document.getElementById("touch-error");
  if (old) old.remove();
  const box = document.createElement("section");
  box.id = "touch-error"; box.setAttribute("role", "alertdialog");
  const text = document.createElement("p"); text.textContent = message; box.append(text);
  if (retry) {
    const button = document.createElement("button"); button.textContent = "Retry export";
    button.onclick = () => { box.remove(); retry(); }; box.append(button);
  }
  const close = document.createElement("button"); close.textContent = "Close";
  close.onclick = () => box.remove(); box.append(close);
  document.body.append(box);
}

// WebView's DownloadManager cannot download blob: URLs. Catch the editor's download anchors,
// then transfer bounded chunks to app-private temporary storage and ACTION_CREATE_DOCUMENT.
export async function transferAndroidBlob(bridge, name, data) {
  const check = (error) => { if (error) throw new Error(error); };
  try {
    check(bridge.begin(name || "export.bin", data.type || "application/octet-stream", data.size));
    for (let offset = 0; offset < data.size; offset += 192 * 1024) {
      const bytes = new Uint8Array(await data.slice(offset, offset + 192 * 1024).arrayBuffer());
      let raw = "";
      for (const byte of bytes) raw += String.fromCharCode(byte);
      check(bridge.chunk(btoa(raw)));
    }
    check(bridge.finish());
  } catch (error) { bridge.abort(); throw error; }
}

export function installAndroidDownloads() {
  if (!window.ECDroidNative) return;
  let queue = Promise.resolve();
  let pending = 0;
  document.addEventListener("click", (event) => {
    const a = event.target?.closest?.("a[download]");
    if (!a || !a.href.startsWith("blob:")) return;
    event.preventDefault();
    // Start fetch immediately: Rust revokes the object URL later.
    const blob = fetch(a.href).then((response) => response.blob()).then((data) => ({ data }), (error) => ({ error }));
    const send = () => {
      if (pending >= 4) { showTouchError("Too many exports waiting. Finish the pending saves, then retry.", send); return; }
      pending++;
      queue = queue.then(async () => {
        const loaded = await blob;
        if (loaded.error) throw loaded.error;
        await transferAndroidBlob(window.ECDroidNative, a.download, loaded.data);
      }).catch((error) => showTouchError(`Export not saved: ${error}. The editor's output is unchanged.`, send))
        .finally(() => { pending--; });
    };
    send();
  }, true);
}

// Original Android/tablet input adapter. No proprietary UI code or artwork.
// Keep gesture arbitration independent of the DOM so it can be regression-tested under Node.
export class TouchGesture {
  constructor(emit, schedule = (fn, delay) => globalThis.setTimeout(fn, delay), cancel = (id) => globalThis.clearTimeout(id)) {
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
    this.policy = "drag";
  }
  pointer(type, p, button = 0) { this.emit({ type, ...p, button }); }
  pair() {
    const [a, b] = [...this.points.values()];
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  down(id, p, policy = "drag") {
    if (![p.x, p.y].every(Number.isFinite)) return;
    this.points.set(id, p);
    if (this.points.size === 1) {
      this.reset();
      this.origin = p;
      this.previous = p;
      this.policy = policy;
      this.mode = "pending";
      this.timer = this.schedule(() => {
        if (this.mode !== "pending") return;
        // Editable targets arm a primary drag; don't open a menu under the held finger.
        // Releasing without moving still offers that target's context menu.
        this.mode = ["hold-drag", "drag", "scrub"].includes(this.policy) ? "armed" : "held";
        if (this.mode === "held") this.context(p);
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
  context(p) {
    this.pointer("move", p);
    this.pointer("down", p, 2);
    this.pointer("up", p, 2);
  }
  move(id, p) {
    if (!this.points.has(id) || ![p.x, p.y].every(Number.isFinite)) return;
    this.points.set(id, p);
    if (this.points.size === 1) {
      if (["pending", "armed"].includes(this.mode) && Math.hypot(p.x - this.origin.x, p.y - this.origin.y) > 9) {
        this.cancel(this.timer);
        const dx = Math.abs(p.x - this.origin.x), dy = Math.abs(p.y - this.origin.y);
        const armed = this.mode === "armed";
        this.mode = !armed && (this.policy === "scroll" || this.policy === "hold-drag" ||
          (["auto", "scrub"].includes(this.policy) && dy > dx)) ? "scroll" : "drag";
        this.scrollAxis = dy > dx ? "y" : "x";
        if (this.mode === "drag") {
          this.pointer("move", this.origin);
          this.pointer("down", this.origin);
        }
      }
      if (this.mode === "drag") this.pointer("move", p);
      if (this.mode === "scroll") {
        // Keep the wheel's hover target at touch-down: crossing another panel while
        // swiping must not start scrolling that other panel instead.
        this.pointer("move", this.origin);
        this.emit({ type: "wheel", ...this.origin, dx: this.scrollAxis === "x" ? this.previous.x - p.x : 0, dy: this.scrollAxis === "y" ? this.previous.y - p.y : 0, zoom: false });
      }
      if (this.mode !== "pending") this.previous = p;
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
    if (cancelled || ![p.x, p.y].every(Number.isFinite)) p = this.points.get(id);
    if (!cancelled && this.points.size === 1 &&
        ((["pending", "armed"].includes(this.mode) && Math.hypot(p.x - this.origin.x, p.y - this.origin.y) > 9) ||
         (this.mode === "scroll" && (p.x !== this.previous.x || p.y !== this.previous.y)))) this.move(id, p);
    this.cancel(this.timer);
    if (this.mode === "armed" && !cancelled) {
      this.context(this.origin);
    } else if (this.mode === "pending" && !cancelled) {
      this.pointer("move", p);
      this.pointer("down", p);
      this.pointer("up", p);
    } else if (this.mode === "drag") {
      // Fast flicks may end between animation frames; deliver the final position too.
      this.pointer("move", p);
      this.pointer("up", p);
    }
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

// All rects come from the completed egui frame, in points. Convert via the actual UI
// scale and canvas origin, not screen resolution (Android density and UI Scale differ).
export function touchTarget(p, layout, bounds, density = 1, mode = "auto") {
  if (layout?.overlay && ["box", "trim"].includes(mode)) mode = "auto";
  const scale = (layout?.pixelsPerPoint || density) / density;
  const point = { x: (p.x - bounds.left) / scale, y: (p.y - bounds.top) / scale };
  const contains = ([x, y, w, h]) => w > 0 && h > 0 &&
    point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
  // These are the numeric widgets actually painted this frame, clipped to their panels.
  // They take precedence over timeline scrolling, including numbers in modal dialogs.
  if (mode === "auto" && (layout?.scrubs || []).some(contains)) {
    return { policy: "scrub", offset: { x: 0, y: 0 } };
  }
  // Thin desktop trim zones straddle each end of the bar. Snap a near miss to the real
  // zone, never to the body or an offscreen edge. Choose the nearest edge on short clips.
  if (!layout?.overlay && ["auto", "drag", "trim"].includes(mode)) {
    let nearest = null;
    for (const target of layout?.trims || []) {
      const { rect, clip } = target;
      if (rect?.length !== 4 || clip?.length !== 4 || !rect.every(Number.isFinite) || !clip.every(Number.isFinite)) continue;
      const [x, y, w, h] = rect;
      if (w <= 0 || h <= 0 || !contains(clip)) continue;
      const margin = Math.max(0, (32 / scale - w) / 2);
      if (!contains([x - margin, y, w + 2 * margin, h])) continue;
      const distance = Math.abs(point.x - x - w / 2);
      if (!nearest || distance < nearest.distance) nearest = { rect, distance };
    }
    if (nearest) {
      const [x, y, w, h] = nearest.rect;
      return { policy: mode === "auto" ? "hold-drag" : "drag", offset: {
        x: bounds.left + (x + w / 2) * scale - p.x,
        y: bounds.top + (y + h / 2) * scale - p.y,
      } };
    }
  }
  const marquee = !layout?.overlay && (layout?.marquees || []).some(contains) &&
    ![...(layout?.marqueeBlocks || []), ...(layout?.holdDrags || []), ...(layout?.scrubs || [])].some(contains);
  if (!layout?.overlay) {
    // Ruler/playhead, time display and time-zoom controls are deliberate edits, unlike
    // swiping layer bars or keys. Prefer exact hits before expanding neighbouring tracks.
    if (mode !== "scroll" && (layout?.controls || []).some((rect) => contains(rect))) {
      return { policy: "drag", offset: { x: 0, y: 0 } };
    }
    // A 24 CSS-pixel cross-axis target makes thin desktop tracks usable with a finger.
    for (const rect of [...(layout?.controlTracks || []), ...(layout?.scrollbars || [])]) {
      const [x, y, w, h] = rect;
      const vertical = h >= w;
      const margin = Math.max(0, (24 / scale - (vertical ? w : h)) / 2);
      const hit = vertical ? contains([x - margin, y, w + 2 * margin, h]) : contains([x, y - margin, w, h + 2 * margin]);
      if (hit) return { policy: "drag", offset: vertical
        ? { x: bounds.left + (x + w / 2) * scale - p.x, y: 0 }
        : { x: 0, y: bounds.top + (y + h / 2) * scale - p.y } };
    }
  }
  // Explicit modes are safe on occupied rows: a box must start in empty space, and
  // Trim must start at an edge, not silently move a clip or retime a key underneath.
  if (!layout?.overlay && ["box", "trim"].includes(mode)) {
    return { policy: mode === "box" && marquee ? "drag" : "scroll", offset: { x: 0, y: 0 } };
  }
  const editing = !layout?.overlay && [...(layout?.viewers || []), ...(layout?.drags || [])].some((rect) => contains(rect));
  const scrolling = !layout?.overlay && (layout?.scrolls || []).some((rect) => contains(rect));
  if (mode === "auto" && !layout?.overlay && ((layout?.holdDrags || []).some(contains) || marquee)) {
    return { policy: "hold-drag", offset: { x: 0, y: 0 } };
  }
  return { policy: mode === "auto" ? (editing ? "drag" : scrolling ? "scroll" : "auto") : mode, offset: { x: 0, y: 0 } };
}

export function installTouch(canvas, getLayout = () => window.effectcraft?.touchLayout?.()) {
  const modifiers = { shiftKey: false, altKey: false, ctrlKey: false };
  const controls = { mode: "auto" };
  let buttons = 0;
  let offset = { x: 0, y: 0 };
  // Keep owning native contacts until their physical release, even after blur/resize
  // has cancelled the logical gesture. Otherwise its later touch-up leaks to eframe
  // as a second release and may activate the widget now underneath that finger.
  const contacts = new Set();
  const gesture = new TouchGesture((event) => {
    if (event.type === "haptic") { navigator.vibrate?.(15); return; }
    const common = { bubbles: true, cancelable: true, clientX: event.x, clientY: event.y, ...modifiers };
    if (event.type === "wheel") {
      // A latched editing modifier must not turn panel scrolling into zoom/constrained scroll.
      // eframe also keeps modifiers from mousemove in RawInput (Timeline reads those),
      // so clearing only the WheelEvent's flags is insufficient. This also lets eframe
      // distinguish pinch's synthetic Ctrl from a physically held Ctrl key.
      canvas.dispatchEvent(new MouseEvent("mousemove", { ...common, buttons: 0,
        shiftKey: false, altKey: false, ctrlKey: false }));
      canvas.dispatchEvent(new WheelEvent("wheel", { ...common, shiftKey: false, altKey: false,
        deltaX: event.dx, deltaY: event.dy, deltaMode: 0, ctrlKey: event.zoom }));
    } else if (event.type === "move") {
      canvas.dispatchEvent(new MouseEvent("mousemove", { ...common, buttons }));
    } else {
      buttons = event.type === "down" ? (event.button === 2 ? 2 : 1) : 0;
      canvas.dispatchEvent(new PointerEvent(event.type === "down" ? "pointerdown" : "pointerup", {
        ...common, pointerType: "mouse", pointerId: 1, isPrimary: true, button: event.button, buttons,
      }));
    }
  });
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const position = (e) => ({ x: e.clientX + offset.x, y: e.clientY + offset.y });
  const clearHover = () => canvas.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
  const cancel = () => { gesture.cancelAll(); buttons = 0; clearHover(); };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return; // Mouse and stylus retain precision/pressure.
    stop(e);
    contacts.add(e.pointerId);
    if (!gesture.points.size) {
      const target = touchTarget({ x: e.clientX, y: e.clientY }, getLayout(), canvas.getBoundingClientRect(), window.devicePixelRatio || 1, controls.mode);
      offset = target.offset;
      controls.policy = target.policy;
    } else offset = { x: 0, y: 0 };
    canvas.setPointerCapture?.(e.pointerId);
    gesture.down(e.pointerId, position(e), controls.policy);
  }, { capture: true, passive: false });
  for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
    document.addEventListener(type, (e) => {
      if (e.pointerType !== "touch" || !contacts.has(e.pointerId)) return;
      stop(e);
      const p = position(e);
      if (type === "pointermove") gesture.move(e.pointerId, p);
      else {
        gesture.up(e.pointerId, p, type !== "pointerup");
        if (type !== "lostpointercapture") contacts.delete(e.pointerId);
        if (!gesture.points.size) clearHover();
      }
    }, { capture: true, passive: false });
  }
  // eframe also listens for legacy touch events; don't feed the same gesture to it twice.
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel", "contextmenu"]) {
    canvas.addEventListener(type, stop, { capture: true, passive: false });
  }
  window.addEventListener("blur", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  return { modifiers, controls };
}

export function installTouchBar(canvas, { modifiers, controls }) {
  const bar = document.createElement("nav");
  bar.id = "touch-bar";
  bar.setAttribute("aria-label", "Touch editing shortcuts");
  const style = document.createElement("style");
  style.textContent = `
    :root { --mobile-bg:#17191d; --mobile-panel:#22252b; --mobile-raised:#2c3038;
      --mobile-line:#3b414c; --mobile-text:#eef1f7; --mobile-muted:#b6bfce; --mobile-accent:#83b7ff; color-scheme:dark; }
    #touch-bar { position:fixed; bottom:0; left:0; right:0; height:52px; display:flex;
      gap:6px; padding:4px 8px; box-sizing:border-box; overflow-x:auto; background:#202126;
      border-top:1px solid #444; font:14px system-ui; z-index:5; touch-action:pan-x; overscroll-behavior:contain; }
    #touch-bar button { flex-shrink:0; min-width:48px; min-height:44px; padding:0 12px;
      border:1px solid #555; border-radius:8px; background:#30323a; color:#fff; font:inherit; }
    #touch-bar button[aria-pressed=true] { background:#245c9c; }
    #effectcraft_canvas { height:calc(100% - 52px) !important; bottom:52px; }
    #touch-error { position:fixed; inset:10%; z-index:20; background:#25262c; color:white;
      padding:24px; font:16px system-ui; overflow:auto; border:1px solid #888; }
    #touch-error button, #touch-error select { min-height:44px; margin:8px; padding:8px 16px; font:inherit; }
    #touch-bar, #phone-toolbar, #phone-nav { background:var(--mobile-bg) !important; border-color:var(--mobile-line) !important; }
    #touch-bar button, #phone-toolbar button, #phone-nav button, #touch-error button {
      appearance:none; box-sizing:border-box; border:1px solid transparent !important; border-radius:12px !important;
      background:var(--mobile-raised) !important; color:var(--mobile-text) !important; font:500 13px/1.3 system-ui,sans-serif;
      letter-spacing:.01em; cursor:pointer; transition:background-color 120ms,color 120ms; }
    #touch-bar button:hover, #phone-toolbar button:hover, #phone-nav button:hover, #touch-error button:hover { background:#373e49 !important; }
    #touch-bar button:active, #phone-toolbar button:active, #phone-nav button:active, #touch-error button:active { background:#42516a !important; }
    #touch-bar button[aria-pressed=true], #phone-nav button[aria-pressed=true], #touch-error button[aria-pressed=true] {
      color:#d9e8ff !important; background:#23466f !important; border-color:#568bc5 !important; }
    #touch-error button:disabled { opacity:.45; cursor:not-allowed; }
    #touch-bar button:focus-visible, #phone-toolbar button:focus-visible, #phone-nav button:focus-visible,
    #touch-error :focus-visible { outline:2px solid var(--mobile-accent); outline-offset:2px; }
    #touch-error { position:fixed; inset:0; margin:auto; width:min(560px,calc(100% - 32px)); max-height:calc(100dvh - 32px);
      box-sizing:border-box; border:1px solid var(--mobile-line); border-radius:20px; padding:20px;
      background:var(--mobile-panel); color:var(--mobile-text); box-shadow:0 20px 70px #0008; font:14px/1.5 system-ui,sans-serif; }
    #touch-error::backdrop { background:#090c12b8; }
    #touch-error header { display:flex; align-items:center; justify-content:space-between; gap:16px;
      position:sticky; top:-20px; background:var(--mobile-panel); z-index:1; padding:4px 0 12px; }
    #touch-error h2 { margin:0; font-size:18px; font-weight:650; letter-spacing:-.02em; }
    #touch-error header button { margin:0; background:transparent !important; color:var(--mobile-muted) !important; }
    #touch-error p { color:var(--mobile-muted); margin:8px 0 16px; }
    #touch-error button { min-height:48px; margin:4px; padding:10px 14px; }
    #touch-error input, #touch-error select { appearance:none; box-sizing:border-box; width:100%; min-height:48px;
      border:1px solid var(--mobile-line); border-radius:10px; padding:10px 12px; background:var(--mobile-bg); color:var(--mobile-text); font:16px system-ui; }
    #touch-error .phone-options { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    #touch-error .phone-options button { flex:1 0 110px; margin:0; }
    #phone-commands { display:flex; flex-direction:column; gap:2px; margin-top:12px; }
    #phone-commands button { text-align:left; margin:0; min-height:48px; background:transparent !important; border-radius:8px !important; }
    #phone-commands small { display:block; color:var(--mobile-muted); font-size:11px; margin-top:3px; }
    #phone-toolbar button:last-child { background:#254e7d !important; color:#e3efff !important; }
    #phone-nav button { background:transparent !important; border-radius:10px !important; }
    #phone-hint { color:var(--mobile-muted) !important; background:var(--mobile-bg) !important; letter-spacing:.02em; }
    #touch-bar [hidden] { display:none !important; }
    #touch-error label { display:block; flex-basis:100%; color:var(--mobile-muted); font-size:12px; font-weight:600; }
    @media(max-width:599px) { #touch-error { inset:auto 0 0; margin:0; width:100%; max-width:none; max-height:calc(100dvh - 20px);
      border-radius:22px 22px 0 0; padding:20px 16px max(20px,env(safe-area-inset-bottom)); }
      #touch-error header { top:-20px; } }
    @media(prefers-reduced-motion:reduce) { #touch-bar button, #phone-toolbar button, #phone-nav button, #touch-error button { transition:none; } }
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
  const updateModes = () => {
    bar.dataset.mode = controls.mode;
    mode.textContent = controls.mode[0].toUpperCase() + controls.mode.slice(1);
    mode.setAttribute("aria-label", `Touch mode: ${mode.textContent}. Tap to switch to Scroll or Drag`);
    box.setAttribute("aria-pressed", String(controls.mode === "box"));
    trim.setAttribute("aria-pressed", String(controls.mode === "trim"));
    done.hidden = !["box", "trim"].includes(controls.mode);
    window.dispatchEvent(new CustomEvent("effectcraft-touch-mode", { detail: controls.mode }));
  };
  const mode = button("Auto", "Touch mode: Auto. Tap to switch to Scroll or Drag", () => {
    const modes = ["auto", "scroll", "drag"];
    controls.mode = modes[(modes.indexOf(controls.mode) + 1) % modes.length];
    updateModes();
  });
  const box = button("Box select", "Toggle timeline box selection: drag from empty space", () => {
    controls.mode = controls.mode === "box" ? "auto" : "box";
    updateModes();
  });
  const trim = button("Trim", "Toggle clip trimming: drag the left or right edge", () => {
    controls.mode = controls.mode === "trim" ? "auto" : "trim";
    updateModes();
  });
  const done = button("Done", "Finish trimming or box selection", () => { controls.mode = "auto"; updateModes(); });
  updateModes();
  button("Undo", "Undo", () => invoke("edit.undo"));
  button("Redo", "Redo", () => invoke("edit.redo"));
  button("UI", "Adjust editor UI scale", () => showScalePicker());
  button("Time −", "Zoom timeline out", () => invoke("timeline.zoomOut"));
  button("Time +", "Zoom timeline in", () => invoke("timeline.zoomIn"));
  button("Fit time", "Fit the whole composition in the timeline", () => invoke("timeline.zoomFit"));
  button("Frame ‹", "Move playhead one frame backward", () => invoke("time.previousFrame"));
  button("Frame ›", "Move playhead one frame forward", () => invoke("time.nextFrame"));
  button("Esc", "Dismiss menu / cancel editing", () => window.effectcraft.request("ui.key", { key: "Escape" }));
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
  const expand = (panel) => window.effectcraft.touchLayout?.()?.phonePanel
    ? window.effectcraft.request("ui.set", { phonePanel: panel }) : invoke("window.maximizePanel", { panel });
  button("Viewer", "Maximize / restore Composition panel", () => expand("Composition"));
  button("Timeline", "Maximize / restore Timeline panel", () => expand("Timeline"));
  button("Delete", "Delete selected items or layers", () => invoke("edit.clear"));
  button("Help", "Touch controls and Android limitations", () => showTouchSheet(
    "Auto: swipe in either direction to scroll the timeline and media/effects lists without moving layers or keys. " +
    "Pinch to zoom in first if the whole timeline already fits. Swipe over the time bars to move through time. " +
    "Drag the time ruler / playhead to scrub; drag the bottom time-zoom slider or top navigator handles to change the time scale. " +
    "Time − / Time + / Fit time change timeline zoom; Frame ‹ / Frame › place the playhead one frame at a time. " +
     "Hold a layer bar, key or layer name until the vibration, then drag to move/trim, retime or reorder it. " +
    "For a selection rectangle, tap Box select, then drag from empty timeline space: the left outline selects layers, the time area selects keys. Shift adds to selection. " +
    "Tap Trim, then drag near a clip's left/right edge to shorten or extend it without a hold. Tap the active Box select or Trim button again to return to Auto. " +
    "In Auto, hold empty timeline space to draw a selection box; hold near a clip edge to trim. Keep the same finger down while moving. " +
    "Release a hold without moving for options. Swipe left/right directly on a number to adjust it; swipe vertically to scroll. " +
    "Drag in the viewer to edit. Drag mode also allows immediate edits without holding; switch back to Auto to navigate. " +
    "Use Scroll to force one-finger scrolling elsewhere. " +
    "Tap to select. Hold still for 0.5 seconds, then release for a right-click menu. " +
    "Pinch with two fingers to zoom the timeline or composition; move two fingers together to scroll panels and the timeline. " +
    "Use Hand to pan the composition. Shift enables multi-select; tap it again when finished. " +
    "Viewer / Timeline expands that panel. UI adjusts editor scale; 100% is the default, 75–90% fits more on small screens. " +
    "Layout chooses Auto, Phone or Tablet. Phone Timeline, Properties and Effect controls keep a live preview; drag its divider to resize. " +
    "More opens other panels or hides the live preview; Menu searches actions. " +
    "Save exports an .ecproj; session recovery alone is not a backup. " +
    "Android alpha: small projects first; software rendering and video export can be slow."
  ));
  document.body.append(bar);
}

async function showScalePicker() {
  const current = await window.effectcraft.execute("prefs.get", { key: "appearance.uiScale" });
  showTouchSheet("Smaller values fit more controls on screen.", "Editor scale");
  const box = document.getElementById("touch-error");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Editor UI scale");
  for (const value of [...new Set([75, 85, 90, 100, 110, 125, 150, 175, 200, current])].sort((a, b) => a - b)) {
    const option = document.createElement("option");
    option.value = String(value); option.textContent = `${value}%`; option.selected = value === current;
    select.append(option);
  }
  const apply = document.createElement("button"); apply.textContent = "Apply";
  apply.onclick = async () => {
    apply.disabled = true;
    try {
      await window.effectcraft.execute("prefs.set", { values: { "appearance.uiScale": Number(select.value) } });
      await window.effectcraft.flush();
      box.remove();
    } catch (e) { showTouchError(String(e)); }
    finally { apply.disabled = false; }
  };
  box.append(select, apply);
}

// Android Back dismisses the current menu, text edit or touch dialog before offering exit.
// Return synchronously so the native shell can decide whether to show its close prompt.
export function dismissTouchOverlay() {
  const box = document.getElementById("touch-error");
  if (box) { box.remove(); return true; }
  const layout = window.effectcraft?.touchLayout?.();
  if (layout?.overlay || layout?.keyboardFocus) {
    window.effectcraft.request("ui.key", { key: "Escape" }).catch((e) => showTouchError(String(e)));
    return true;
  }
  return false;
}

// Migrate the original forced 125% default once, without resetting caches or custom scales.
export async function applyAndroidDefaults(api, storage) {
  if (!storage.getItem("ecdroid.defaults.v1")) {
    await api.execute("prefs.set", { values: {
      "appearance.uiScale": 100, "memory.layerCacheMb": 128,
      "memory.mediaCacheMb": 128, "memory.previewCacheMb": 128,
    } });
    await api.flush();
    storage.setItem("ecdroid.defaults.v1", "1");
    storage.setItem("ecdroid.scale.v2", "1");
  } else if (!storage.getItem("ecdroid.scale.v2")) {
    if (await api.execute("prefs.get", { key: "appearance.uiScale" }) === 125) {
      await api.execute("prefs.set", { values: { "appearance.uiScale": 100 } });
      await api.flush();
    }
    storage.setItem("ecdroid.scale.v2", "1");
  }
}

export function showTouchError(message, retry) {
  const box = showTouchSheet(message, "Something needs attention", true);
  if (retry) {
    const button = document.createElement("button"); button.textContent = "Retry export";
    button.onclick = () => { box.remove(); retry(); }; box.append(button);
  }
  return box;
}

// Native dialog provides focus containment, inert background and Escape dismissal. The
// content is ours, not a platform alert; system file/save pickers deliberately stay native.
export function showTouchSheet(message, title = "Editor", error = false) {
  const old = document.getElementById("touch-error");
  if (old) old.remove();
  const box = document.createElement("dialog");
  box.id = "touch-error"; box.setAttribute("role", error ? "alertdialog" : "dialog");
  box.setAttribute("aria-labelledby", "touch-sheet-title");
  const header = document.createElement("header");
  const heading = document.createElement("h2"); heading.id = "touch-sheet-title"; heading.textContent = title;
  const close = document.createElement("button"); close.textContent = "Close"; close.setAttribute("aria-label", "Close sheet");
  close.onclick = () => box.remove(); header.append(heading,close); box.append(header);
  const text = document.createElement("p"); text.textContent = message; box.append(text);
  box.addEventListener("cancel", event => { event.preventDefault(); box.remove(); });
  document.body.append(box);
  box.showModal();
  return box;
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

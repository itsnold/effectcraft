// Original phone presentation. The Rust dock is never replaced or saved by this controller.
import { showTouchError, showTouchSheet } from "./touch.js";

export const PHONE_PANELS = [
  ["Composition", "Preview"], ["Timeline", "Timeline"], ["Project", "Media"],
  ["EffectsPresets", "Effects"], ["EffectControls", "Effect controls"],
  ["Properties", "Properties"], ["Character", "Text"], ["Paragraph", "Paragraph"],
  ["RenderQueue", "Export queue"], ["History", "History"], ["MediaBrowser", "Media browser"],
];

// Preserve the engine's menu order, nested paths, bound parameters and duplicate command ids.
export function menuLevel(items, path = [], query = "") {
  const text = query.trim().toLocaleLowerCase();
  if (text) return { groups: [], actions: items.filter(item => item.id &&
    [...(item.path || []), item.label].join(" ").toLocaleLowerCase().includes(text)) };
  const matches = items.filter(item => item.id && path.every((part, i) => item.path?.[i] === part));
  return { groups: [...new Set(matches.map(item => item.path?.[path.length]).filter(Boolean))],
    actions: matches.filter(item => (item.path || []).length === path.length) };
}

export function timingParams(layers, field, frames, frameRate) {
  if (!layers.length || !["in", "out", "delta"].includes(field) || !Number.isSafeInteger(frames) ||
      !Number.isFinite(frameRate) || frameRate <= 0) throw new Error("Enter a whole frame number and select a layer.");
  const seconds = frames / frameRate;
  if (!Number.isFinite(seconds)) throw new Error("Frame number is out of range.");
  return { layers, [field]: seconds };
}

export function wantsPhoneLayout(width, screenWidth, screenHeight) {
  // Screen dimensions don't shrink when an IME opens. Still adapt to a narrow split window.
  return Number.isFinite(width) && width > 0 && (width < 600 ||
    (Number.isFinite(screenWidth) && Number.isFinite(screenHeight) && Math.min(screenWidth, screenHeight) > 0 && Math.min(screenWidth, screenHeight) < 600));
}

export class PhoneWorkspace {
  constructor(api, render = () => {}) {
    this.api = api;
    this.render = render;
    this.mode = "auto";
    this.panel = "Composition";
    this.compact = false;
    this.enabled = false;
    this.applied = null;
    this.ready = false;
    this.pending = 0;
    this.queue = Promise.resolve();
  }
  sync() {
    // Serialize rotation/panel/mode changes. Read the latest desired state when each turn starts.
    this.pending++;
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (!this.ready) return;
      const enabled = this.mode === "phone" || (this.mode === "auto" && this.compact);
      const panel = enabled ? this.panel : null;
      if (this.applied !== panel) {
        await this.api.request("ui.set", { phonePanel: panel });
        this.applied = panel;
      }
      this.enabled = enabled;
      this.render(this);
    }).finally(() => { this.pending--; });
    return this.queue;
  }
  setMode(mode) {
    if (!["auto", "phone", "desktop"].includes(mode)) return Promise.reject(new Error("Unknown layout mode"));
    this.mode = mode;
    return this.sync();
  }
  setPanel(panel) {
    if (!PHONE_PANELS.some(([id]) => id === panel)) return Promise.reject(new Error("Unknown phone panel"));
    this.panel = panel;
    return this.sync();
  }
}

export function installPhoneWorkspace(api) {
  const style = document.createElement("style");
  style.textContent = `
    #phone-toolbar, #phone-nav, #phone-hint { display:none; }
    html[data-phone-layout=true] #phone-toolbar { position:fixed; inset:0 0 auto; height:48px;
      display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:4px; padding:2px 4px; box-sizing:border-box;
      background:#202126; z-index:5; }
    html[data-phone-layout=true] #phone-hint { display:block; position:fixed; top:48px; left:0; right:0;
      height:20px; margin:0; color:#cbd3df; background:#202126; text-align:center; font:11px/20px system-ui; z-index:5; }
    html[data-phone-layout=true] #phone-nav { position:fixed; bottom:52px; left:0; right:0; height:48px;
      display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:3px; padding:2px 4px; box-sizing:border-box;
      background:#202126; border-top:1px solid #444; z-index:5; }
    #phone-toolbar button, #phone-nav button { min-width:0; min-height:44px; padding:0 4px;
      border:1px solid #555; border-radius:7px; color:#fff; background:#30323a; font:12px system-ui; }
    #phone-nav button[aria-pressed=true] { background:#245c9c; border-color:#599ce3; }
    html[data-phone-layout=true] #effectcraft_canvas { top:68px; bottom:100px; height:calc(100% - 168px) !important; }
    #phone-toolbar button, #phone-nav button { font-weight:550; }
  `;
  document.head.append(style);
  const toolbar = document.createElement("nav"); toolbar.id = "phone-toolbar"; toolbar.setAttribute("aria-label", "Phone editing actions");
  const nav = document.createElement("nav"); nav.id = "phone-nav"; nav.setAttribute("aria-label", "Phone workspace panels");
  const hint = document.createElement("p"); hint.id = "phone-hint";
  const button = (parent, label, action, title = label) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.setAttribute("aria-label", title);
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.onclick = () => Promise.resolve().then(action).catch((e) => showTouchError(String(e)));
    parent.append(b); return b;
  };
  const panels = new Map();
  const controller = new PhoneWorkspace(api, (state) => {
    document.documentElement.dataset.phoneLayout = String(state.enabled);
    const actual = api.touchLayout?.()?.phonePanel || state.panel;
    for (const [id, b] of panels) b.setAttribute("aria-pressed", String(id === actual || (id === "EffectsPresets" && actual === "EffectControls")));
    hint.textContent = `${PHONE_PANELS.find(([id]) => id === actual)?.[1] || actual} workspace`;
  });
  const invoke = (id, params = {}) => api.request("ui.menu.invoke", { id, params });
  button(toolbar, "Menu", () => commands());
  const selectionButton = button(toolbar, "Import", () => selectionButton.dataset.edit === "true" ? selectionActions() : invoke("file.import"));
  button(toolbar, "Play", () => api.request("ui.playback", {}), "Play / stop preview");
  button(toolbar, "Undo", () => invoke("edit.undo"));
  button(toolbar, "Save", () => invoke("file.save"));
  for (const [id, label] of PHONE_PANELS.slice(0, 4)) panels.set(id, button(nav, label, () => controller.setPanel(id)));
  button(nav, "More", () => more());
  document.body.append(toolbar, hint, nav);

  const choose = (parent, label, action) => button(parent, label, async () => {
    await action(); document.getElementById("touch-error")?.remove();
  });
  function layouts(parent) {
    for (const [id, label] of [["auto", "Auto layout"], ["phone", "Phone layout"], ["desktop", "Tablet layout"]]) {
      const b = choose(parent, label, async () => {
        await controller.setMode(id);
        try { localStorage.setItem("effectcraft.layout.v1", id); } catch { /* optional preference */ }
      });
      b.setAttribute("aria-pressed", String(controller.mode === id));
    }
  }
  function more() {
    showTouchSheet("Your tablet workspace is preserved when switching layouts.", "Workspace");
    const box = document.getElementById("touch-error");
    const options = document.createElement("div"); options.className = "phone-options"; box.append(options);
    for (const [id, label] of PHONE_PANELS) choose(options, label, () => controller.setPanel(id));
    const preview = api.touchLayout?.()?.phonePreview !== false;
    choose(options, preview ? "Hide live preview" : "Show live preview", () => api.request("ui.set", { phonePreview: !preview }));
    layouts(options);
  }
  async function commands() {
    showTouchSheet("Browse a category or search all commands.", "Editor menus");
    const box = document.getElementById("touch-error");
    box.setAttribute("aria-label", "Editor menus");
    const quick = document.createElement("div"); quick.className = "phone-options";
    button(quick, "+ Add", () => addItems());
    button(quick, "Edit selection", () => selectionActions());
    box.append(quick);
    const input = document.createElement("input"); input.type = "search";
    input.placeholder = "Find an action…"; input.setAttribute("aria-label", "Search editor actions");
    const list = document.createElement("div"); list.id = "phone-commands";
    box.append(input, list);
    const items = await api.request("ui.menu.list", {});
    if (!box.isConnected) return;
    let path = [];
    const fill = () => {
      list.replaceChildren();
      const query = input.value.trim();
      if (path.length && !query) button(list, "‹ Back", () => { path.pop(); fill(); });
      const heading = document.createElement("p"); heading.textContent = query ? "Search results" : path.join(" › ") || "All menus"; list.append(heading);
      const { groups, actions } = menuLevel(items, path, query);
      for (const group of groups) button(list, `${group} ›`, () => { path.push(group); fill(); }, `Open ${group} menu`);
      for (const item of actions) {
        const b = button(list, `${item.checked === true ? "✓ " : ""}${item.label}`, async () => {
          box.remove(); await invoke(item.id, item.params || {});
        });
        b.disabled = !item.enabled;
        b.dataset.command = item.id;
        if (typeof item.checked === "boolean") b.setAttribute("aria-pressed", String(item.checked));
        const detail = document.createElement("small"); detail.textContent = [...(query ? item.path || [] : []), item.shortcut].filter(Boolean).join(" › "); b.append(detail);
      }
      if (!groups.length && !actions.length) list.append("No matching actions");
    };
    input.oninput = fill; fill();
  }
  function addItems() {
    showTouchSheet("Create a layer or bring in your own media.", "Add to composition");
    const box = document.getElementById("touch-error");
    const options = document.createElement("div"); options.className = "phone-options"; box.append(options);
    for (const [label, id, params] of [["Text", "layer.newText"], ["Shape", "layer.newShape", {kind:"rectangle"}],
      ["Solid", "layer.newSolid"], ["Import media", "file.import"]]) {
      button(options, label, async () => { box.remove(); await invoke(id, params || {}); });
    }
  }
  async function selectionActions() {
    const snapshot = await api.inspect();
    const layers = snapshot.selectedLayers;
    showTouchSheet(snapshot.selectedKeys ? `${snapshot.selectedKeys} selected keyframes` : `${layers.length} selected layers`, "Selection actions");
    const box = document.getElementById("touch-error"); box.setAttribute("aria-label", "Selection actions");
    const options = document.createElement("div"); options.className = "phone-options"; box.append(options);
    const run = async (id, params = {}) => {
      const current = await api.inspect();
      if (current.activeComp !== snapshot.activeComp || JSON.stringify(current.selectedLayers) !== JSON.stringify(layers) || current.selectedKeys !== snapshot.selectedKeys)
        throw new Error("Selection changed. Reopen Edit selection before editing.");
      await api.request("ui.set", { focused: "Timeline" });
      box.remove(); await api.execute(id, params);
    };
    if (snapshot.selectedKeys) {
      for (const [label, id, params] of [["Easy Ease", "keys.easyEase"], ["Ease In", "keys.easyEaseIn"],
        ["Ease Out", "keys.easyEaseOut"], ["Linear", "keys.interpolation", {interpolation:"linear"}],
        ["Toggle Hold", "keys.toggleHold"], ["Delete keys", "keys.delete"]]) button(options, label, () => run(id, params || {}));
    } else {
      for (const [label, id] of [["Split at playhead", "edit.splitLayer"], ["Duplicate", "edit.duplicate"], ["Delete layers", "edit.clear"]]) {
        button(options, label, () => run(id, {layers})).disabled = !layers.length;
      }
      button(options, "Precision timing", () => precisionTiming(snapshot)).disabled = !layers.length;
    }
    button(options, "+ Add", () => addItems());
  }
  async function precisionTiming(snapshot) {
    const comp = await api.execute("comp.info", {comp:snapshot.activeComp});
    if (!comp.layers.some(layer => snapshot.selectedLayers.includes(layer.id))) throw new Error("Select a layer first.");
    showTouchSheet("Frame numbers from composition start. Each adjustment is one undo step.", "Precision timing");
    const box = document.getElementById("touch-error"); box.setAttribute("aria-label", "Precision timing");
    const status = document.createElement("p"); status.setAttribute("role", "status"); box.append(status);
    const fields = new Map();
    const refresh = async () => {
      const info = await api.execute("comp.info", {comp:snapshot.activeComp});
      const layer = info.layers.find(layer => layer.id === snapshot.selectedLayers[0]);
      if (!layer) throw new Error("The layer was removed.");
      status.textContent = `${snapshot.selectedLayers.length} layers · ${info.frameRate} fps · In ${Math.round(layer.in*info.frameRate)} · Out ${Math.round(layer.out*info.frameRate)}`;
      for (const [field, input] of fields) input.value = String(Math.round(layer[field]*info.frameRate));
    };
    let busy = false;
    const apply = async params => {
      if (busy) return;
      busy = true;
      try {
        if ((await api.inspect()).activeComp !== snapshot.activeComp) throw new Error("Composition changed. Reopen Precision timing.");
        await api.execute("layer.timing", {comp:snapshot.activeComp,...params});
        await refresh();
      } finally { busy = false; }
    };
    for (const [field, label] of [["in","In"],["out","Out"]]) {
      const row = document.createElement("div"); row.className = "phone-options";
      const input = document.createElement("input"); input.type = "number"; input.step = "1";
      input.setAttribute("aria-label", `${label} frame`); fields.set(field,input); box.append(row);
      const caption = document.createElement("label"); caption.textContent = `${label} frame`; input.id = `timing-${field}`; caption.htmlFor = input.id;
      row.append(caption);
      button(row, `${label} −1f`, () => apply({layers:snapshot.selectedLayers,[`${field}Delta`]:-1/comp.frameRate}));
      button(row, `${label} +1f`, () => apply({layers:snapshot.selectedLayers,[`${field}Delta`]:1/comp.frameRate}));
      row.append(input);
      button(row, `Apply ${label}`, () => {
        if (!input.value.trim()) throw new Error("Enter a whole frame number.");
        return apply(timingParams(snapshot.selectedLayers,field,Number(input.value),comp.frameRate));
      });
    }
    const moves = document.createElement("div"); moves.className = "phone-options"; box.append(moves);
    for (const frames of [-1,1]) button(moves, `Move ${frames>0?"+":""}${frames}f`, () => apply(timingParams(snapshot.selectedLayers,"delta",frames,comp.frameRate)));
    await refresh();
  }
  const layoutButton = button(document.getElementById("touch-bar"), "Layout", () => {
    showTouchSheet("Choose the workspace for this screen.", "Layout");
    const options = document.createElement("div"); options.className = "phone-options";
    document.getElementById("touch-error").append(options); layouts(options);
  });
  layoutButton.setAttribute("aria-label", "Choose Auto, Phone or Tablet layout");
  layoutButton.dataset.advanced = "true";
  const refresh = () => {
    controller.compact = wantsPhoneLayout(innerWidth, screen.width, screen.height);
    controller.sync().catch((e) => showTouchError(String(e)));
  };
  window.addEventListener("resize", refresh);
  const modeHint = () => {
    const mode = document.getElementById("touch-bar")?.dataset.mode;
    if (controller.enabled && controller.panel === "Timeline" && ["box", "trim"].includes(mode))
      hint.textContent = mode === "box" ? "BOX SELECT · Start on empty space · Done to finish" : "TRIMMING · Drag either clip edge · Done to finish";
  };
  window.addEventListener("effectcraft-touch-mode", modeHint);
  // Keep tab feedback in sync when applying an effect brings Effect Controls forward.
  setInterval(() => {
    if (!controller.enabled || controller.pending || document.hidden) return;
    const panel = api.touchLayout?.()?.phonePanel;
      if (PHONE_PANELS.some(([id]) => id === panel)) {
        controller.panel = panel; controller.applied = panel; controller.render(controller);
      }
      modeHint();
      // Read a cheap synchronous snapshot; do not queue control requests every half-second.
      const selected = api.touchLayout?.()?.selection;
      const editing = panel === "Timeline" && (selected?.layers > 0 || selected?.keys > 0);
      selectionButton.dataset.edit = String(editing);
      selectionButton.textContent = editing ? "Actions" : "Import";
      selectionButton.setAttribute("aria-label", editing ? "Edit selection" : "Import");
  }, 500);
  return {
    controller,
    async start() {
      try { const mode = localStorage.getItem("effectcraft.layout.v1"); if (["auto", "phone", "desktop"].includes(mode)) controller.mode = mode; } catch { /* optional preference */ }
      controller.ready = true;
      controller.compact = wantsPhoneLayout(innerWidth, screen.width, screen.height);
      await controller.sync();
    },
  };
}

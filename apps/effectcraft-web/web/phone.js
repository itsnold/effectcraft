// Original phone presentation. The Rust dock is never replaced or saved by this controller.
import { showTouchError } from "./touch.js";

export const PHONE_PANELS = [
  ["Composition", "Preview"], ["Timeline", "Timeline"], ["Project", "Media"],
  ["EffectsPresets", "Effects"], ["EffectControls", "Effect controls"],
  ["Properties", "Properties"], ["Character", "Text"], ["Paragraph", "Paragraph"],
  ["RenderQueue", "Export queue"], ["History", "History"], ["MediaBrowser", "Media browser"],
];

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
    html[data-phone-layout=true] #touch-error { inset:8px; padding:14px; border-radius:12px; }
    #touch-error .phone-options { display:flex; flex-wrap:wrap; gap:4px; }
    #touch-error .phone-options button { flex:1 0 110px; margin:2px; }
    #touch-error input { box-sizing:border-box; width:100%; min-height:44px; padding:8px; font:16px system-ui;
      color:white; background:#18191d; border:1px solid #666; border-radius:6px; }
    #phone-commands { display:flex; flex-direction:column; gap:4px; }
    #phone-commands button { text-align:left; margin:0; min-height:44px; }
    #phone-commands small { display:block; color:#bcc5d0; }
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
    hint.textContent = actual === "Timeline" ? "Swipe: scroll · Hold + drag: edit · Numbers: slide" : `${PHONE_PANELS.find(([id]) => id === actual)?.[1] || actual} · Hold, then release for options`;
  });
  const invoke = (id, params = {}) => api.request("ui.menu.invoke", { id, params });
  button(toolbar, "Menu", () => commands());
  button(toolbar, "Import", () => invoke("file.import"));
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
    showTouchError("Panels and layout. Your tablet workspace is preserved.");
    const box = document.getElementById("touch-error");
    const options = document.createElement("div"); options.className = "phone-options"; box.append(options);
    for (const [id, label] of PHONE_PANELS) choose(options, label, () => controller.setPanel(id));
    const preview = api.touchLayout?.()?.phonePreview !== false;
    choose(options, preview ? "Hide live preview" : "Show live preview", () => api.request("ui.set", { phonePreview: !preview }));
    layouts(options);
  }
  async function commands() {
    showTouchError("Actions — search for New Composition, Text, Settings, Render…");
    const box = document.getElementById("touch-error");
    const input = document.createElement("input"); input.type = "search";
    input.placeholder = "Find an action…"; input.setAttribute("aria-label", "Search editor actions");
    const list = document.createElement("div"); list.id = "phone-commands";
    box.append(input, list);
    const items = await api.request("ui.menu.list", {});
    if (!box.isConnected) return;
    const fill = () => {
      list.replaceChildren();
      const query = input.value.trim().toLocaleLowerCase();
      const common = new Set(["app.newComp", "comp.new", "layer.newText", "layer.newSolid", "app.settings", "file.open", "file.save", "file.import"]);
      const matches = items.filter((item) => item.id && (query ? [...(item.path || []), item.label].join(" ").toLocaleLowerCase().includes(query) : common.has(item.id))).slice(0, 60);
      for (const item of matches) {
        const b = button(list, item.label, async () => {
          box.remove(); await invoke(item.id, item.params || {});
        });
        b.disabled = !item.enabled;
        const path = document.createElement("small"); path.textContent = (item.path || []).join(" › "); b.append(path);
      }
      if (!matches.length) list.textContent = "No matching actions";
    };
    input.oninput = fill; fill();
  }
  const layoutButton = button(document.getElementById("touch-bar"), "Layout", () => {
    showTouchError("Choose the workspace for this screen.");
    const options = document.createElement("div"); options.className = "phone-options";
    document.getElementById("touch-error").append(options); layouts(options);
  });
  layoutButton.setAttribute("aria-label", "Choose Auto, Phone or Tablet layout");
  const refresh = () => {
    controller.compact = wantsPhoneLayout(innerWidth, screen.width, screen.height);
    controller.sync().catch((e) => showTouchError(String(e)));
  };
  window.addEventListener("resize", refresh);
  // Keep tab feedback in sync when applying an effect brings Effect Controls forward.
  setInterval(() => {
    if (!controller.enabled || controller.pending || document.hidden) return;
    const panel = api.touchLayout?.()?.phonePanel;
    if (PHONE_PANELS.some(([id]) => id === panel)) {
      controller.panel = panel; controller.applied = panel; controller.render(controller);
    }
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

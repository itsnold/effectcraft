//! The phone workspace is a presentation, not a destructive rewrite of the saved dock.
use effectcraft_engine::Session;
use effectcraft_ui_egui::control::{self, ControlRequest, Outcome};
use effectcraft_ui_egui::dock::PanelKind;
use effectcraft_ui_egui::{EffectcraftApp, state::UiState};
use egui::{pos2, vec2};
use egui_kittest::Harness;
use serde_json::{Value, json};

fn set(app: &mut EffectcraftApp, value: Value) -> Value {
    let (request, _rx) = ControlRequest::new("ui.set", value);
    match control::handle(app, &egui::Context::default(), &request) {
        Outcome::Done(result) => result,
        _ => panic!("ui.set must finish immediately"),
    }
}

#[test]
fn phone_panels_do_not_replace_dock_or_column_preferences() {
    let mut session = Session::default();
    session.execute("file.openDemoProject", json!({})).unwrap();
    let mut h = Harness::builder().with_size(vec2(390.0, 676.0)).build_eframe(|_| EffectcraftApp::new(session));
    h.run_steps(3);
    let original = serde_json::to_value(&h.state().ui).unwrap();
    for panel in ["Timeline", "Project", "EffectsPresets", "EffectControls", "Composition"] {
        let result = set(h.state_mut(), json!({"phonePanel": panel}));
        assert_eq!(result["ok"], true, "{result}");
        h.run_steps(3);
        assert!(h.state().auto.find(&format!("panel.{panel}")).is_some(), "{panel} is visible");
        assert!(h.state().auto.find("menu.File").is_none(), "desktop menu bar does not consume phone space");
        if panel == "Timeline" {
            let preview = h.state().auto.find("phone.preview").unwrap().rect;
            let timeline = h.state().auto.find("panel.Timeline").unwrap().rect;
            assert!(preview[1] + preview[3] < timeline[1], "portrait preview stays above the timeline");
            assert!(preview[3] >= 140.0 && timeline[3] >= 240.0, "both panels stay usable");
            let ruler = h.state().auto.find("timeline.ruler").unwrap().rect;
            assert!(ruler[2] > 180.0, "time area stays usable at phone width: {ruler:?}");
            assert!(ruler[0] < 200.0, "outline cannot consume the whole screen");
            let zoom_in = h.state().auto.find("timeline.zoomInButton").unwrap().rect;
            let zoom_out = h.state().auto.find("timeline.zoomOutButton").unwrap().rect;
            let slider = h.state().auto.find("timeline.zoomSlider.control").unwrap().rect;
            assert_eq!(zoom_in[2], 44.0);
            assert_eq!(zoom_in[3], 44.0);
            assert_eq!(slider[3], 44.0);
            assert!(zoom_out[0] + zoom_out[2] <= slider[0] && slider[0] + slider[2] <= zoom_in[0], "phone zoom targets do not overlap");
            let scrub = h.state().auto.find("timeline.scrub").unwrap().rect;
            assert_eq!(scrub[1], ruler[1], "the ruler's upper portion scrubs too");
        }
    }
    // Internal commands bring the relevant panel forward too, without opening a desktop dock.
    h.state_mut().show_panel(PanelKind::Properties);
    assert_eq!(h.state().ui.phone_panel, Some(PanelKind::Properties));
    h.state_mut().raise_panel(PanelKind::EffectControls);
    assert_eq!(h.state().ui.phone_panel, Some(PanelKind::EffectControls));
    let phone = serde_json::to_value(&h.state().ui).unwrap();
    let restored: UiState = serde_json::from_value(phone).unwrap();
    assert_eq!(restored.phone_panel, None, "phone state must not leak into desktop session restore");
    set(h.state_mut(), json!({"phonePanel": null}));
    h.run_steps(3);
    let after = serde_json::to_value(&h.state().ui).unwrap();
    for field in ["dock", "floating", "saved_workspaces", "saved_floating", "maximized", "show_menu_bar"] {
        assert_eq!(after[field], original[field], "preserve {field}");
    }
    assert_eq!(after["timeline"]["columns"], original["timeline"]["columns"]);
    assert_eq!(after["timeline"]["show_modes"], original["timeline"]["show_modes"]);
    assert!(h.state().auto.find("menu.File").is_some(), "tablet chrome returns");
    // Hit a known panel body, not an arbitrary screen point which could be over a gutter
    // (panel_at intentionally returns the focused panel when no dock rectangle is hit).
    let timeline = h.state().auto.find("panel.Timeline").unwrap().rect;
    let center = pos2(timeline[0] + timeline[2] * 0.5, timeline[1] + timeline[3] * 0.5);
    assert_eq!(h.state().panel_at(Some(center)), PanelKind::Timeline);
}

#[test]
fn phone_preview_switch_and_landscape_do_not_change_the_dock() {
    for size in [vec2(390.0, 676.0), vec2(844.0, 222.0), vec2(390.0, 300.0)] {
        let mut s = Session::default();
        s.execute("comp.new", json!({"width": 64, "height": 36, "duration": 2})).unwrap();
        let mut h = Harness::builder().with_size(size).build_eframe(|_| EffectcraftApp::new(s));
        let original = serde_json::to_value(&h.state().ui.dock).unwrap();
        for panel in ["Timeline", "Properties", "EffectControls"] {
            set(h.state_mut(), json!({"phonePanel": panel, "phonePreview": true}));
            h.run_steps(3);
            if size.y >= 390.0 || size.x > 600.0 {
                let preview = h.state().auto.find("phone.preview").unwrap().rect;
                let editor = h.state().auto.find(&format!("panel.{panel}")).unwrap().rect;
                if size.x > 600.0 {
                    assert!(preview[0] + preview[2] < editor[0], "landscape preview is beside the editor");
                }
            } else {
                assert!(h.state().auto.find("phone.preview").is_none(), "short keyboard windows keep the editor usable");
            }
        }
        set(h.state_mut(), json!({"phonePreview": false}));
        h.run_steps(3);
        assert!(h.state().auto.find("phone.preview").is_none());
        assert_eq!(set(h.state_mut(), json!({"phonePreview": "invalid"}))["ok"], false);
        assert!(h.state().ui.phone_preview_hidden, "bad input does not change the preview");
        assert_eq!(serde_json::to_value(&h.state().ui.dock).unwrap(), original);
    }
}

#[test]
fn phone_position_numbers_stay_visible_and_register_for_touch_scrubbing() {
    let mut s = Session::default();
    s.execute("comp.new", json!({"width": 320, "height": 180, "duration": 2})).unwrap();
    let layer = s.execute("layer.newNull", json!({})).unwrap()["layer"].as_u64().unwrap();
    let uid = s.execute("prop.get", json!({"layer": layer, "path": "transform/position"})).unwrap()["uid"].as_u64().unwrap();
    let mut app = EffectcraftApp::new(s);
    app.ui.phone_panel = Some(PanelKind::Timeline);
    app.ui.timeline.apply_reveal(&[layer], vec!["position".into()]);
    let mut h = Harness::builder().with_size(vec2(390.0, 676.0)).build_eframe(|_| app);
    h.run_steps(4);
    let ruler = h.state().auto.find("timeline.ruler").unwrap().rect;
    let targets = effectcraft_ui_egui::touch_targets::current(&h.ctx);
    for dim in 0..2 {
        let rect = h.state().auto.find(&format!("timeline.prop.{uid}.value.{dim}")).unwrap().rect;
        assert!(rect[0] + rect[2] < ruler[0], "position values cannot be clipped by the time graph");
        assert!(targets.scrubs.iter().any(|r| r == &rect), "numeric widget advertises its real visible target");
    }
    assert!(!targets.hold_drags.is_empty(), "layer names and bars support hold-to-drag");
    set(h.state_mut(), json!({"phonePanel": "Project"}));
    h.run_steps(3);
    assert!(effectcraft_ui_egui::touch_targets::current(&h.ctx).scrubs.is_empty(), "targets from hidden panels cannot leak into another frame");
}

#[test]
fn malformed_phone_panel_is_a_useful_error_not_a_layout_change() {
    let mut app = EffectcraftApp::new(Session::default());
    for value in [json!(42), json!({}), json!("not a panel")] {
        let result = set(&mut app, json!({"phonePanel": value}));
        assert_eq!(result["ok"], false, "{result}");
        assert!(result["error"].as_str().unwrap().contains("phonePanel"));
        assert_eq!(app.ui.phone_panel, None);
    }
}

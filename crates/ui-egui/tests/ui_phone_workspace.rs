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
fn malformed_phone_panel_is_a_useful_error_not_a_layout_change() {
    let mut app = EffectcraftApp::new(Session::default());
    for value in [json!(42), json!({}), json!("not a panel")] {
        let result = set(&mut app, json!({"phonePanel": value}));
        assert_eq!(result["ok"], false, "{result}");
        assert!(result["error"].as_str().unwrap().contains("phonePanel"));
        assert_eq!(app.ui.phone_panel, None);
    }
}

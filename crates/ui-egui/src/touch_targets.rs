//! Explicit, clipped touch targets from the current UI pass; never guess from widget labels.

use egui::{Context, Id, Rect, Ui};

#[derive(Clone, serde::Serialize)]
pub struct TrimTarget {
    pub rect: [f32; 4],
    pub clip: [f32; 4],
}

#[derive(Clone, Default)]
pub struct Targets {
    pub scrubs: Vec<[f32; 4]>,
    pub hold_drags: Vec<[f32; 4]>,
    pub trims: Vec<TrimTarget>,
}

fn id() -> Id {
    Id::unique("touch-edit-targets")
}

pub(crate) fn begin_frame(ctx: &Context) {
    ctx.data_mut(|d| d.insert_temp(id(), Targets::default()));
}

fn record(ui: &Ui, rect: Rect, scrub: bool) {
    let rect = rect.intersect(ui.clip_rect());
    if !ui.is_enabled() || !rect.is_finite() || !rect.is_positive() {
        return;
    }
    let value = [rect.min.x, rect.min.y, rect.width(), rect.height()];
    ui.ctx().data_mut(|d| {
        let targets = d.get_temp_mut_or_default::<Targets>(id());
        let rects = if scrub { &mut targets.scrubs } else { &mut targets.hold_drags };
        rects.push(value);
    });
}

pub(crate) fn scrub(ui: &Ui, rect: Rect) {
    record(ui, rect, true);
}

pub(crate) fn hold_drag(ui: &Ui, rect: Rect) {
    record(ui, rect, false);
}

/// Keep the real edge and its panel bounds: the browser can enlarge its finger target without
/// moving a layer body instead, or making an offscreen edge draggable at the viewport boundary.
pub(crate) fn trim(ui: &Ui, rect: Rect) {
    let clip = ui.clip_rect();
    let rect = rect.intersect(clip);
    if !ui.is_enabled() || !clip.is_finite() || !rect.is_finite() || !rect.is_positive() {
        return;
    }
    let array = |r: Rect| [r.min.x, r.min.y, r.width(), r.height()];
    ui.ctx().data_mut(|d| d.get_temp_mut_or_default::<Targets>(id()).trims.push(TrimTarget { rect: array(rect), clip: array(clip) }));
}

pub fn current(ctx: &Context) -> Targets {
    ctx.data(|d| d.get_temp(id())).unwrap_or_default()
}

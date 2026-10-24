//! Explicit, clipped touch targets from the current UI pass; never guess from widget labels.

use egui::{Context, Id, Rect, Ui};

#[derive(Clone, Default)]
pub struct Targets {
    pub scrubs: Vec<[f32; 4]>,
    pub hold_drags: Vec<[f32; 4]>,
}

fn id() -> Id {
    Id::new("touch-edit-targets")
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

pub fn current(ctx: &Context) -> Targets {
    ctx.data(|d| d.get_temp(id())).unwrap_or_default()
}

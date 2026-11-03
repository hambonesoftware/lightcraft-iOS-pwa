//! Adaptive, photo-first workspace for narrow windows and phone landscape sizes.
//!
//! This reuses LightCraft's actual catalog, loupe, develop tools, masking,
//! presets, export and backup commands. It is not an alternate editing engine.
//! It leaves the desktop docking workspace and its saved arrangement intact.

use egui::{Align, Color32, Frame, Id, Margin, Stroke};
use serde_json::json;

use crate::LightcraftApp;
use crate::state::{RightPanel, ViewMode, Zoom};
use crate::theme::Tokens;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Drawer {
    #[default]
    Closed,
    Tools,
    Presets,
    More,
}

#[derive(Clone, Copy, Debug, Default)]
struct MobileState {
    drawer: Drawer,
    expanded: bool,
    search_open: bool,
}

const STATE_KEY: &str = "lightcraft-mobile-workspace";
const SEARCH_KEY: &str = "lightcraft-mobile-search";

/// Narrow portrait windows, iPhone landscape, and narrow iPad Stage Manager
/// windows use the compact workspace. Large iPads and desktop windows keep
/// their complete dockable desktop workspace.
pub fn is_compact(width: f32, height: f32) -> bool {
    width.is_finite() && height.is_finite() && (width < 720.0 || (height < 510.0 && width < 1100.0))
}

fn drawer_height(remaining_height: f32, expanded: bool) -> f32 {
    let desired = remaining_height * if expanded { 0.68 } else { 0.43 };
    desired.min((remaining_height - 100.0).max(90.0)).max(90.0)
}

fn state_id() -> Id {
    Id::new(STATE_KEY)
}

fn search_id() -> Id {
    Id::new(SEARCH_KEY)
}

fn run(app: &mut LightcraftApp, ctx: &egui::Context, command: &str) {
    if let Err(error) = app.run(command, json!({})) {
        app.toast_error(ctx, error);
    }
}

fn open_library(app: &mut LightcraftApp, state: &mut MobileState) {
    app.ui.view = ViewMode::PhotoGrid;
    app.ui.right = RightPanel::None;
    state.drawer = Drawer::Closed;
}

fn select_tool(app: &mut LightcraftApp, state: &mut MobileState, panel: RightPanel) {
    if app.session.active().is_none() {
        open_library(app, state);
        return;
    }
    app.ui.view = ViewMode::Detail;
    if app.ui.right == panel && state.drawer == Drawer::Tools {
        app.ui.right = RightPanel::None;
        state.drawer = Drawer::Closed;
    } else {
        app.ui.right = panel;
        state.drawer = Drawer::Tools;
    }
}

fn close_drawer(app: &mut LightcraftApp, state: &mut MobileState) {
    if state.drawer == Drawer::Tools {
        // A closed Crop or Mask drawer must not keep painting an invisible
        // crop/masking overlay on top of the image.
        app.ui.right = RightPanel::None;
    }
    state.drawer = Drawer::Closed;
    state.expanded = false;
}

fn heading_frame(color: Color32) -> Frame {
    Frame::NONE.fill(color).inner_margin(Margin { left: 10, right: 10, top: 5, bottom: 5 })
}

fn header(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let has_photo = app.session.active().is_some();
    ui.horizontal_centered(|ui| {
        ui.spacing_mut().item_spacing.x = 5.0;
        if app.ui.view != ViewMode::PhotoGrid && ui.add_sized([66.0, 44.0], egui::Button::new("Library")).clicked() {
            open_library(app, state);
        }
        ui.label(egui::RichText::new("LightCraft").strong().size(15.0));
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if has_photo && app.ui.view == ViewMode::Detail {
                if ui.add_sized([66.0, 44.0], egui::Button::new("Export")).clicked() {
                    run(app, ui.ctx(), "dialog.export");
                }
            } else {
                if ui.add_sized([66.0, 44.0], egui::Button::new("Import")).clicked() {
                    run(app, ui.ctx(), "file.addPhotos");
                }
                if ui.add_sized([70.0, 44.0], egui::Button::new("Search")).clicked() {
                    state.search_open = !state.search_open;
                    if state.search_open {
                        ui.memory_mut(|memory| memory.request_focus(search_id()));
                    } else {
                        ui.memory_mut(|memory| memory.surrender_focus(search_id()));
                    }
                }
            }
        });
    });
}

fn search_row(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    ui.horizontal_centered(|ui| {
        let width = (ui.available_width() - 70.0).max(110.0);
        let response = ui.add_sized(
            [width, 44.0],
            egui::TextEdit::singleline(&mut app.ui.search).id(search_id()).hint_text("Search photos"),
        );
        if response.changed() {
            let query = app.ui.search.clone();
            if let Err(error) = app.run("library.filter", json!({ "text": query })) {
                app.toast_error(ui.ctx(), error);
            }
        }
        if ui.add_sized([58.0, 44.0], egui::Button::new("Done")).clicked() {
            ui.memory_mut(|memory| memory.surrender_focus(search_id()));
            state.search_open = false;
        }
    });
}

fn mobile_tab(ui: &mut egui::Ui, width: f32, label: &str, active: bool, enabled: bool) -> bool {
    ui.add_enabled_sized([width, 46.0], enabled, egui::Button::new(label).selected(active)).clicked()
}

fn navigation(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let has_photo = app.session.active().is_some();
    let is_detail = app.ui.view == ViewMode::Detail;
    ui.horizontal_centered(|ui| {
        ui.spacing_mut().item_spacing.x = 4.0;
        let width = ((ui.available_width() - 16.0) / 5.0).max(42.0);
        if mobile_tab(ui, width, "Library", !is_detail, true) {
            open_library(app, state);
        }
        if mobile_tab(ui, width, "Edit", is_detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Edit, has_photo) {
            select_tool(app, state, RightPanel::Edit);
        }
        if mobile_tab(ui, width, "Crop", is_detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Crop, has_photo) {
            select_tool(app, state, RightPanel::Crop);
        }
        if mobile_tab(ui, width, "Mask", is_detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Masking, has_photo) {
            select_tool(app, state, RightPanel::Masking);
        }
        if mobile_tab(ui, width, "More", state.drawer == Drawer::More, true) {
            state.drawer = if state.drawer == Drawer::More { Drawer::Closed } else { Drawer::More };
        }
    });
}

fn more_action(app: &mut LightcraftApp, ui: &mut egui::Ui, label: &str, enabled: bool, command: &str) {
    if ui.add_enabled_sized([ui.available_width().max(44.0), 44.0], enabled, egui::Button::new(label)).clicked() {
        run(app, ui.ctx(), command);
    }
}

fn more_actions(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let has_photo = app.session.active().is_some();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        if ui.add_enabled_sized([ui.available_width(), 44.0], has_photo, egui::Button::new("Presets")).clicked() {
            app.ui.view = ViewMode::Detail;
            state.drawer = Drawer::Presets;
        }
        if ui.add_enabled_sized([ui.available_width(), 44.0], has_photo, egui::Button::new("Remove")).clicked() {
            select_tool(app, state, RightPanel::Remove);
        }
        if ui.add_enabled_sized([ui.available_width(), 44.0], has_photo, egui::Button::new("Info")).clicked() {
            select_tool(app, state, RightPanel::Info);
        }
        if ui.add_enabled_sized([ui.available_width(), 44.0], has_photo, egui::Button::new("Versions")).clicked() {
            select_tool(app, state, RightPanel::Versions);
        }
        if ui.add_enabled_sized([ui.available_width(), 44.0], has_photo, egui::Button::new("History")).clicked() {
            select_tool(app, state, RightPanel::Activity);
        }
        more_action(app, ui, "Import Photos", true, "file.addPhotos");
        more_action(app, ui, "Export", has_photo, "dialog.export");
        more_action(app, ui, "Back Up Library", true, "file.backupLibrary");
        more_action(app, ui, "Restore Library", true, "file.restoreLibrary");
    });
}

fn drawer(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let title = match state.drawer {
        Drawer::Closed => return,
        Drawer::Tools => match app.ui.right {
            RightPanel::Edit | RightPanel::Profiles => "Edit",
            RightPanel::Crop => "Crop & Rotate",
            RightPanel::Masking => "Mask",
            RightPanel::Remove => "Remove",
            RightPanel::Info => "Info",
            RightPanel::Activity => "History",
            RightPanel::Versions => "Versions",
            RightPanel::Keywords => "Keywords",
            RightPanel::RedEye => "Red Eye",
            RightPanel::None => "Tools",
        },
        Drawer::Presets => "Presets",
        Drawer::More => "More Tools",
    };
    ui.horizontal_centered(|ui| {
        ui.label(egui::RichText::new(title).strong().size(15.0));
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if ui.add_sized([60.0, 44.0], egui::Button::new("Done")).clicked() {
                close_drawer(app, state);
            }
            if ui.add_sized([68.0, 44.0], egui::Button::new(if state.expanded { "Smaller" } else { "Expand" })).clicked() {
                state.expanded = !state.expanded;
            }
            if state.drawer == Drawer::Tools && app.ui.view == ViewMode::Detail {
                if ui.add_sized([43.0, 44.0], egui::Button::new("Fit")).clicked() {
                    app.ui.zoom = Zoom::Fit;
                }
                if ui.add_sized([59.0, 44.0], egui::Button::new("Before")).clicked() {
                    run(app, ui.ctx(), "view.beforeAfter");
                }
            }
        });
    });
    if state.drawer == Drawer::Closed {
        return;
    }
    match state.drawer {
        Drawer::Tools => super::right::show(app, ui),
        Drawer::Presets => super::presets::show(app, ui),
        Drawer::More => more_actions(app, ui, state),
        Drawer::Closed => {}
    }
}

fn central(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    if app.ui.slideshow.is_some() {
        super::slideshow::show(app, ui);
        return;
    }
    super::compare::prepare(app);
    match app.ui.view {
        ViewMode::PhotoGrid | ViewMode::SquareGrid => super::grid::show(app, ui),
        ViewMode::Detail => {
            // The desktop filmstrip steals almost half the height of a phone
            // in landscape. Hide it only for this draw; preserve the user's
            // desktop setting when they return to a large window.
            let filmstrip = app.ui.filmstrip;
            app.ui.filmstrip = false;
            super::detail::show(app, ui);
            app.ui.filmstrip = filmstrip;
        }
        ViewMode::Compare => super::compare::show_compare(app, ui),
        ViewMode::Survey => super::compare::show_survey(app, ui),
        ViewMode::Reference => super::compare::show_reference(app, ui),
        ViewMode::People => super::people::show(app, ui),
    }
}

/// Draw without the desktop top-bar search box, dock resize affordances or
/// far-right icon strip. Every substantive edit remains in the shared editor.
pub fn show(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let ctx = ui.ctx().clone();
    let t = Tokens::get(&ctx);
    let mut state = ctx.data(|data| data.get_temp::<MobileState>(state_id())).unwrap_or_default();

    // A desktop search field can still hold focus after resizing. Surrender
    // only that field, not a deliberate mobile search or numeric edit.
    ctx.memory_mut(|memory| memory.surrender_focus(crate::text_field::id("field:search")));
    app.ui.focus_search = false;
    if app.session.active().is_none() && app.ui.view == ViewMode::Detail {
        open_library(app, &mut state);
    }
    if app.ui.view != ViewMode::Detail && matches!(state.drawer, Drawer::Tools | Drawer::Presets) {
        state.drawer = Drawer::Closed;
    }

    egui::Panel::top("lightcraft_mobile_header")
        .exact_size(54.0)
        .frame(heading_frame(t.chrome))
        .show(ui, |ui| header(app, ui, &mut state));

    if state.search_open && app.ui.view == ViewMode::PhotoGrid {
        egui::Panel::top("lightcraft_mobile_search")
            .exact_size(54.0)
            .frame(heading_frame(t.chrome))
            .show(ui, |ui| search_row(app, ui, &mut state));
    }

    egui::Panel::bottom("lightcraft_mobile_navigation")
        .exact_size(58.0)
        .frame(Frame::NONE.fill(t.chrome).stroke(Stroke::new(1.0, t.divider)).inner_margin(Margin { left: 8, right: 8, top: 5, bottom: 5 }))
        .show(ui, |ui| navigation(app, ui, &mut state));

    if state.drawer != Drawer::Closed {
        let height = drawer_height(ui.available_height(), state.expanded);
        egui::Panel::bottom("lightcraft_mobile_drawer")
            .exact_size(height)
            .frame(Frame::NONE.fill(t.chrome).stroke(Stroke::new(1.0, t.divider)).inner_margin(Margin { left: 8, right: 8, top: 4, bottom: 4 }))
            .show(ui, |ui| drawer(app, ui, &mut state));
    }

    egui::CentralPanel::default()
        .frame(Frame::NONE.fill(t.canvas))
        .show(ui, |ui| central(app, ui));

    ctx.data_mut(|data| data.insert_temp(state_id(), state));
}

#[cfg(test)]
mod tests {
    use super::{drawer_height, is_compact};

    #[test]
    fn phone_portrait_and_landscape_use_compact_tools() {
        assert!(is_compact(393.0, 852.0));
        assert!(is_compact(852.0, 393.0));
        assert!(is_compact(600.0, 900.0));
    }

    #[test]
    fn full_ipad_and_desktop_keep_the_dock() {
        assert!(!is_compact(1024.0, 768.0));
        assert!(!is_compact(1440.0, 900.0));
        assert!(!is_compact(900.0, 640.0));
        assert!(!is_compact(f32::NAN, 800.0));
    }

    #[test]
    fn drawer_never_claims_the_whole_photo_canvas() {
        for height in [260.0, 480.0, 760.0] {
            let standard = drawer_height(height, false);
            let expanded = drawer_height(height, true);
            assert!(standard >= 90.0 && standard <= height - 100.0);
            assert!(expanded >= standard && expanded <= height - 100.0);
        }
    }
}

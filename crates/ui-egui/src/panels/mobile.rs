//! Adaptive, photo-first workspace for narrow windows and phone landscape sizes.
//!
//! This reuses LightCraft's actual catalog, loupe, develop tools, masking,
//! presets, export and backup commands. It is not an alternate editing engine.
//! It leaves the desktop docking workspace and its saved arrangement intact.

use egui::{Align, Align2, Color32, Id, Rect, Sense, Stroke, UiBuilder, pos2, vec2};

use crate::icons::{Icon, paint};
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

/// Mobile correction groups map directly to existing develop sections.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum EditCategory {
    #[default]
    Light,
    Color,
    Effects,
    Detail,
    Optics,
    Calibration,
}

impl EditCategory {
    const ALL: [Self; 6] = [Self::Light, Self::Color, Self::Effects, Self::Detail, Self::Optics, Self::Calibration];

    fn key(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Color => "color",
            Self::Effects => "effects",
            Self::Detail => "detail",
            Self::Optics => "optics",
            Self::Calibration => "calibration",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Light => "Light",
            Self::Color => "Color",
            Self::Effects => "Effects",
            Self::Detail => "Detail",
            Self::Optics => "Optics",
            Self::Calibration => "Calibrate",
        }
    }

    fn icon(self) -> Icon {
        match self {
            Self::Light => Icon::Sliders,
            Self::Color => Icon::GradeAll,
            Self::Effects => Icon::Sun,
            Self::Detail => Icon::Eye,
            Self::Optics => Icon::Circle,
            Self::Calibration => Icon::Target,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct MobileState {
    drawer: Drawer,
    expanded: bool,
    search_open: bool,
    category: EditCategory,
}

const STATE_KEY: &str = "lightcraft-mobile-workspace";
const SEARCH_KEY: &str = "lightcraft-mobile-search";

/// Narrow portrait windows, iPhone landscape, and narrow iPad Stage Manager
/// windows use the compact workspace. Large iPads and desktop windows keep
/// their complete dockable desktop workspace.
pub fn is_compact(width: f32, height: f32) -> bool {
    width.is_finite() && height.is_finite() && (width < 720.0 || (height < 510.0 && width < 1100.0))
}

/// Size the inspector against the actual editor space. The photo always gets
/// a meaningful region, including in short iPhone landscape windows.
fn drawer_height(remaining_height: f32, expanded: bool) -> f32 {
    let desired = remaining_height * if expanded { 0.64 } else { 0.43 };
    let photo_reserve = if remaining_height >= 550.0 { 215.0 } else { 100.0 };
    desired.max(90.0).min((remaining_height - photo_reserve).max(90.0))
}

/// The inspector and photo areas never overlap. Rectangles are calculated
/// from the physical editor viewport rather than inferred from nested panels.
fn mobile_work_area(full: Rect, has_search: bool, drawer: Drawer, expanded: bool, previewing: bool) -> (Rect, Rect) {
    const HEADER: f32 = 54.0;
    const NAV: f32 = 64.0;
    const SEARCH: f32 = 54.0;
    let top = full.top() + HEADER + if has_search { SEARCH } else { 0.0 };
    let bottom = full.bottom() - NAV;
    let space = (bottom - top).max(0.0);
    let inspector_height = if drawer == Drawer::Closed {
        0.0
    } else {
        // Presets have a fixed-height, single-row look carousel. Allocating the
        // same tall drawer as the full editor created an empty gray wasteland.
        let preferred = if drawer == Drawer::Presets && !expanded { if previewing { 300.0 } else { 242.0 } } else { drawer_height(space, expanded) };
        let photo_reserve = if space >= 550.0 { 215.0 } else { 100.0 };
        preferred.min((space - photo_reserve).max(0.0))
    };
    let inspector_top = bottom - inspector_height;
    (
        Rect::from_min_max(pos2(full.left(), top), pos2(full.right(), inspector_top)),
        Rect::from_min_max(pos2(full.left(), inspector_top), pos2(full.right(), bottom)),
    )
}

fn state_id() -> Id {
    Id::unique(STATE_KEY)
}

fn search_id() -> Id {
    Id::unique(SEARCH_KEY)
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

/// Each part of the compact editor receives an explicit rectangle and clip.
/// Unlike nested top/bottom panels, no scrolling child can escape its sheet or
/// force the photo canvas into an invalid allocation.
fn region(ui: &mut egui::Ui, key: &'static str, rect: Rect, fill: Color32, inset: egui::Vec2, content: impl FnOnce(&mut egui::Ui)) {
    if rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    ui.painter().rect_filled(rect, 0.0, fill);
    let inner = rect.shrink2(inset);
    let mut child = ui.new_child(UiBuilder::new().id_salt(key).max_rect(inner).layout(egui::Layout::top_down(Align::Min)));
    child.set_clip_rect(rect.intersect(ui.clip_rect()));
    content(&mut child);
}

fn header(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let has_photo = app.session.active().is_some();
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 5.0;
        if !matches!(app.ui.view, ViewMode::PhotoGrid | ViewMode::SquareGrid)
            && ui.add_sized([72.0, 44.0], egui::Button::new("‹ Library").frame(false)).clicked()
        {
            open_library(app, state);
        }
        ui.label(egui::RichText::new("LightCraft").strong().size(16.0));
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if has_photo && app.ui.view == ViewMode::Detail {
                if ui.add_sized([65.0, 44.0], egui::Button::new("Export").frame(false)).clicked() {
                    run(app, ui.ctx(), "dialog.export");
                }
            } else {
                if ui.add_sized([65.0, 44.0], egui::Button::new("Import").frame(false)).clicked() {
                    run(app, ui.ctx(), "file.addPhotos");
                }
                if ui.add_sized([64.0, 44.0], egui::Button::new("Search").frame(false)).clicked() {
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
    ui.horizontal(|ui| {
        let width = (ui.available_width() - 70.0).max(110.0);
        let response = ui.add_sized([width, 44.0], egui::TextEdit::singleline(&mut app.ui.search).id(search_id()).hint_text("Search photos"));
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

/// Compact, icon-led touch target with a restrained active indicator instead
/// of the large blue desktop buttons that obscured the photo on iOS.
fn mobile_tab(ui: &mut egui::Ui, width: f32, label: &str, icon: Icon, active: bool, enabled: bool) -> bool {
    let (rect, response) = ui.allocate_exact_size(vec2(width, 52.0), if enabled { Sense::click() } else { Sense::hover() });
    let t = Tokens::get(ui.ctx());
    if active {
        ui.painter().rect_filled(rect.shrink2(vec2(2.0, 2.0)), 9.0, t.tool_active);
        ui.painter().line_segment(
            [pos2(rect.left() + 12.0, rect.bottom() - 2.0), pos2(rect.right() - 12.0, rect.bottom() - 2.0)],
            Stroke::new(2.0, t.accent),
        );
    }
    let ink = if !enabled {
        t.text_dim
    } else if active {
        t.text
    } else {
        t.text_label
    };
    let glyph = Rect::from_center_size(pos2(rect.center().x, rect.top() + 18.0), vec2(19.0, 19.0));
    paint(ui.painter(), glyph, icon, ink);
    ui.painter().text(pos2(rect.center().x, rect.bottom() - 11.0), Align2::CENTER_CENTER, label, t.font(11.0), ink);
    crate::widgets::announce(&response, label.to_owned());
    enabled && response.clicked()
}

fn correction_category(app: &mut LightcraftApp, state: &mut MobileState, category: EditCategory) {
    if app.session.active().is_none() {
        open_library(app, state);
        return;
    }
    app.ui.view = ViewMode::Detail;
    app.ui.right = RightPanel::Edit;
    if state.category == category && state.drawer == Drawer::Tools {
        state.drawer = Drawer::Closed;
        app.ui.right = RightPanel::None;
    } else {
        state.category = category;
        state.drawer = Drawer::Tools;
    }
}

fn navigation(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let had_look_preview = state.drawer == Drawer::Presets;
    let has_photo = app.session.active().is_some();
    let detail = app.ui.view == ViewMode::Detail;
    // Library remains reachable while the correction categories scroll under
    // the thumb. No fixed five-column layout or horizontally squeezed text.
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 4.0;
        if mobile_tab(ui, 67.0, "Library", Icon::GridPhoto, !detail, true) {
            open_library(app, state);
        }
        egui::ScrollArea::horizontal().id_salt("mobile-correction-navigation").auto_shrink([false, false]).show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                if mobile_tab(ui, 68.0, "Looks", Icon::Presets, detail && state.drawer == Drawer::Presets, has_photo) {
                    app.ui.view = ViewMode::Detail;
                    if state.drawer == Drawer::Presets {
                        state.drawer = Drawer::Closed;
                    } else {
                        state.drawer = Drawer::Presets;
                        // Presets are evaluated for the whole image. Entering
                        // the Looks inspector should not inherit a stale 1:1
                        // loupe zoom and show a giant cropped face plus a map.
                        app.ui.zoom = Zoom::Fit;
                        app.ui.pan = (0.5, 0.5);
                        app.ui.zoom_anim = false;
                    }
                }
                for category in EditCategory::ALL {
                    let selected = detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Edit && state.category == category;
                    if mobile_tab(ui, 67.0, category.label(), category.icon(), selected, has_photo) {
                        correction_category(app, state, category);
                    }
                }
                if mobile_tab(ui, 67.0, "Crop", Icon::Crop, detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Crop, has_photo) {
                    select_tool(app, state, RightPanel::Crop);
                }
                if mobile_tab(ui, 67.0, "Mask", Icon::Mask, detail && state.drawer == Drawer::Tools && app.ui.right == RightPanel::Masking, has_photo)
                {
                    select_tool(app, state, RightPanel::Masking);
                }
                if mobile_tab(ui, 67.0, "More", Icon::More, state.drawer == Drawer::More, true) {
                    state.drawer = if state.drawer == Drawer::More { Drawer::Closed } else { Drawer::More };
                }
            });
        });
    });
    if had_look_preview && state.drawer != Drawer::Presets {
        super::presets::clear_mobile_preview(ui.ctx());
        app.hover_preview = None;
    }
}

fn more_action(app: &mut LightcraftApp, ui: &mut egui::Ui, label: &str, enabled: bool, command: &str) {
    let width = ui.available_width().max(44.0);
    if ui.add_enabled(enabled, egui::Button::new(label).min_size(egui::vec2(width, 44.0))).clicked() {
        run(app, ui.ctx(), command);
    }
}

fn more_actions(app: &mut LightcraftApp, ui: &mut egui::Ui, state: &mut MobileState) {
    let has_photo = app.session.active().is_some();
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        let width = ui.available_width().max(44.0);
        if ui.add_enabled(has_photo, egui::Button::new("Presets").min_size(egui::vec2(width, 44.0))).clicked() {
            app.ui.view = ViewMode::Detail;
            state.drawer = Drawer::Presets;
        }
        if ui.add_enabled(has_photo, egui::Button::new("Remove").min_size(egui::vec2(width, 44.0))).clicked() {
            select_tool(app, state, RightPanel::Remove);
        }
        if ui.add_enabled(has_photo, egui::Button::new("Info").min_size(egui::vec2(width, 44.0))).clicked() {
            select_tool(app, state, RightPanel::Info);
        }
        if ui.add_enabled(has_photo, egui::Button::new("Versions").min_size(egui::vec2(width, 44.0))).clicked() {
            select_tool(app, state, RightPanel::Versions);
        }
        if ui.add_enabled(has_photo, egui::Button::new("History").min_size(egui::vec2(width, 44.0))).clicked() {
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
            RightPanel::Edit => state.category.label(),
            RightPanel::Profiles => "Profiles",
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
        Drawer::Presets => "Looks",
        Drawer::More => "More Tools",
    };
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(title).strong().size(15.0));
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if ui.add_sized([60.0, 44.0], egui::Button::new("Done").frame(false)).clicked() {
                if state.drawer == Drawer::Presets {
                    super::presets::clear_mobile_preview(ui.ctx());
                    app.hover_preview = None;
                }
                close_drawer(app, state);
            }
            if ui.add_sized([68.0, 44.0], egui::Button::new(if state.expanded { "Reduce" } else { "Expand" }).frame(false)).clicked() {
                state.expanded = !state.expanded;
            }
        });
    });
    // Give the preview actions their own row. A single toolbar containing
    // title, Done, Expand, Fit and Before clips on smaller iPhone widths.
    if state.drawer == Drawer::Tools && app.ui.view == ViewMode::Detail {
        ui.horizontal(|ui| {
            if app.ui.right == RightPanel::Edit
                && state.category == EditCategory::Light
                && ui.add_sized([58.0, 44.0], egui::Button::new("Auto")).clicked()
            {
                run(app, ui.ctx(), "develop.auto");
            }
            if ui.add_sized([56.0, 44.0], egui::Button::new("Fit")).clicked() {
                app.ui.zoom = Zoom::Fit;
            }
            if ui.add_sized([110.0, 44.0], egui::Button::new("Before/After")).clicked() {
                run(app, ui.ctx(), "view.beforeAfter");
            }
        });
    }
    if state.drawer == Drawer::Closed {
        return;
    }
    match state.drawer {
        Drawer::Tools if app.ui.right == RightPanel::Edit => {
            if let Some(id) = app.session.active() {
                egui::ScrollArea::vertical().id_salt(("mobile-edit-scroll", state.category.key())).auto_shrink([false, false]).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 2.0;
                    super::edit::show_mobile(app, ui, id, state.category.key());
                });
            }
        }
        Drawer::Tools => super::right::show(app, ui),
        Drawer::Presets => super::presets::show_mobile(app, ui),
        Drawer::More => more_actions(app, ui, state),
        Drawer::Closed => {}
    }
}

fn central(app: &mut LightcraftApp, ui: &mut egui::Ui, drawer: Drawer) {
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
            let right = app.ui.right;
            let face_boxes = app.ui.face_boxes;
            let navigator = app.ui.navigator;
            app.ui.filmstrip = false;
            // In a photo-correction drawer, overlays and the zoom minimap
            // obstruct judging the edited image. Preserve user preferences
            // and restore them immediately after the real photo is drawn.
            if drawer == Drawer::Presets || (drawer == Drawer::Tools && right == RightPanel::Edit) {
                app.ui.face_boxes = false;
                app.ui.navigator = false;
            }
            // Crop/mask overlays should not linger over the image while a
            // different drawer is active or the controls are collapsed.
            if drawer != Drawer::Tools {
                app.ui.right = RightPanel::None;
            }
            super::detail::show(app, ui);
            app.ui.right = right;
            app.ui.face_boxes = face_boxes;
            app.ui.navigator = navigator;
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
/// One explicit layout controls the mobile chrome, inspector and photograph.
/// Drawing the inspector before the photograph allows the real preset preview
/// to reach the loupe in the same pass without overlapping painted widgets.
pub fn show(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let ctx = ui.ctx().clone();
    let t = Tokens::get(&ctx);
    let mut state = ctx.data(|data| data.get_temp::<MobileState>(state_id())).unwrap_or_default();

    ctx.memory_mut(|memory| memory.surrender_focus(crate::text_field::id("field:search")));
    app.ui.focus_search = false;
    if app.session.active().is_none() && app.ui.view == ViewMode::Detail {
        open_library(app, &mut state);
    }
    if app.ui.view != ViewMode::Detail && matches!(state.drawer, Drawer::Tools | Drawer::Presets) {
        state.drawer = Drawer::Closed;
    }

    let full = ui.max_rect();
    // No nested panels: the bottom rail is fixed, the sheet is independently
    // bounded, and the loupe receives exactly the rectangle left over.
    const HEADER: f32 = 54.0;
    const NAV: f32 = 64.0;
    const SEARCH: f32 = 54.0;
    let has_search = state.search_open && matches!(app.ui.view, ViewMode::PhotoGrid | ViewMode::SquareGrid);
    let top_h = HEADER + if has_search { SEARCH } else { 0.0 };
    let header_rect = Rect::from_min_max(full.min, pos2(full.right(), full.top() + HEADER));
    let nav_rect = Rect::from_min_max(pos2(full.left(), full.bottom() - NAV), full.max);

    region(ui, "mobile_header", header_rect, t.chrome, vec2(10.0, 4.0), |ui| header(app, ui, &mut state));
    if has_search {
        let search_rect = Rect::from_min_max(pos2(full.left(), full.top() + HEADER), pos2(full.right(), full.top() + top_h));
        region(ui, "mobile_search", search_rect, t.chrome, vec2(10.0, 4.0), |ui| search_row(app, ui, &mut state));
    }
    region(ui, "mobile_bottom_navigation", nav_rect, t.chrome, vec2(7.0, 4.0), |ui| navigation(app, ui, &mut state));

    let previewing = state.drawer == Drawer::Presets && super::presets::mobile_preview_active(&ctx);
    let (photo_rect, sheet_rect) = mobile_work_area(full, has_search, state.drawer, state.expanded, previewing);
    if state.drawer != Drawer::Closed && sheet_rect.height() > 0.0 {
        region(ui, "mobile_inspector", sheet_rect, t.chrome, vec2(11.0, 5.0), |ui| drawer(app, ui, &mut state));
        ui.painter()
            .line_segment([pos2(sheet_rect.left(), sheet_rect.top()), pos2(sheet_rect.right(), sheet_rect.top())], Stroke::new(1.0, t.divider));
    }
    region(ui, "mobile_photo", photo_rect, t.canvas, vec2(0.0, 0.0), |ui| central(app, ui, state.drawer));
    ui.painter().line_segment([pos2(nav_rect.left(), nav_rect.top()), pos2(nav_rect.right(), nav_rect.top())], Stroke::new(1.0, t.divider));

    ctx.data_mut(|data| data.insert_temp(state_id(), state));
}
#[cfg(test)]
mod tests {
    use super::{drawer_height, is_compact};

    #[test]
    fn mobile_inspector_and_photo_are_strictly_non_overlapping() {
        use super::{Drawer, mobile_work_area};
        use egui::{Rect, pos2};
        for height in [350.0, 640.0, 768.0, 852.0, 1024.0] {
            let full = Rect::from_min_max(pos2(0.0, 0.0), pos2(393.0, height));
            for drawer in [Drawer::Closed, Drawer::Tools, Drawer::Presets, Drawer::More] {
                for expanded in [false, true] {
                    for preview in [false, true] {
                        let (photo, inspector) = mobile_work_area(full, false, drawer, expanded, preview);
                        assert!(photo.height() > 0.0);
                        assert_eq!(photo.bottom(), inspector.top());
                        assert!(inspector.bottom() <= height - 64.0);
                        assert_eq!(inspector.left(), 0.0);
                        assert_eq!(inspector.right(), 393.0);
                        if drawer == Drawer::Closed {
                            assert_eq!(inspector.height(), 0.0);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn compact_looks_inspector_is_content_sized() {
        use super::{Drawer, mobile_work_area};
        use egui::{Rect, pos2};
        let full = Rect::from_min_max(pos2(0.0, 0.0), pos2(393.0, 850.0));
        let (photo, inspector) = mobile_work_area(full, false, Drawer::Presets, false, false);
        assert!(inspector.height() <= 244.0);
        assert!(inspector.height() >= 235.0);
        assert!(photo.height() > inspector.height());
        let (_, selected) = mobile_work_area(full, false, Drawer::Presets, false, true);
        assert!(selected.height() >= inspector.height() + 50.0);
    }

    #[test]
    fn inspector_header_row_stays_at_the_top() {
        use super::region;
        use egui::{Color32, Context, RawInput, Rect, pos2, vec2};
        let ctx = Context::default();
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(393.0, 800.0));
        let output = ctx.run_pass(RawInput { screen_rect: Some(screen), ..Default::default() }, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let sheet = Rect::from_min_size(pos2(0.0, 400.0), vec2(393.0, 260.0));
                region(ui, "test_mobile_inspector", sheet, Color32::BLACK, vec2(8.0, 4.0), |ui| {
                    let title = ui.horizontal(|ui| {
                        ui.add_sized([70.0, 44.0], egui::Button::new("Looks"));
                    });
                    let gallery = ui.label("Preset thumbnail row");
                    assert!(title.response.rect.top() <= sheet.top() + 12.0, "inspector header must be top-aligned");
                    assert!(gallery.rect.top() < sheet.top() + 72.0, "content must not be pushed below the visible sheet");
                });
            });
        });
        output.drop_without_applying_deltas();
    }

    #[test]
    fn selecting_a_look_makes_room_for_strength_and_apply() {
        use super::{Drawer, mobile_work_area};
        use egui::{Rect, pos2};
        let full = Rect::from_min_max(pos2(0.0, 0.0), pos2(390.0, 800.0));
        let (_, unselected) = mobile_work_area(full, false, Drawer::Presets, false, false);
        let (_, selected) = mobile_work_area(full, false, Drawer::Presets, false, true);
        assert!(selected.height() >= unselected.height() + 50.0);
    }

    #[test]
    fn correction_categories_have_unique_engine_sections() {
        use super::EditCategory;
        let categories = EditCategory::ALL;
        assert_eq!(categories.len(), 6);
        let mut keys = std::collections::HashSet::new();
        for category in categories {
            assert!(keys.insert(category.key()), "duplicate correction category");
            assert!(!category.label().is_empty());
        }
        assert_eq!(EditCategory::Light.key(), "light");
        assert_eq!(EditCategory::Color.key(), "color");
        assert_eq!(EditCategory::Effects.key(), "effects");
        assert_eq!(EditCategory::Optics.key(), "optics");
    }

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

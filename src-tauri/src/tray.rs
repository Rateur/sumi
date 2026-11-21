//! The tray icon: Sumi's logo, with the microphone or camera dot or the music in its corner as the island has them,
//! a tooltip that says what's going on, and the menu. The page decides all of it as it changes, in its language. A
//! left click tucks the island or brings it back; a right click opens the menu, which pauses or clears the clipboard
//! history while there is one, and forgets the weather's yes while one is kept. Icons are drawn here, at the size the
//! taskbar shows them, so they stay sharp at every scale.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent, Wry};

use crate::{clipboard, weather};

/// The logo's tile and mark, as in the app's icon and the site's favicon.
const INK: [u8; 3] = [0x0B, 0x0B, 0x0F];
const PAPER: [u8; 3] = [0xF4, 0xF1, 0xEA];
/// The island's microphone and camera dots (docs/design.md, Look).
const MIC: [u8; 3] = [0xFB, 0x92, 0x3C];
const CAMERA: [u8; 3] = [0x4A, 0xDE, 0x80];
/// How much larger the mark is on its tile than in the app's icon, so it still reads at 16 px.
const MARK: f64 = 1.2;
/// Samples per pixel along each axis.
const SAMPLES: u32 = 8;

/// What the icon's corner shows. Mirrored as `Badge` in src/lib/tray.ts.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Badge {
    Plain,
    Mic,
    Camera,
    Music,
}

/// The tray as the page sets it: the icon's corner, the tooltip and the menu's words. Mirrored as `Tray` in
/// src/lib/tray.ts.
#[derive(Deserialize)]
pub struct Tray {
    badge: Badge,
    tip: String,
    tuck: String,
    pause: String,
    clear: String,
    forget: String,
    quit: String,
}

/// The tray icon, its menu and the menu's items, and the corner and size it last drew.
pub struct Parts {
    icon: TrayIcon<Wry>,
    menu: Menu<Wry>,
    tuck: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    clear: MenuItem<Wry>,
    forget: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    drawn: Mutex<(Badge, u32)>,
}

/// Builds the tray icon: the plain logo, `tip`, and English words until the page gives its own. These hold if the
/// page's fail, as they do while the taskbar isn't up at login, and Explorer shows them again when it restarts.
pub fn build(app: &App, tip: String) -> tauri::Result<()> {
    let tuck = MenuItem::with_id(app, "tuck", "Tuck the island", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause clipboard history", true, None::<&str>)?;
    let clear = MenuItem::with_id(app, "clear", "Clear clipboard history", true, None::<&str>)?;
    let forget = MenuItem::with_id(app, "forget", "Forget the weather", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Sumi", true, None::<&str>)?;
    let size = side(scale(app.handle()));
    // The clipboard history's items come in once clipboard::watch has read whether it is on, the weather's once
    // weather::menu has looked for its yes.
    let menu = Menu::with_items(app, &[&tuck, &quit])?;
    let icon = TrayIconBuilder::new()
        .icon(image(Badge::Plain, size))
        .tooltip(tip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tuck" => {
                let _ = app.emit("island://tuck", ());
            }
            "pause" => clipboard::pause(app),
            "clear" => clipboard::clear(app),
            "forget" => weather::forget(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("island://tuck", ());
            }
        })
        .build(app)?;
    app.manage(Parts {
        icon,
        menu,
        tuck,
        pause,
        clear,
        forget,
        quit,
        drawn: Mutex::new((Badge::Plain, size)),
    });

    // The island sits on the primary screen, whose taskbar holds the tray: a new scale there redraws the icon.
    if let Some(window) = app.get_webview_window("island") {
        let app = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
                show(&app, None, side(*scale_factor));
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_tray(app: AppHandle, tray: Tray) {
    show(&app, Some(tray.badge), side(scale(&app)));
    // Before setup has made the tray, the page sets it again at its next change.
    if let Some(parts) = app.try_state::<Parts>() {
        let _ = parts.icon.set_tooltip(Some(tray.tip));
        let _ = parts.tuck.set_text(tray.tuck);
        let _ = parts.pause.set_text(tray.pause);
        let _ = parts.clear.set_text(tray.clear);
        let _ = parts.forget.set_text(tray.forget);
        let _ = parts.quit.set_text(tray.quit);
    }
}

/// Puts the clipboard history's items between the tuck and quit: the pause while it is `on`, the clear while one is
/// `kept`.
pub fn clipboard(app: &AppHandle, on: bool, kept: bool) {
    let Some(parts) = app.try_state::<Parts>() else {
        return;
    };
    // Removing an item the menu doesn't hold only fails.
    let _ = parts.menu.remove(&parts.pause);
    let _ = parts.menu.remove(&parts.clear);
    let mut at = 1;
    for (show, item) in [(on, &parts.pause), (kept, &parts.clear)] {
        if show {
            let _ = parts.menu.insert(item, at);
            at += 1;
        }
    }
}

/// Puts the weather's forget just before the quit while its yes is `kept`, so after the clipboard history's items, which
/// go in from the tuck. Called on the main thread only, where the clipboard's changes, sent from its threads one at a
/// time, can't land between the count and the insert.
pub fn weather(app: &AppHandle, kept: bool) {
    let Some(parts) = app.try_state::<Parts>() else {
        return;
    };
    let _ = parts.menu.remove(&parts.forget);
    if kept && let Ok(items) = parts.menu.items() {
        let _ = parts
            .menu
            .insert(&parts.forget, items.len().saturating_sub(1));
    }
}

/// Draws the icon again, only when its corner (`badge`, or the one it has) or its size changed.
fn show(app: &AppHandle, badge: Option<Badge>, side: u32) {
    let Some(parts) = app.try_state::<Parts>() else {
        return;
    };
    let Ok(mut drawn) = parts.drawn.lock() else {
        return;
    };
    let next = (badge.unwrap_or(drawn.0), side);
    // One that fails, while the taskbar isn't up, is drawn at the next change.
    if *drawn != next && parts.icon.set_icon(Some(image(next.0, next.1))).is_ok() {
        *drawn = next;
    }
}

fn scale(app: &AppHandle) -> f64 {
    app.get_webview_window("island")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0)
}

/// The size Windows shows a tray icon at, its small icon size: 16 px at 100 %, 20 at 125 %, 24 at 150 %, 32 at 200 %.
fn side(scale: f64) -> u32 {
    (16.0 * scale).round().clamp(16.0, 64.0) as u32
}

fn image(badge: Badge, side: u32) -> Image<'static> {
    Image::new_owned(draw(badge, side), side, side)
}

/// Sumi's logo, `side` px square, with `badge` in its bottom right corner: straight RGBA, row by row. Each pixel
/// averages `SAMPLES` × `SAMPLES` points.
fn draw(badge: Badge, side: u32) -> Vec<u8> {
    let logo = Logo::new(f64::from(side), badge);
    let step = 1.0 / f64::from(SAMPLES);
    let mut rgba = Vec::with_capacity((side * side * 4) as usize);
    for y in 0..side {
        for x in 0..side {
            let (mut sum, mut inside) = ([0u32; 3], 0u32);
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let px = f64::from(x) + (f64::from(sx) + 0.5) * step;
                    let py = f64::from(y) + (f64::from(sy) + 0.5) * step;
                    if let Some(color) = logo.at(px, py) {
                        inside += 1;
                        for (s, c) in sum.iter_mut().zip(color) {
                            *s += u32::from(c);
                        }
                    }
                }
            }
            let [r, g, b] = sum.map(|s| (s + inside / 2).checked_div(inside).unwrap_or(0) as u8);
            let a = (inside * 255 + SAMPLES * SAMPLES / 2) / (SAMPLES * SAMPLES);
            rgba.extend([r, g, b, a as u8]);
        }
    }
    rgba
}

/// The logo's shapes in px, for one size. Its geometry is the favicon's (site/public/favicon.svg, 1024 units): a
/// rounded tile, and the mark, a bar with a drop hanging from it by a neck.
struct Logo {
    side: f64,
    /// The tile's corner radius.
    round: f64,
    /// The bar: its centre, half-width and half-height.
    bar: (f64, f64, f64, f64),
    /// The drop: its centre and radius.
    drop: (f64, f64, f64),
    /// How far apart the bar and the drop are still joined, which draws the neck between them.
    neck: f64,
    badge: Badge,
    /// The badge's centre and radius, in the tile's corner.
    corner: (f64, f64, f64),
}

impl Logo {
    fn new(side: f64, badge: Badge) -> Self {
        // In the favicon's units, from the mark's centre at (512, 512): the bar is 600 × 160 with its top 167 above
        // and its middle 72 above, and the drop's centre is 103 below, with a radius of 64. The tile's corners are 224.
        let mid = side / 2.0;
        let unit = side / 1024.0 * MARK;
        // The bar's edges sit on whole pixels: rounded to a whole thickness, its top moved to the nearest pixel, and
        // the drop moved with it.
        let thick = (160.0 * unit).round().max(2.0);
        let top = (mid - 167.0 * unit).round();
        let shift = top + thick / 2.0 - (mid - 72.0 * unit);
        let round = side * 224.0 / 1024.0;
        Logo {
            side,
            round,
            bar: (mid, top + thick / 2.0, 300.0 * unit, thick / 2.0),
            drop: (mid, mid + 103.0 * unit + shift, 64.0 * unit),
            neck: 100.0 * unit,
            badge,
            // Around the tile's corner arc, so a ring of the tile, as wide at 16 px as a pixel, holds it like the
            // island's disc holds its dot.
            corner: (side - round, side - round, round - side / 16.0),
        }
    }

    /// The color at a point, or `None` outside the tile.
    fn at(&self, x: f64, y: f64) -> Option<[u8; 3]> {
        let half = self.side / 2.0;
        if rounded(x - half, y - half, half, half, self.round) > 0.0 {
            return None;
        }
        let (cx, cy, r) = self.corner;
        let badge = match self.badge {
            Badge::Plain => None,
            Badge::Mic => (circle(x - cx, y - cy, r) <= 0.0).then_some(MIC),
            Badge::Camera => (circle(x - cx, y - cy, r) <= 0.0).then_some(CAMERA),
            Badge::Music => self.bars(x, y).then_some(PAPER),
        };
        if let Some(color) = badge {
            return Some(color);
        }
        let (bx, by, bw, bh) = self.bar;
        let (dx, dy, dr) = self.drop;
        let bar = rounded(x - bx, y - by, bw, bh, bh);
        let drop = circle(x - dx, y - dy, dr);
        Some(if smooth_min(bar, drop, self.neck) <= 0.0 {
            PAPER
        } else {
            INK
        })
    }

    /// The music's three bars, in the badge's disc and centred on it, as the island's equalizer stands.
    fn bars(&self, x: f64, y: f64) -> bool {
        let (cx, cy, r) = self.corner;
        let width = (self.side / 16.0).round();
        let gap = ((2.0 * r - 3.0 * width) / 2.0).floor().clamp(1.0, width);
        // The bars' edges on whole pixels.
        let left = (cx - (3.0 * width + 2.0 * gap) / 2.0).round();
        [0.55, 1.0, 0.75].iter().enumerate().any(|(i, height)| {
            let mid = left + (width + gap) * i as f64 + width / 2.0;
            rounded(x - mid, y - cy, width / 2.0, r * height, width / 2.0) <= 0.0
        })
    }
}

/// Signed distance from a point, relative to a box's centre, to the box with half sizes `hx`, `hy` and corner radius
/// `r`: negative inside.
fn rounded(x: f64, y: f64, hx: f64, hy: f64, r: f64) -> f64 {
    let (qx, qy) = (x.abs() - hx + r, y.abs() - hy + r);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
}

fn circle(x: f64, y: f64, r: f64) -> f64 {
    x.hypot(y) - r
}

/// The union of two shapes, joined by a smooth neck where they come within `k` of each other, like the goo between
/// the island and its bubble.
fn smooth_min(a: f64, b: f64, k: f64) -> f64 {
    let h = (k - (a - b).abs()).max(0.0) / k;
    a.min(b) - h * h * k / 4.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], side: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * side + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn matches_the_taskbar_scale() {
        assert_eq!([1.0, 1.25, 1.5, 1.75, 2.0].map(side), [16, 20, 24, 28, 32]);
        assert_eq!(side(0.5), 16);
    }

    #[test]
    fn draws_a_square_of_straight_rgba() {
        for side in [16, 20, 24, 28, 32] {
            let rgba = draw(Badge::Plain, side);
            assert_eq!(rgba.len(), (side * side * 4) as usize);
            // The tile's rounded corner lets the taskbar through; its middle row is opaque.
            assert_eq!(pixel(&rgba, side, 0, 0)[3], 0);
            assert_eq!(pixel(&rgba, side, 0, side / 2)[3], 255);
        }
    }

    #[test]
    fn keeps_the_bar_on_whole_pixels() {
        for side in [16, 20, 24, 28, 32] {
            let logo = Logo::new(f64::from(side), Badge::Plain);
            let (_, y, _, half) = logo.bar;
            assert_eq!((y - half).fract(), 0.0, "{side} px");
            assert_eq!((y + half).fract(), 0.0, "{side} px");
        }
    }

    #[test]
    fn paints_the_mark_in_the_middle_and_the_badge_in_the_corner() {
        let side = 32;
        let logo = Logo::new(f64::from(side), Badge::Plain);
        let rgba = draw(Badge::Plain, side);
        assert_eq!(
            pixel(&rgba, side, 16, logo.bar.1 as u32),
            [0xF4, 0xF1, 0xEA, 255]
        );
        let (cx, cy, _) = Logo::new(f64::from(side), Badge::Mic).corner;
        let (x, y) = (cx as u32, cy as u32);
        assert_eq!(pixel(&rgba, side, x, y), [0x0B, 0x0B, 0x0F, 255]);
        assert_eq!(
            pixel(&draw(Badge::Mic, side), side, x, y),
            [0xFB, 0x92, 0x3C, 255]
        );
        assert_eq!(
            pixel(&draw(Badge::Camera, side), side, x, y),
            [0x4A, 0xDE, 0x80, 255]
        );
    }

    #[test]
    fn is_symmetric_without_a_badge() {
        let side = 24;
        let rgba = draw(Badge::Plain, side);
        for y in 0..side {
            for x in 0..side / 2 {
                assert_eq!(
                    pixel(&rgba, side, x, y),
                    pixel(&rgba, side, side - 1 - x, y)
                );
            }
        }
    }

    #[test]
    fn reads_the_page_words() {
        let tray: Tray = serde_json::from_str(
            r#"{"badge":"camera","tip":"Sumi · caméra : Zoom","tuck":"Ranger l'île","pause":"Mettre en pause l'historique du presse-papiers","clear":"Effacer l'historique du presse-papiers","forget":"Oublier la météo","quit":"Quitter Sumi"}"#,
        )
        .expect("the page's shape");
        assert_eq!(tray.badge, Badge::Camera);
        assert_eq!(tray.forget, "Oublier la météo");
        assert_eq!(tray.quit, "Quitter Sumi");
    }
}

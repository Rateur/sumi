//! The island's window: kept at the top center of the primary screen, letting clicks through everywhere but the
//! shapes the page draws, closing the open panel on Esc, a click elsewhere or a change of app, and telling the page
//! when a window is dragged, so the island tucks out of Snap layouts' way.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, Wry};

use crate::fullscreen::{self, Presence};

/// Poll ticks between the island starting to slide up and its window hiding. The content leaves, then the
/// island slides up (`FULLSCREEN` in src/lib/motion.ts): about 550 ms in all.
const HIDE_AFTER: u32 = 20;

/// Bounds in CSS pixels, relative to the window: the island, and the bubble and the privacy tag when they show.
/// Mirrored in `src/lib/shapes.ts`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

impl Rect {
    /// Follows the rounded corners, as the page does: a click in a corner falls through.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        let (right, bottom) = (self.x + self.width, self.y + self.height);
        if !(x >= self.x && x < right && y >= self.y && y < bottom) {
            return false;
        }
        let r = self.radius;
        let dx = (self.x + r - x).max(x - (right - r)).max(0.0);
        let dy = (self.y + r - y).max(y - (bottom - r)).max(0.0);
        dx * dx + dy * dy <= r * r
    }
}

/// Where the island and its bubble are. The frontend sends them on every frame while they spring:
/// only what is drawn takes clicks, where a union of start and end would also catch the empty
/// corners around a growing panel.
#[derive(Default)]
pub struct IslandRects(pub Mutex<Vec<Rect>>);

#[tauri::command]
pub fn set_island_rects(state: tauri::State<'_, IslandRects>, rects: Vec<Rect>) {
    if let Ok(mut current) = state.0.lock() {
        *current = rects;
    }
}

/// Whether the panel is open, so Esc and clicks elsewhere are watched only while it is.
#[derive(Default)]
pub struct IslandExpanded(pub AtomicBool);

#[tauri::command]
pub fn set_island_expanded(state: tauri::State<'_, IslandExpanded>, expanded: bool) {
    state.0.store(expanded, Ordering::Relaxed);
}

/// Whether the island waits to tuck itself, so a click elsewhere is heard only then.
#[derive(Default)]
pub struct IslandWaiting(pub AtomicBool);

#[tauri::command]
pub fn set_island_waiting(state: tauri::State<'_, IslandWaiting>, waiting: bool) {
    state.0.store(waiting, Ordering::Relaxed);
}

/// The presence the poll last decided, for a page that loads after `island://presence` was sent.
pub struct IslandPresence(pub Mutex<Presence>);

#[tauri::command]
pub fn island_presence(state: tauri::State<'_, IslandPresence>) -> Presence {
    state.0.lock().map_or(Presence::Shown, |presence| *presence)
}

/// The tray menu's tuck item. The page gives it its words, in the island's language, as the island tucks and comes
/// back.
pub struct TuckItem(pub MenuItem<Wry>);

#[tauri::command]
pub fn set_tuck_label(app: AppHandle, label: String) {
    // Before setup has made the item, the page sets it again at its next change.
    if let Some(item) = app.try_state::<TuckItem>() {
        let _ = item.0.set_text(label);
    }
}

/// A window being moved or resized, as the poll follows it. It counts once the cursor leaves Windows' drag rectangle
/// around where the move began: a click on a title bar starts a move too, and must leave the island alone.
#[derive(Default)]
struct Move {
    /// Where the cursor was when the move began, while it lasts.
    from: Option<(i32, i32)>,
    /// What the page was last told.
    told: bool,
}

impl Move {
    /// One tick: whether Windows says a move is under way, the cursor, and how far it may go each way before it
    /// drags. Returns what to tell the page when that changes.
    fn step(&mut self, held: bool, cursor: (i32, i32), drag: (i32, i32)) -> Option<bool> {
        let now = match (held, self.from) {
            (false, _) => {
                self.from = None;
                false
            }
            (true, None) => {
                self.from = Some(cursor);
                false
            }
            (true, Some((x, y))) => {
                self.told || (cursor.0 - x).abs() > drag.0 || (cursor.1 - y).abs() > drag.1
            }
        };
        if now == self.told {
            return None;
        }
        self.told = now;
        Some(now)
    }
}

/// How far the cursor goes each way, in pixels, before Windows calls it a drag.
#[cfg(windows)]
fn drag() -> (i32, i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXDRAG, SM_CYDRAG};
    // SAFETY: no pointer and no handle; a failed read returns 0, and any move then counts.
    unsafe { (GetSystemMetrics(SM_CXDRAG), GetSystemMetrics(SM_CYDRAG)) }
}

#[cfg(not(windows))]
fn drag() -> (i32, i32) {
    (4, 4)
}

/// How long the cursor rests on the island before it grows: the Windows hover time, within reason.
/// Read on every arrival, so a changed setting applies without a restart.
fn hover_time() -> u32 {
    system_hover_time().clamp(200, 800)
}

#[cfg(windows)]
fn system_hover_time() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SPI_GETMOUSEHOVERTIME, SystemParametersInfoW,
    };
    let mut ms: u32 = 400;
    unsafe { SystemParametersInfoW(SPI_GETMOUSEHOVERTIME, 0, (&raw mut ms).cast(), 0) };
    ms
}

#[cfg(not(windows))]
fn system_hover_time() -> u32 {
    400
}

/// Mouse buttons and Esc, one bit each, as [`keys`] reads them.
const MOUSE: u8 = 0b0111;
const ESCAPE: u8 = 0b1000;

/// Whether the keys read in two ticks in a row close the panel: Esc pressed anywhere,
/// or a mouse button pressed outside the island. Only a new press counts, not one held down.
pub fn dismisses(before: u8, now: u8, inside: bool) -> bool {
    (now & !before) & ESCAPE != 0 || elsewhere(before, now, inside)
}

/// Whether a mouse button was just pressed outside the island.
pub fn elsewhere(before: u8, now: u8, inside: bool) -> bool {
    !inside && (now & !before) & MOUSE != 0
}

/// Whether the island takes the cursor this tick. A button already held when the cursor arrives,
/// as in a tab drag, a text selection or a window drag, passes through until every button is up.
/// A drag that starts on the island, on the progress bar for one, keeps the cursor until it ends.
pub fn takes_cursor(took: bool, inside: bool, held: bool) -> bool {
    (took && held) || (inside && (took || !held))
}

/// Reads the buttons and Esc without taking them: the click or the key still reaches the app underneath.
/// Reads nothing while an elevated app has focus (UIPI), which is why a change of app also closes the panel.
#[cfg(windows)]
fn keys() -> u8 {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_ESCAPE]
        .into_iter()
        .enumerate()
        // Non-zero when down now, or pressed since the last read: a tap shorter than a tick still counts.
        .filter(|&(_, key)| unsafe { GetAsyncKeyState(i32::from(key)) } != 0)
        .fold(0, |bits, (i, _)| bits | 1 << i)
}

#[cfg(not(windows))]
fn keys() -> u8 {
    0
}

/// The app in front, which Windows tells even when it is elevated.
#[cfg(windows)]
fn foreground() -> usize {
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as usize }
}

#[cfg(not(windows))]
fn foreground() -> usize {
    0
}

/// The window's width, and the cursor from its top-left corner, in physical pixels. Plain Win32 calls from the
/// poll's thread: Tauri's getters make the same ones, but each after a round trip to the main thread.
#[cfg(windows)]
fn window_and_cursor(window: usize) -> Option<(i32, i32, i32)> {
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

    let mut cursor = POINT { x: 0, y: 0 };
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    // SAFETY: each call writes only to a local, and a window that went away makes them fail rather than misread.
    let read =
        unsafe { GetCursorPos(&mut cursor) != 0 && GetWindowRect(window as HWND, &mut rect) != 0 };
    read.then_some((
        rect.right - rect.left,
        cursor.x - rect.left,
        cursor.y - rect.top,
    ))
}

#[cfg(not(windows))]
fn window_and_cursor(_: usize) -> Option<(i32, i32, i32)> {
    None
}

/// The primary screen's size in physical pixels, read from the poll's thread.
#[cfg(windows)]
fn screen() -> (i32, i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    // SAFETY: no pointer and no handle; a failed read returns 0.
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}

#[cfg(not(windows))]
fn screen() -> (i32, i32) {
    (0, 0)
}

/// The wait, after the island comes back, for the primary screen's size from before the hide: a game's resolution
/// can come back a moment after the game leaves the front.
struct Settle {
    /// Ticks left to wait.
    left: u32,
    /// The primary screen's size to come back to.
    before: (i32, i32),
}

impl Settle {
    /// One tick while the island shows, with the screen's size `now`: whether the poll moves the window. While
    /// waiting, only once the screen is back. Otherwise on a new window width, which a new scale brings, and once a
    /// second. The size to come back to is taken only when the presence check ran, and never while waiting: a game
    /// that changes the resolution after it comes to the front stays unseen until the next check.
    fn step(&mut self, now: (i32, i32), checked: bool, width_changed: bool, second: bool) -> bool {
        if self.left == 0 {
            if checked {
                self.before = now;
            }
            return width_changed || second;
        }
        if now == self.before {
            self.left = 0;
            return true;
        }
        self.left -= 1;
        false
    }
}

/// Top-left corner that centers a window of `width` on the top edge of an area.
pub fn top_center(area_x: i32, area_y: i32, area_width: u32, width: u32) -> (i32, i32) {
    let offset = (i64::from(area_width) - i64::from(width)) / 2;
    (area_x + offset as i32, area_y)
}

/// Gives the window back its size and moves it to the top center of the primary screen's work area, if it isn't
/// there yet. Callers don't run it while `fullscreen::set_visible` keeps it hidden: during a game, the work area is
/// the game's resolution, and the window would come back off center.
pub fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    // Windows 10 keeps the old pixel size across a change of scale when windows don't draw while dragged.
    if let Some(config) = window
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == window.label())
    {
        let size = LogicalSize::new(config.width, config.height)
            .to_physical::<u32>(window.scale_factor()?);
        if window.inner_size()? != size {
            window.set_size(size)?;
        }
    }
    let area = monitor.work_area();
    let (x, y) = top_center(
        area.position.x,
        area.position.y,
        area.size.width,
        window.outer_size()?.width,
    );
    if window.outer_position()? != PhysicalPosition::new(x, y) {
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// Lets clicks and drags through everywhere except over the island, tells the frontend when the cursor
/// enters it, with the hover time to wait, or leaves it, when the open panel should close, when a window is
/// dragged, and of a click elsewhere while the island waits to tuck itself, keeps the window in place when the
/// resolution, the scale or the taskbar changes, and hides it while something is fullscreen.
// shortcut: polls the cursor 30 times a second, so a press is judged where the cursor is at the next tick, and the
// first touch or pen tap on the island reaches the app underneath. A window region built from the rects would decide
// on the press itself: switch when touch matters or profiling shows a cost.
/// `trigger` and `presence` are what setup found before showing the window.
pub fn follow_cursor(
    app: AppHandle,
    window: WebviewWindow,
    mut trigger: Option<usize>,
    mut presence: Presence,
) {
    std::thread::spawn(move || {
        #[cfg(windows)]
        let hwnd = window.hwnd().map_or(0, |hwnd| hwnd.0 as usize);
        #[cfg(not(windows))]
        let hwnd = 0;
        let mut width = 0;
        let mut scale = 1.0;
        let mut settle = Settle {
            left: 0,
            before: screen(),
        };
        let mut over = None;
        let mut before = None;
        let mut clicked = None;
        let mut tick: u32 = 0;
        let mut moves = Move::default();
        // Going, the island slides up off the screen and then the window hides. Coming back, the window
        // shows first and then the island drops down.
        let mut hide_at = None;
        // The command bar brings the island itself to the front: that change of app is not one that closes it.
        let own = hwnd;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            tick = tick.wrapping_add(1);
            if hide_at == Some(tick) {
                hide_at = None;
                let _ = fullscreen::set_visible(&window, false);
            }
            let second = tick.is_multiple_of(30);
            // F11 and in-page fullscreen keep the same window in front: the once-a-second check catches them.
            let checked = fullscreen::switched() || second;
            if checked {
                let (next, now) = fullscreen::check(hwnd, trigger);
                trigger = next;
                if now != presence {
                    let hides = now == Presence::Hidden;
                    if hides != (presence == Presence::Hidden) {
                        app.state::<IslandExpanded>()
                            .0
                            .store(false, Ordering::Relaxed);
                        over = None;
                        if hides {
                            // The app gets every click from now on, even one where the island was.
                            let _ = window.set_ignore_cursor_events(true);
                            hide_at = Some(tick.wrapping_add(HIDE_AFTER));
                        } else if hide_at.take().is_none() {
                            // Back after the window hid, rather than before. Placed below, once the screen is back.
                            let _ = fullscreen::set_visible(&window, true);
                            settle.left = 30;
                        }
                    }
                    if let Ok(mut current) = app.state::<IslandPresence>().0.lock() {
                        *current = now;
                    }
                    let _ = app.emit("island://presence", now);
                    presence = now;
                }
            }
            if presence == Presence::Hidden {
                continue;
            }
            let Some((now_width, x, y)) = window_and_cursor(hwnd) else {
                continue;
            };
            // Windows resizes the window for a new scale: center it again at once, not at the next second.
            let width_changed = now_width != width;
            if width_changed {
                width = now_width;
                // shortcut: where Windows keeps the old pixel width on a new scale (Windows 10, no contents while
                // dragging), the hit test uses the old scale until the once-a-second place() resizes the window.
                // Read the scale every second too if that shows.
                scale = window.scale_factor().unwrap_or(scale);
            }
            if settle.step(screen(), checked, width_changed, second) {
                let _ = place(&window);
            }
            if let Some(moving) = moves.step(fullscreen::moving(), (x, y), drag()) {
                let _ = app.emit("island://moving", moving);
            }
            let (x, y) = (f64::from(x) / scale, f64::from(y) / scale);
            let inside = app
                .state::<IslandRects>()
                .0
                .lock()
                .is_ok_and(|rects| rects.iter().any(|r| r.contains(x, y)));
            let keys = keys();
            let takes = takes_cursor(over == Some(true), inside, keys & MOUSE != 0);
            // Once events are ignored the page never hears the cursor leave, so this is the source of truth.
            if over != Some(takes) && window.set_ignore_cursor_events(!takes).is_ok() {
                over = Some(takes);
                let _ = app.emit("island://pointer", takes.then(hover_time));
            }
            let expanded = app.state::<IslandExpanded>();
            if expanded.0.load(Ordering::Relaxed) {
                let now = (keys, foreground());
                if before
                    // A press the island took is on it, even when a quick drag left its edge before this tick.
                    .is_some_and(|(keys, front)| {
                        (front != now.1 && now.1 != own)
                            || dismisses(keys, now.0, inside || over == Some(true))
                    })
                {
                    expanded.0.store(false, Ordering::Relaxed);
                    let _ = app.emit("island://dismiss", ());
                }
                before = Some(now);
            } else {
                before = None;
            }
            if app.state::<IslandWaiting>().0.load(Ordering::Relaxed) {
                if clicked
                    .is_some_and(|before| elsewhere(before, keys, inside || over == Some(true)))
                {
                    let _ = app.emit("island://elsewhere", ());
                }
                clicked = Some(keys);
            } else {
                clicked = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const PILL: Rect = Rect {
        x: 234.0,
        y: 8.0,
        width: 132.0,
        height: 34.0,
        radius: 17.0,
    };

    #[test]
    fn contains_points_inside_and_on_the_top_and_left_edges() {
        assert!(PILL.contains(300.0, 20.0));
        assert!(PILL.contains(234.0, 25.0));
        assert!(PILL.contains(300.0, 8.0));
    }

    #[test]
    fn excludes_the_rounded_corners() {
        assert!(!PILL.contains(235.0, 9.0));
        assert!(!PILL.contains(364.0, 40.0));
        assert!(PILL.contains(240.0, 20.0));
    }

    #[test]
    fn excludes_points_outside_and_on_the_bottom_right_edge() {
        assert!(!PILL.contains(233.9, 20.0));
        assert!(!PILL.contains(366.0, 20.0));
        assert!(!PILL.contains(300.0, 42.0));
        assert!(!Rect::default().contains(0.0, 0.0));
    }

    #[test]
    fn esc_closes_wherever_the_cursor_is() {
        assert!(dismisses(0, ESCAPE, true));
        assert!(dismisses(0, ESCAPE, false));
    }

    #[test]
    fn a_click_closes_only_outside_the_island() {
        for button in [0b001, 0b010, 0b100] {
            assert!(dismisses(0, button, false));
            assert!(!dismisses(0, button, true));
        }
    }

    #[test]
    fn a_key_held_down_does_not_close_again() {
        assert!(!dismisses(ESCAPE, ESCAPE, false));
        assert!(!dismisses(MOUSE, MOUSE, false));
        assert!(!dismisses(ESCAPE, 0, false));
    }

    #[test]
    fn a_new_click_outside_is_elsewhere_but_not_esc_or_one_inside() {
        assert!(elsewhere(0, 0b001, false));
        assert!(!elsewhere(0, 0b001, true));
        assert!(!elsewhere(0, ESCAPE, false));
        assert!(!elsewhere(0b001, 0b001, false));
    }

    #[test]
    fn a_second_button_pressed_while_one_is_held_closes() {
        assert!(dismisses(0b001, 0b011, false));
    }

    #[test]
    fn takes_the_cursor_only_over_the_island() {
        assert!(takes_cursor(false, true, false));
        assert!(!takes_cursor(false, false, false));
    }

    #[test]
    fn a_drag_from_elsewhere_crosses_until_every_button_is_up() {
        assert!(!takes_cursor(false, true, true));
        assert!(takes_cursor(false, true, false));
    }

    #[test]
    fn a_press_on_the_island_keeps_it() {
        assert!(takes_cursor(true, true, true));
        // Even out of the island, until the button is up.
        assert!(takes_cursor(true, false, true));
        assert!(!takes_cursor(true, false, false));
    }

    const NATIVE: (i32, i32) = (1920, 1080);
    const GAME: (i32, i32) = (1280, 720);

    #[test]
    fn coming_back_waits_for_the_screen_size_from_before_the_hide() {
        let mut settle = Settle {
            left: 2,
            before: NATIVE,
        };
        // Still the game's resolution, even on a check and a new width: no move, and the size to wait for stays.
        assert!(!settle.step(GAME, true, true, true));
        assert_eq!((settle.left, settle.before), (1, NATIVE));
        // The screen is back: the window moves and the wait ends.
        assert!(settle.step(NATIVE, false, false, false));
        assert_eq!(settle.left, 0);
    }

    #[test]
    fn a_screen_that_doesnt_come_back_ends_the_wait() {
        let mut settle = Settle {
            left: 1,
            before: NATIVE,
        };
        assert!(!settle.step(GAME, false, false, false));
        assert_eq!(settle.left, 0);
        // The next check takes the new size, and the once-a-second move runs.
        assert!(settle.step(GAME, true, false, true));
        assert_eq!(settle.before, GAME);
    }

    #[test]
    fn otherwise_places_on_a_new_width_and_once_a_second() {
        let mut settle = Settle {
            left: 0,
            before: NATIVE,
        };
        assert!(settle.step(NATIVE, false, true, false));
        assert!(settle.step(NATIVE, true, false, true));
        assert!(!settle.step(NATIVE, false, false, false));
        // A game that changes the resolution between two checks doesn't change the size to come back to.
        assert!(!settle.step(GAME, false, false, false));
        assert_eq!(settle.before, NATIVE);
    }

    #[test]
    fn a_click_on_a_title_bar_is_no_move() {
        let mut moves = Move::default();
        assert_eq!(moves.step(true, (100, 100), (4, 4)), None);
        assert_eq!(moves.step(true, (103, 96), (4, 4)), None);
        assert_eq!(moves.step(false, (103, 96), (4, 4)), None);
    }

    #[test]
    fn a_drag_past_the_drag_rectangle_is_a_move_until_it_ends() {
        let mut moves = Move::default();
        assert_eq!(moves.step(true, (100, 100), (4, 4)), None);
        assert_eq!(moves.step(true, (100, 105), (4, 4)), Some(true));
        // Back near where it began, it is still the same move.
        assert_eq!(moves.step(true, (100, 100), (4, 4)), None);
        assert_eq!(moves.step(false, (300, 20), (4, 4)), Some(false));
    }

    #[test]
    fn each_move_starts_from_its_own_press() {
        let mut moves = Move::default();
        moves.step(true, (100, 100), (4, 4));
        moves.step(false, (100, 100), (4, 4));
        assert_eq!(moves.step(true, (500, 500), (4, 4)), None);
        assert_eq!(moves.step(true, (506, 500), (4, 4)), Some(true));
    }

    #[test]
    fn centers_on_the_primary_screen() {
        assert_eq!(top_center(0, 0, 1920, 600), (660, 0));
    }

    #[test]
    fn centers_on_a_screen_left_of_the_primary_one() {
        assert_eq!(top_center(-2560, 0, 2560, 900), (-1730, 0));
    }

    #[test]
    fn respects_a_taskbar_at_the_top() {
        assert_eq!(top_center(0, 48, 1920, 600), (660, 48));
    }

    #[test]
    fn handles_a_window_wider_than_the_area() {
        assert_eq!(top_center(0, 0, 500, 600), (-50, 0));
    }
}

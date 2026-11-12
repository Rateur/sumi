use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

/// The island's bounds in CSS pixels, relative to the window. The frontend keeps it current.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Default)]
pub struct IslandRect(pub Mutex<Rect>);

#[tauri::command]
pub fn set_island_rect(state: tauri::State<'_, IslandRect>, rect: Rect) {
    if let Ok(mut current) = state.0.lock() {
        *current = rect;
    }
}

/// Top-left corner that centers a window of `width` on the top edge of an area.
pub fn top_center(area_x: i32, area_y: i32, area_width: u32, width: u32) -> (i32, i32) {
    let offset = (i64::from(area_width) - i64::from(width)) / 2;
    (area_x + offset as i32, area_y)
}

/// Moves the window to the top center of the primary screen's work area, if it isn't there yet.
pub fn place(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
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

/// Lets clicks through everywhere except over the island, and keeps the window in place
/// when the resolution, the scale or the taskbar changes.
// shortcut: polls the cursor 30 times a second; a low-level mouse hook would idle at 0 %, switch if profiling shows a cost.
pub fn follow_cursor(app: AppHandle, window: WebviewWindow) {
    std::thread::spawn(move || {
        let mut over = None;
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            tick = tick.wrapping_add(1);
            if tick.is_multiple_of(60) {
                let _ = place(&window);
            }
            let (Ok(cursor), Ok(origin), Ok(scale)) = (
                app.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let rect = app
                .state::<IslandRect>()
                .0
                .lock()
                .map(|r| *r)
                .unwrap_or_default();
            let inside = rect.contains(
                (cursor.x - f64::from(origin.x)) / scale,
                (cursor.y - f64::from(origin.y)) / scale,
            );
            if over != Some(inside) && window.set_ignore_cursor_events(!inside).is_ok() {
                over = Some(inside);
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
    };

    #[test]
    fn contains_points_inside_and_on_the_top_left_edge() {
        assert!(PILL.contains(300.0, 20.0));
        assert!(PILL.contains(234.0, 8.0));
    }

    #[test]
    fn excludes_points_outside_and_on_the_bottom_right_edge() {
        assert!(!PILL.contains(233.9, 20.0));
        assert!(!PILL.contains(366.0, 20.0));
        assert!(!PILL.contains(300.0, 42.0));
        assert!(!Rect::default().contains(0.0, 0.0));
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

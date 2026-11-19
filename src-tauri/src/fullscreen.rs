//! Decides when the island hides: a borderless window over the whole primary screen, exclusive Direct3D or a
//! presentation. A hook hears each change of app instead of polling; a check once a second still catches F11.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::WebviewWindow;

/// How much of the island shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Shown,
    /// Windows says you're busy: news updates in place, and only calls peek.
    Quiet,
    /// Something fills the primary screen: the window is hidden.
    Hidden,
}

// Win32 values, so the decisions build and test on any system.
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_DLGFRAME: u32 = 0x0040_0000;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_WINDOWEDGE: u32 = 0x0000_0100;
const QUNS_NOT_PRESENT: i32 = 1;
const QUNS_BUSY: i32 = 2;
const QUNS_RUNNING_D3D_FULL_SCREEN: i32 = 3;
const QUNS_PRESENTATION_MODE: i32 = 4;

/// The desktop and the taskbars cover a screen without being fullscreen.
const SHELL: [&str; 4] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

/// Left, top, right, bottom, in physical pixels.
pub type Bounds = [i32; 4];

/// Chromium's test (`fullscreen_win.cc`): the window covers the whole monitor and has no frame.
/// A maximized window overhangs the screen too, but keeps its resizing frame.
pub fn fills(window: Bounds, monitor: Bounds, style: u32, ex_style: u32, class: &str) -> bool {
    let [left, top, right, bottom] = window;
    left <= monitor[0]
        && top <= monitor[1]
        && right >= monitor[2]
        && bottom >= monitor[3]
        && style & (WS_THICKFRAME | WS_DLGFRAME) == 0
        && ex_style & (WS_EX_WINDOWEDGE | WS_EX_TOOLWINDOW) == 0
        && !SHELL.contains(&class)
}

/// The window in front, as the check sees it. `window` is 0 when no window is in front.
#[derive(Clone, Copy, Debug)]
pub struct Front {
    pub window: usize,
    pub fills: bool,
    pub on_primary: bool,
}

/// The window that keeps the island hidden. It stays until it stops filling the screen, or until
/// another window on the primary screen comes to the front: a click on a chat on a second screen
/// keeps a video's island hidden. While the front is elsewhere, `under`, the window filling the
/// primary screen at its center, takes over, such as a video that was never in front.
pub fn trigger(
    current: Option<usize>,
    holds: bool,
    front: Front,
    under: Option<usize>,
) -> Option<usize> {
    match current {
        Some(window) if holds && (front.window == window || !front.on_primary) => current,
        _ if front.fills => Some(front.window),
        _ if !front.on_primary => under,
        _ => None,
    }
}

/// Hidden for a window that fills the primary screen, and for what Windows itself calls fullscreen:
/// exclusive Direct3D and presentation mode. Its "busy" state, which also covers other screens, and a
/// locked screen only keep it quiet. Quiet time after an upgrade doesn't: it would mute Sumi for an hour.
pub fn presence(trigger: Option<usize>, quns: i32) -> Presence {
    match quns {
        _ if trigger.is_some() => Presence::Hidden,
        QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE => Presence::Hidden,
        QUNS_NOT_PRESENT | QUNS_BUSY => Presence::Quiet,
        _ => Presence::Shown,
    }
}

/// Set by the foreground hook, read by the poll.
static SWITCHED: AtomicBool = AtomicBool::new(false);

/// Whether another window came to the front since the last call.
pub fn switched() -> bool {
    SWITCHED.swap(false, Ordering::Relaxed)
}

/// Hears every change of foreground window. Out-of-context events arrive on the registering thread
/// through its message loop, so this runs on Tauri's main thread, and the callback only sets a flag.
#[cfg(windows)]
pub fn watch_foreground() {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    unsafe extern "system" fn on_foreground(
        _: HWINEVENTHOOK,
        _: u32,
        _: HWND,
        _: i32,
        _: i32,
        _: u32,
        _: u32,
    ) {
        SWITCHED.store(true, Ordering::Relaxed);
    }

    unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            std::ptr::null_mut(),
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
    }
}

#[cfg(not(windows))]
pub fn watch_foreground() {}

/// Reads the window in front and Windows' notification state, and decides.
#[cfg(windows)]
pub fn check(island: &WebviewWindow, current: Option<usize>) -> (Option<usize>, Presence) {
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, MONITORINFO,
        MonitorFromPoint, MonitorFromWindow,
    };
    use windows_sys::Win32::UI::Shell::SHQueryUserNotificationState;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GetAncestor, GetClassNameW, GetCursorPos,
        GetForegroundWindow, GetWindowLongW, GetWindowRect, IsIconic, IsWindowVisible,
        WindowFromPoint,
    };

    let own = island.hwnd().map_or(0, |hwnd| hwnd.0 as usize);
    unsafe {
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..std::mem::zeroed()
        };
        GetMonitorInfoW(primary, &mut info);
        let monitor = info.rcMonitor;
        let monitor = [monitor.left, monitor.top, monitor.right, monitor.bottom];

        let class_of = |window: HWND| {
            let mut class = [0u16; 32];
            let len = GetClassNameW(window, class.as_mut_ptr(), class.len() as i32);
            String::from_utf16_lossy(&class[..len.max(0) as usize])
        };
        // A closed window is not visible, so this also drops a trigger that went away. A window on
        // another virtual desktop stays visible but cloaked.
        let fills_screen = |window: HWND| {
            if window as usize == own || IsWindowVisible(window) == 0 || IsIconic(window) != 0 {
                return false;
            }
            let mut cloaked = 0u32;
            DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED as u32,
                (&raw mut cloaked).cast(),
                size_of::<u32>() as u32,
            );
            let mut rect: RECT = std::mem::zeroed();
            cloaked == 0
                && GetWindowRect(window, &mut rect) != 0
                && fills(
                    [rect.left, rect.top, rect.right, rect.bottom],
                    monitor,
                    GetWindowLongW(window, GWL_STYLE) as u32,
                    GetWindowLongW(window, GWL_EXSTYLE) as u32,
                    &class_of(window),
                )
        };

        let window = GetForegroundWindow();
        // The desktop spans every screen, so the one it is on is the one under the cursor.
        let mut cursor = POINT { x: 0, y: 0 };
        let monitor_of_front =
            if SHELL.contains(&class_of(window).as_str()) && GetCursorPos(&mut cursor) != 0 {
                MonitorFromPoint(cursor, MONITOR_DEFAULTTONULL)
            } else {
                MonitorFromWindow(window, MONITOR_DEFAULTTONULL)
            };
        let front = Front {
            window: window as usize,
            fills: fills_screen(window),
            on_primary: !window.is_null() && monitor_of_front == primary,
        };
        let center = POINT {
            x: (monitor[0] + monitor[2]) / 2,
            y: (monitor[1] + monitor[3]) / 2,
        };
        let under = GetAncestor(WindowFromPoint(center), GA_ROOT);
        let under = fills_screen(under).then_some(under as usize);
        let holds = current.is_some_and(|trigger| fills_screen(trigger as HWND));
        let next = trigger(current, holds, front, under);
        let mut quns = 0;
        SHQueryUserNotificationState(&mut quns);
        (next, presence(next, quns))
    }
}

#[cfg(not(windows))]
pub fn check(_: &WebviewWindow, _: Option<usize>) -> (Option<usize>, Presence) {
    (None, Presence::Shown)
}

/// Hides or shows the island's window without taking focus. Tauri's `show()` uses `SW_SHOW`, which
/// activates, so this goes around it: Tauri keeps believing the window is visible, which leaves its own
/// `SW_SHOW` on later style changes a no-op. Nothing may change the window's styles while it is hidden.
/// The webview stays visible: a hidden one lets go of its GPU memory, and its first blurs after coming
/// back drop frames, 50 to 90 ms at a time. With nothing animating, it draws nothing in the meantime.
#[cfg(windows)]
pub fn set_visible(island: &WebviewWindow, visible: bool) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNOACTIVATE, ShowWindow};

    let show = if visible { SW_SHOWNOACTIVATE } else { SW_HIDE };
    unsafe { ShowWindow(island.hwnd()?.0, show) };
    Ok(())
}

#[cfg(not(windows))]
pub fn set_visible(island: &WebviewWindow, visible: bool) -> tauri::Result<()> {
    if visible {
        island.show()
    } else {
        island.hide()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Bounds = [0, 0, 1920, 1080];
    const POPUP: u32 = 0x8000_0000 | 0x1000_0000;
    const OVERLAPPED: u32 = 0x00CF_0000;

    fn front(window: usize, fills: bool, on_primary: bool) -> Front {
        Front {
            window,
            fills,
            on_primary,
        }
    }

    #[test]
    fn a_borderless_window_over_the_whole_screen_fills_it() {
        assert!(fills(SCREEN, SCREEN, POPUP, 0, "Chrome_WidgetWin_1"));
        assert!(fills(
            [-1, -1, 1921, 1081],
            SCREEN,
            POPUP,
            0,
            "UnityWndClass"
        ));
    }

    #[test]
    fn a_maximized_window_keeps_its_frame() {
        assert!(!fills(
            [-8, -8, 1928, 1088],
            SCREEN,
            OVERLAPPED,
            0x100,
            "Notepad"
        ));
        assert!(!fills(
            [-8, -8, 1928, 1088],
            SCREEN,
            WS_THICKFRAME,
            0,
            "Chrome_WidgetWin_1"
        ));
    }

    #[test]
    fn a_window_short_of_an_edge_does_not_fill() {
        assert!(!fills([0, 0, 1920, 1040], SCREEN, POPUP, 0, "x"));
        assert!(!fills([1, 0, 1920, 1080], SCREEN, POPUP, 0, "x"));
    }

    #[test]
    fn a_fullscreen_window_on_another_screen_does_not_fill_the_primary_one() {
        assert!(!fills([1920, 0, 4480, 1440], SCREEN, POPUP, 0, "x"));
    }

    #[test]
    fn dialog_frames_and_tool_windows_do_not_fill() {
        assert!(!fills(SCREEN, SCREEN, WS_DLGFRAME, 0, "x"));
        assert!(!fills(SCREEN, SCREEN, POPUP, WS_EX_WINDOWEDGE, "x"));
        assert!(!fills(SCREEN, SCREEN, POPUP, WS_EX_TOOLWINDOW, "x"));
    }

    #[test]
    fn the_desktop_and_the_taskbars_never_fill() {
        for class in SHELL {
            assert!(!fills(SCREEN, SCREEN, POPUP, 0, class));
        }
    }

    #[test]
    fn a_window_that_fills_the_screen_hides_the_island() {
        assert_eq!(trigger(None, false, front(7, true, true), None), Some(7));
        assert_eq!(trigger(None, false, front(7, false, true), None), None);
    }

    #[test]
    fn a_click_on_another_screen_keeps_it_hidden() {
        assert_eq!(
            trigger(Some(7), true, front(9, false, false), None),
            Some(7)
        );
        assert_eq!(
            trigger(Some(7), true, front(0, false, false), None),
            Some(7)
        );
    }

    #[test]
    fn another_window_on_the_primary_screen_brings_it_back() {
        assert_eq!(trigger(Some(7), true, front(9, false, true), None), None);
        assert_eq!(trigger(Some(7), true, front(9, true, true), None), Some(9));
    }

    #[test]
    fn a_window_filling_the_primary_screen_hides_it_while_the_front_is_elsewhere() {
        assert_eq!(
            trigger(None, false, front(9, false, false), Some(7)),
            Some(7)
        );
        assert_eq!(
            trigger(Some(5), false, front(0, false, false), Some(7)),
            Some(7)
        );
        assert_eq!(trigger(None, false, front(9, false, true), Some(7)), None);
    }

    #[test]
    fn it_comes_back_when_the_trigger_leaves_fullscreen() {
        assert_eq!(trigger(Some(7), false, front(7, false, true), None), None);
        assert_eq!(trigger(Some(7), false, front(9, false, false), None), None);
    }

    #[test]
    fn exclusive_fullscreen_and_presentations_hide_it() {
        assert_eq!(
            presence(None, QUNS_RUNNING_D3D_FULL_SCREEN),
            Presence::Hidden
        );
        assert_eq!(presence(None, QUNS_PRESENTATION_MODE), Presence::Hidden);
        assert_eq!(presence(Some(7), 5), Presence::Hidden);
    }

    #[test]
    fn busy_or_locked_keeps_it_quiet_without_hiding_it() {
        assert_eq!(presence(None, QUNS_BUSY), Presence::Quiet);
        assert_eq!(presence(None, QUNS_NOT_PRESENT), Presence::Quiet);
    }

    #[test]
    fn otherwise_it_shows() {
        // Accepts notifications, quiet time, a Windows Store app in front.
        for quns in [5, 6, 7] {
            assert_eq!(presence(None, quns), Presence::Shown);
        }
    }
}

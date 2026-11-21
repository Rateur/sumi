//! The command bar's shortcuts, the screen capture's, and focus. The island never takes focus, except while the bar is open: a shortcut
//! lets Sumi come to the front, and the window it came from gets focus back on Esc or when the bar closes.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Tried in order, and the first one Windows gives Sumi is kept. Ctrl+Alt+S would take a letter from keyboards that
/// type one with AltGr+S, and Ctrl+Shift+S is Save As.
const SHORTCUTS: [(&str, Modifiers, Code); 2] = [
    (
        "Win+Alt+S",
        Modifiers::SUPER.union(Modifiers::ALT),
        Code::KeyS,
    ),
    (
        "Alt+Shift+S",
        Modifiers::ALT.union(Modifiers::SHIFT),
        Code::KeyS,
    ),
];

/// The clipboard history's, which opens the bar on its list, tried the same way. Win+V is Windows' own history.
const CLIPBOARD: [(&str, Modifiers, Code); 2] = [
    (
        "Win+Alt+V",
        Modifiers::SUPER.union(Modifiers::ALT),
        Code::KeyV,
    ),
    (
        "Alt+Shift+V",
        Modifiers::ALT.union(Modifiers::SHIFT),
        Code::KeyV,
    ),
];

/// The screen capture's, tried the same way. Win+Shift+C is PowerToys' colour picker.
const CAPTURE: [(&str, Modifiers, Code); 2] = [
    (
        "Win+Alt+C",
        Modifiers::SUPER.union(Modifiers::ALT),
        Code::KeyC,
    ),
    (
        "Alt+Shift+C",
        Modifiers::ALT.union(Modifiers::SHIFT),
        Code::KeyC,
    ),
];

#[derive(Default)]
pub struct Bar {
    /// The shortcut Sumi got, which every hint shows. Empty when other apps hold them all.
    shortcut: OnceLock<&'static str>,
    /// The window that had focus when the bar opened.
    previous: AtomicUsize,
    focusable: AtomicBool,
}

/// Registers the first free shortcut of each list. Each press tells the page to open or close the bar, its
/// clipboard history or the screen capture; while the island is hidden in fullscreen, the page ignores it. If Windows' hotkeys can't be
/// set up at all, the bar has no shortcut.
pub fn register(app: &AppHandle) {
    let plugin = app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let event = match shortcut.key {
                        Code::KeyV => "clipboard://toggle",
                        Code::KeyC => "capture://toggle",
                        _ => "bar://toggle",
                    };
                    let _ = app.emit(event, ());
                }
            })
            .build(),
    );
    if plugin.is_err() {
        return;
    }
    // The plugin reports every refusal as text, so any refusal moves on: that combination isn't Sumi's to take.
    let free = |list: &'static [(&'static str, Modifiers, Code)]| {
        list.iter().find(|(_, modifiers, key)| {
            app.global_shortcut()
                .register(Shortcut::new(Some(*modifiers), *key))
                .is_ok()
        })
    };
    if let Some((label, ..)) = free(&SHORTCUTS) {
        let _ = app.state::<Bar>().shortcut.set(label);
    }
    free(&CLIPBOARD);
    free(&CAPTURE);
}

/// The shortcut that opens the bar, as `Win+Alt+S`, or nothing.
#[tauri::command]
pub fn bar_shortcut(bar: State<'_, Bar>) -> Option<&'static str> {
    bar.shortcut.get().copied()
}

/// Takes focus as the bar opens, and gives it back as it closes.
#[tauri::command]
pub fn bar_focus(window: WebviewWindow, open: bool) {
    if open {
        take(&window);
    } else {
        give_back(&window);
    }
}

/// Remembers the window in front and comes in front of it. The shortcut was the last input, so Windows allows it;
/// Tauri has its own way around it otherwise. The screen capture takes it the same way, for its keys.
pub fn take(window: &WebviewWindow) {
    let bar = window.state::<Bar>();
    let front = foreground();
    if Some(front) != own(window) {
        bar.previous.store(front, Ordering::Relaxed);
    }
    if !bar.focusable.swap(true, Ordering::Relaxed) {
        let _ = window.set_focusable(true);
    }
    let _ = window.set_focus();
}

/// Stops taking focus, and lets whatever opens next come to the front, even an app that was already running.
pub fn let_go(window: &WebviewWindow) {
    if window
        .state::<Bar>()
        .focusable
        .swap(false, Ordering::Relaxed)
    {
        let _ = window.set_focusable(false);
    }
    allow_any_to_the_front();
}

/// Stops taking focus, and brings back the window that had it, unless the user already went somewhere else. Returns
/// the window brought back, or 0.
pub fn give_back(window: &WebviewWindow) -> usize {
    if window
        .state::<Bar>()
        .focusable
        .swap(false, Ordering::Relaxed)
    {
        let _ = window.set_focusable(false);
    }
    let previous = window.state::<Bar>().previous.swap(0, Ordering::Relaxed);
    if previous != 0 && own(window) == Some(foreground()) {
        bring_forward(previous);
        return previous;
    }
    0
}

/// Whether the bar holds focus, which it does only while open.
pub fn is_open(window: &WebviewWindow) -> bool {
    window.state::<Bar>().focusable.load(Ordering::Relaxed)
}

fn own(window: &WebviewWindow) -> Option<usize> {
    window.hwnd().ok().map(|hwnd| hwnd.0 as usize)
}

#[cfg(windows)]
fn foreground() -> usize {
    // SAFETY: takes no arguments and only reads.
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as usize }
}

#[cfg(not(windows))]
fn foreground() -> usize {
    0
}

#[cfg(windows)]
fn bring_forward(window: usize) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    // SAFETY: IsWindow accepts any value, and a window closed since then is skipped.
    unsafe {
        if IsWindow(window as _) != 0 {
            SetForegroundWindow(window as _);
        }
    }
}

#[cfg(not(windows))]
fn bring_forward(_: usize) {}

#[cfg(windows)]
fn allow_any_to_the_front() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ASFW_ANY, AllowSetForegroundWindow};
    // SAFETY: takes a plain value. It only works while Sumi is in front, which is when it matters.
    unsafe { AllowSetForegroundWindow(ASFW_ANY) };
}

#[cfg(not(windows))]
fn allow_any_to_the_front() {}

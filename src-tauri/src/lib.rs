//! Sumi's Windows side. `island` polls the cursor on a thread of its own and emits island://pointer,
//! island://presence and island://dismiss; `fullscreen` hooks the foreground window on the main thread and only feeds
//! that poll. `media` emits media://players and media://artwork, and `privacy` privacy://state, each from a thread
//! of its own that sleeps until Windows calls back; media's also wakes to read a late artwork again.

mod fullscreen;
mod island;
mod media;
mod privacy;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

pub fn run() {
    // One Sumi at a time: a second copy would draw a second island and a second tray icon. A dev build uses its
    // own name, so it still starts while the installed Sumi runs.
    #[cfg(windows)]
    if already_running(if cfg!(debug_assertions) {
        r"Local\io.github.rateur.sumi.dev"
    } else {
        r"Local\io.github.rateur.sumi"
    }) {
        return;
    }

    // A hang must not draw a frozen "Not responding" copy over the top of the screen.
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::DisableProcessWindowsGhosting();
    }

    tauri::Builder::default()
        // media::watch and privacy::watch manage their own state.
        .manage(island::IslandRects::default())
        .manage(island::IslandExpanded::default())
        .invoke_handler(tauri::generate_handler![
            island::set_island_rects,
            island::set_island_expanded,
            media::media_control,
            media::media_seek,
            media::media_players,
            privacy::privacy_state,
            privacy::privacy_mute,
            privacy::privacy_settings,
            privacy::privacy_show
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // The island has no title bar and no taskbar button: the tray icon is how you quit.
            let quit = MenuItem::with_id(app, "quit", "Quit Sumi", true, None::<&str>)?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Sumi")
                .menu(&Menu::with_items(app, &[&quit])?)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let window = app
                .get_webview_window("island")
                .ok_or("the island window is missing from tauri.conf.json")?;
            island::place(&window)?;
            window.set_ignore_cursor_events(true)?;
            window.show()?;
            // Setup runs on the main thread, whose message loop delivers the hook's events.
            fullscreen::watch_foreground();
            island::follow_cursor(app.handle().clone(), window);
            media::watch(app.handle());
            privacy::watch(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sumi");
}

/// Takes the named mutex `name` for the rest of the process, and says whether another process already holds it.
#[cfg(windows)]
fn already_running(name: &str) -> bool {
    use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, GetLastError};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let name: Vec<u16> = name.encode_utf16().chain([0]).collect();
    // SAFETY: `name` is NUL-terminated and outlives the call; null attributes are allowed. The handle is never
    // closed on purpose: Windows frees the mutex when the process ends, and that is what keeps the guard up.
    // GetLastError is read right after, with no Win32 call in between.
    let error = unsafe {
        CreateMutexW(std::ptr::null(), 0, name.as_ptr());
        GetLastError()
    };
    // Access denied means the mutex exists but another copy (say, run as admin) made it.
    error == ERROR_ALREADY_EXISTS || error == ERROR_ACCESS_DENIED
}

#[cfg(all(test, windows))]
mod tests {
    use super::already_running;

    #[test]
    fn a_second_copy_sees_the_first() {
        let name = format!(r"Local\io.github.rateur.sumi.test.{}", std::process::id());
        assert!(!already_running(&name));
        assert!(already_running(&name));
    }
}

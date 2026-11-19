//! Sumi's Windows side. `island` polls the cursor on a thread of its own and emits island://pointer,
//! island://presence and island://dismiss; `fullscreen` hooks the foreground window on the main thread and only feeds
//! that poll. `media` emits media://players and media://artwork, and `privacy` privacy://state, each from a thread
//! of its own that sleeps until Windows calls back.

mod fullscreen;
mod island;
mod media;
mod privacy;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

pub fn run() {
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

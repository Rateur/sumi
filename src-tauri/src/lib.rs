mod fullscreen;
mod island;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A hang must not draw a frozen "Not responding" copy over the top of the screen.
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::DisableProcessWindowsGhosting();
    }

    tauri::Builder::default()
        .manage(island::IslandRects::default())
        .manage(island::IslandExpanded::default())
        .invoke_handler(tauri::generate_handler![
            island::set_island_rects,
            island::set_island_expanded
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sumi");
}

mod island;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(island::IslandRect::default())
        .invoke_handler(tauri::generate_handler![island::set_island_rect])
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
            island::follow_cursor(app.handle().clone(), window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sumi");
}

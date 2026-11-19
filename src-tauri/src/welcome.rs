//! The first-launch welcome's flag: a file in the app's data folder holding the version that last said hello. A
//! missing file means the welcome is due, which also covers an upgrade from 0.5, which stored nothing. Only the page
//! writes it, once the welcome has shown the shortcut or a click skipped it.

use std::path::Path;

use tauri::{AppHandle, Manager};

const FLAG: &str = "last_version";

/// Whether the welcome is due. A doubt reads as no: a welcome missed beats one replayed at every start.
fn pending(dir: &Path) -> bool {
    dir.join(FLAG).try_exists().is_ok_and(|exists| !exists)
}

fn done(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(FLAG), env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub fn welcome_pending(app: AppHandle) -> bool {
    app.path().app_data_dir().is_ok_and(|dir| pending(&dir))
}

#[tauri::command]
pub fn welcome_done(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    done(&dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_due_until_done() {
        let dir = std::env::temp_dir().join(format!("sumi-welcome-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(pending(&dir));
        done(&dir).expect("the temp folder is writable");
        assert!(!pending(&dir));
        assert_eq!(
            std::fs::read_to_string(dir.join(FLAG)).ok().as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

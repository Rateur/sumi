//! The weather's yes and the city it last found, kept across restarts once the user allows the weather in the command
//! bar. Sealed with DPAPI in the app's local data folder, as the clipboard history is: only this Windows user opens it.
//! The page asks Open-Meteo itself, so nothing here goes on the network. The tray's forget deletes the file, and the
//! next weather asks for the yes again. A no keeps nothing.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{clipboard, tray};

/// The sealed city, whose file holds the yes, in the app's local data folder.
const KEPT: &str = "weather";
/// The next one, written beside it before it takes its place.
const NEXT: &str = "weather.tmp";
/// Longer than any place Open-Meteo names, in bytes.
const NAME_BYTES: usize = 256;

/// A city found by name: what the peek calls it and where it is. Mirrored as `City` in src/lib/weather.ts.
#[derive(Debug, Deserialize, PartialEq, Serialize)]
pub struct City {
    name: String,
    lat: f64,
    lon: f64,
}

impl City {
    /// A name and a place on Earth, as Open-Meteo's geocoding gives them.
    fn fits(&self) -> bool {
        !self.name.trim().is_empty()
            && self.name.len() <= NAME_BYTES
            && (-90.0..=90.0).contains(&self.lat)
            && (-180.0..=180.0).contains(&self.lon)
    }
}

/// What the page reads as it starts. Mirrored as `Kept` in src/lib/weather.ts.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Kept {
    allowed: bool,
    city: Option<City>,
}

impl Kept {
    /// The kept yes and city, or nothing when the file is missing or no longer opens: another user's, or a damaged
    /// one. The yes is then asked again.
    fn load(dir: &Path) -> Self {
        std::fs::read(dir.join(KEPT))
            .ok()
            .and_then(|sealed| clipboard::unprotect(&sealed))
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .map(|city| Kept {
                allowed: true,
                city,
            })
            .unwrap_or_default()
    }
}

/// Keeps the yes, with `city` if one was found.
fn save(dir: &Path, city: Option<&City>) -> std::io::Result<()> {
    let sealed = serde_json::to_vec(&city)
        .ok()
        .and_then(|plain| clipboard::protect(&plain))
        .ok_or_else(|| std::io::Error::other("DPAPI refused"))?;
    clipboard::replace(dir, KEPT, NEXT, &sealed)
}

/// A new city, kept only while the yes is: one the page found after the tray's forget stays unkept.
fn found(dir: &Path, city: &City) -> std::io::Result<()> {
    if !dir.join(KEPT).exists() {
        return Ok(());
    }
    save(dir, Some(city))
}

/// Deletes the kept yes, and the next one a crash or a refused rename left beside it.
fn delete(dir: &Path) {
    for name in [KEPT, NEXT] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// The yes and the city kept from an earlier start.
#[tauri::command]
pub fn weather_kept(app: AppHandle) -> Kept {
    app.path()
        .app_local_data_dir()
        .map(|dir| Kept::load(&dir))
        .unwrap_or_default()
}

/// The yes, given in the bar, kept until the tray's forget with the city found so far.
#[tauri::command]
pub fn weather_allow(app: AppHandle, city: Option<City>) -> Result<(), String> {
    let city = city.filter(City::fits);
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    save(&dir, city.as_ref()).map_err(|e| e.to_string())?;
    menu(&app);
    Ok(())
}

/// The city the page found after the yes, in place of the kept one. Not async, so on the main thread and in order
/// with the tray's forget.
#[tauri::command]
pub fn weather_city(app: AppHandle, city: City) -> Result<(), String> {
    if !city.fits() {
        return Err("not a city".into());
    }
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    found(&dir, &city).map_err(|e| e.to_string())
}

/// The tray's forget: the file goes, and the page forgets the yes and the city it holds.
pub fn forget(app: &AppHandle) {
    if let Ok(dir) = app.path().app_local_data_dir() {
        delete(&dir);
    }
    let _ = app.emit("weather://forget", ());
    menu(app);
}

/// The tray offers the forget while a yes is kept. Called on the main thread: setup, a command, the menu.
pub fn menu(app: &AppHandle) {
    let kept = app
        .path()
        .app_local_data_dir()
        .is_ok_and(|dir| dir.join(KEPT).exists());
    tray::weather(app, kept);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lyon() -> City {
        City {
            name: "Lyon".into(),
            lat: 45.74846,
            lon: 4.84671,
        }
    }

    fn folder(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sumi-weather-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn takes_only_a_city_on_earth() {
        assert!(lyon().fits());
        let long = "a".repeat(NAME_BYTES + 1);
        for (name, lat, lon) in [
            (" ", 45.7, 4.8),
            (long.as_str(), 45.7, 4.8),
            ("Lyon", 91.0, 4.8),
            ("Lyon", 45.7, -180.5),
            ("Lyon", f64::NAN, 4.8),
        ] {
            let city = City {
                name: name.into(),
                lat,
                lon,
            };
            assert!(!city.fits(), "{city:?}");
        }
    }

    #[test]
    fn speaks_the_page_shape() {
        let city: City = serde_json::from_str(r#"{"name":"Lyon","lat":45.74846,"lon":4.84671}"#)
            .expect("the page's shape");
        assert_eq!(city, lyon());
        let kept = Kept {
            allowed: true,
            city: Some(lyon()),
        };
        assert_eq!(
            serde_json::to_string(&kept).ok().as_deref(),
            Some(r#"{"allowed":true,"city":{"name":"Lyon","lat":45.74846,"lon":4.84671}}"#)
        );
    }

    #[test]
    fn a_missing_or_damaged_file_keeps_nothing() {
        let dir = folder("damaged");
        assert_eq!(Kept::load(&dir), Kept::default());
        std::fs::create_dir_all(&dir).expect("the temp folder is writable");
        std::fs::write(dir.join(KEPT), b"not sealed").expect("the temp folder is writable");
        assert_eq!(Kept::load(&dir), Kept::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn keeps_the_yes_and_the_city_across_a_restart() {
        let dir = folder("kept");
        save(&dir, None).expect("the temp folder is writable");
        assert_eq!(
            Kept::load(&dir),
            Kept {
                allowed: true,
                city: None
            }
        );
        found(&dir, &lyon()).expect("the temp folder is writable");
        assert_eq!(
            Kept::load(&dir),
            Kept {
                allowed: true,
                city: Some(lyon())
            }
        );
        assert!(!dir.join(NEXT).exists());
        // Sealed: the city's name isn't in the file.
        let sealed = std::fs::read(dir.join(KEPT)).expect("the file is there");
        assert!(!sealed.windows(4).any(|w| w == b"Lyon"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn forgetting_leaves_nothing_and_keeps_no_later_city() {
        let dir = folder("forget");
        save(&dir, Some(&lyon())).expect("the temp folder is writable");
        // A save cut short before its rename.
        std::fs::copy(dir.join(KEPT), dir.join(NEXT)).expect("the temp folder is writable");
        delete(&dir);
        assert!(!dir.join(KEPT).exists());
        assert!(!dir.join(NEXT).exists());
        found(&dir, &lyon()).expect("nothing to write");
        assert!(!dir.join(KEPT).exists());
        assert_eq!(Kept::load(&dir), Kept::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

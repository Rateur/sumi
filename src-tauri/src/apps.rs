//! Start's apps for the command bar, and the hand-off of a question to an assistant. The list takes about 400 ms to
//! read, so it is read at startup on a thread of its own, kept in memory only, and read again in the background when
//! the bar opens if it is more than 10 minutes old. Only an app from that list can be launched, and an assistant's
//! link is built here from a fixed table: the page never passes a path or a URL.

use std::collections::HashMap;
use std::fmt::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::bar;
use crate::privacy::Icon;

/// How old the list may get before the bar opening reads it again, so an app installed since shows up.
const STALE: Duration = Duration::from_secs(10 * 60);
/// Claude's own limit for a prefilled question.
const LONGEST: usize = 14_000;

/// An entry of Start's list: the name Start shows, and the id Windows opens it by. Mirrored in src/Island.svelte.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct App {
    pub name: String,
    pub id: String,
}

#[derive(Default)]
pub struct Apps {
    list: Mutex<Vec<App>>,
    /// When the list was last read. `None` until the first read ends.
    read_at: Mutex<Option<Instant>>,
    reading: AtomicBool,
    /// Whether Windows knows the `claude:` link, read with the list.
    claude: AtomicBool,
    icons: Mutex<HashMap<String, Option<Icon>>>,
}

impl Apps {
    fn knows(&self, id: &str) -> bool {
        self.list
            .lock()
            .is_ok_and(|list| list.iter().any(|app| app.id == id))
    }
}

/// Where a question goes. Mirrored in src/lib/intent.ts (`Target`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Claude,
    Chatgpt,
    Gemini,
    Perplexity,
    Search,
}

/// The link a question opens, from a fixed table so a link that breaks is fixed in a patch release. Only Claude has
/// a documented app link, used when Windows knows its scheme; the others open their website, prefilled and never sent.
pub fn link(target: Target, query: &str, claude_app: bool) -> String {
    let base = match target {
        Target::Claude if claude_app => "claude://claude.ai/new?q=",
        Target::Claude => "https://claude.ai/new?q=",
        Target::Chatgpt => "https://chatgpt.com/?q=",
        // Community-observed, may break.
        Target::Gemini => "https://gemini.google.com/app?q=",
        Target::Perplexity => "https://www.perplexity.ai/search?q=",
        Target::Search => "https://www.google.com/search?q=",
    };
    let query: String = query.chars().take(LONGEST).collect();
    base.to_owned() + &encode(&query)
}

/// Percent-encodes every byte but the unreserved ones, as `encodeURIComponent` does, so a question can neither add
/// a parameter nor leave the link.
pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// Whether an entry of Start's list is an app, rather than an uninstaller, a manual or a link to a website.
pub fn is_app(name: &str, id: &str) -> bool {
    let (name, id) = (name.to_lowercase(), id.to_lowercase());
    let file = id.rsplit(['\\', '/']).next().unwrap_or(&id);
    let document = [
        ".url", ".txt", ".chm", ".pdf", ".html", ".htm", ".rtf", ".md",
    ]
    .iter()
    .any(|ext| id.ends_with(ext));
    let website = id.contains("://");
    let uninstaller = file.starts_with("unins")
        || ["uninstall", "désinstall", "desinstall"]
            .iter()
            .any(|word| name.starts_with(word));
    let manual = ["documentation", "readme", "release notes"]
        .iter()
        .any(|word| name.contains(word));
    !(document || website || uninstaller || manual)
}

/// Reads the list at startup.
pub fn watch(app: &AppHandle) {
    read(app.clone());
}

/// Reads the list and Claude's link on a thread of its own, unless a read is already running. The thread ends with it.
fn read(app: AppHandle) {
    if app.state::<Apps>().reading.swap(true, Ordering::Relaxed) {
        return;
    }
    std::thread::spawn(move || {
        let apps = app.state::<Apps>();
        if let (Some(list), Ok(mut current)) = (os::list(), apps.list.lock()) {
            *current = list
                .into_iter()
                .filter(|app| is_app(&app.name, &app.id))
                .collect();
        }
        apps.claude.store(os::has_claude(), Ordering::Relaxed);
        // Set even when the read failed, so a failing one is tried again in 10 minutes, not on every opening.
        if let Ok(mut at) = apps.read_at.lock() {
            *at = Some(Instant::now());
        }
        apps.reading.store(false, Ordering::Relaxed);
    });
}

/// Start's apps, for the bar that just opened. A list more than 10 minutes old is read again for the next opening.
#[tauri::command]
pub fn apps_list(app: AppHandle, apps: State<'_, Apps>) -> Vec<App> {
    if apps
        .read_at
        .lock()
        .is_ok_and(|at| at.is_some_and(|at| at.elapsed() > STALE))
    {
        read(app);
    }
    apps.list
        .lock()
        .map(|list| list.clone())
        .unwrap_or_default()
}

/// Whether a question for Claude opens in its app.
#[tauri::command]
pub fn has_claude(apps: State<'_, Apps>) -> bool {
    apps.claude.load(Ordering::Relaxed)
}

/// An app's icon, read once and kept by id. The page shows a monogram until it arrives.
#[tauri::command]
pub async fn app_icon(app: AppHandle, id: String) -> Option<Icon> {
    let apps = app.state::<Apps>();
    if !apps.knows(&id) {
        return None;
    }
    if let Some(icon) = apps.icons.lock().ok()?.get(&id) {
        return icon.clone();
    }
    let read = {
        let id = id.clone();
        tauri::async_runtime::spawn_blocking(move || os::icon(&id))
            .await
            .ok()
            .flatten()
    };
    apps.icons.lock().ok()?.insert(id, read.clone());
    read
}

/// Opens an app from Start's list, and only one from it.
#[tauri::command]
pub async fn app_launch(window: WebviewWindow, id: String) -> bool {
    if !window.state::<Apps>().knows(&id) {
        return false;
    }
    hand_off(&window, format!("shell:AppsFolder\\{id}")).await
}

/// Opens a question in an assistant or the search engine: Claude's app when Windows knows its link, else the browser.
#[tauri::command]
pub async fn assistant_open(window: WebviewWindow, target: Target, query: String) -> bool {
    let claude_app = window.state::<Apps>().claude.load(Ordering::Relaxed);
    hand_off(&window, link(target, &query, claude_app)).await
}

/// Lets what opens come to the front, opens it off the main thread since an app can take seconds to start, and
/// gives focus back to where it was if nothing opened.
async fn hand_off(window: &WebviewWindow, target: String) -> bool {
    bar::let_go(window);
    let opened = tauri::async_runtime::spawn_blocking(move || os::open(&target))
        .await
        .unwrap_or(false);
    if !opened {
        bar::give_back(window);
    }
    opened
}

#[cfg(windows)]
mod os {
    use super::App;
    use crate::privacy::Icon;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::System::Com::{
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        ASSOCF_IS_PROTOCOL, ASSOCSTR_FRIENDLYAPPNAME, AssocQueryStringW, BHID_EnumItems,
        FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItemImageFactory, KF_FLAG_DEFAULT,
        SHCreateItemFromParsingName, SHGetKnownFolderItem, SIGDN, SIGDN_DESKTOPABSOLUTEPARSING,
        SIGDN_NORMALDISPLAY, SIIGBF_ICONONLY,
    };
    use windows::core::{PCWSTR, PWSTR, w};

    /// Twice the 16 px slot, for screens at 200 %.
    const SIDE: i32 = 32;

    /// Runs `f` with COM set up on this thread, as the Shell's objects and ShellExecute need.
    fn with_com<T>(f: impl FnOnce() -> T) -> T {
        // SAFETY: balanced by CoUninitialize below on this same thread. A thread already set up in another mode
        // fails here and is left as it is.
        let init =
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }
                .is_ok();
        let out = f();
        if init {
            // SAFETY: matches the successful CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
        out
    }

    fn name(item: &IShellItem, kind: SIGDN) -> Option<String> {
        // SAFETY: GetDisplayName hands over a string Sumi owns: it is copied, then freed once.
        unsafe {
            let raw = item.GetDisplayName(kind).ok()?;
            let text = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as _));
            text
        }
    }

    /// Start's own list, the one its "All apps" shows, with the names it shows.
    pub fn list() -> Option<Vec<App>> {
        with_com(|| {
            // SAFETY: COM is set up on this thread, and every object stays on it.
            unsafe {
                let folder: IShellItem =
                    SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None).ok()?;
                let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems).ok()?;
                let mut list = Vec::new();
                loop {
                    let mut one = [None];
                    let mut fetched = 0;
                    // S_FALSE with nothing fetched marks the end.
                    if items.Next(&mut one, Some(&mut fetched)).is_err() || fetched == 0 {
                        break;
                    }
                    let Some(item) = one[0].take() else { break };
                    if let (Some(name), Some(id)) = (
                        name(&item, SIGDN_NORMALDISPLAY),
                        name(&item, SIGDN_DESKTOPABSOLUTEPARSING),
                    ) {
                        list.push(App { name, id });
                    }
                }
                Some(list)
            }
        })
    }

    /// Whether Windows knows the `claude:` link. The exe lookup fails for a Store app's link, its name doesn't.
    pub fn has_claude() -> bool {
        let mut out = [0u16; 260];
        let mut len = out.len() as u32;
        // SAFETY: `out` holds `len` characters and outlives the call.
        unsafe {
            AssocQueryStringW(
                ASSOCF_IS_PROTOCOL,
                ASSOCSTR_FRIENDLYAPPNAME,
                w!("claude"),
                PCWSTR::null(),
                Some(PWSTR(out.as_mut_ptr())),
                &mut len,
            )
        }
        .is_ok()
    }

    /// Opens an app or a link the way Start does. Windows shows no error box: the island says it couldn't.
    pub fn open(target: &str) -> bool {
        use windows_sys::Win32::UI::Shell::{
            SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, ShellExecuteExW,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let file: Vec<u16> = target.encode_utf16().chain([0]).collect();
        with_com(|| {
            // SAFETY: the info is zeroed but for its size, its flags and a NUL-terminated file that outlives the call.
            unsafe {
                let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
                info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
                info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;
                info.lpFile = file.as_ptr();
                info.nShow = SW_SHOWNORMAL;
                ShellExecuteExW(&mut info) != 0
            }
        })
    }

    /// The app's icon as Start draws it, read as 32-bit pixels.
    pub fn icon(id: &str) -> Option<Icon> {
        use windows_sys::Win32::Graphics::Gdi::DeleteObject;

        let path: Vec<u16> = format!("shell:AppsFolder\\{id}")
            .encode_utf16()
            .chain([0])
            .collect();
        with_com(|| {
            // SAFETY: COM is set up on this thread, `path` is NUL-terminated, and the bitmap is deleted once read.
            unsafe {
                let factory: IShellItemImageFactory =
                    SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None).ok()?;
                let bitmap = factory
                    .GetImage(SIZE { cx: SIDE, cy: SIDE }, SIIGBF_ICONONLY)
                    .ok()?;
                let icon = pixels(bitmap.0);
                DeleteObject(bitmap.0);
                icon
            }
        })
    }

    /// A square bitmap's pixels, top row first, as straight RGBA. One without any alpha is opaque.
    fn pixels(bitmap: *mut std::ffi::c_void) -> Option<Icon> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        use windows_sys::Win32::Graphics::Gdi::{
            BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
            GetDIBits,
        };

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or(0);
        // SAFETY: `bitmap` is a live bitmap, the DC is deleted before returning, and `pixels` holds the rows read.
        let (read, side, mut pixels) = unsafe {
            let dc = CreateCompatibleDC(std::ptr::null_mut());
            // A first call with no buffer fills in the bitmap's size.
            let sized = GetDIBits(
                dc,
                bitmap,
                0,
                0,
                std::ptr::null_mut(),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            let width = bmi.bmiHeader.biWidth;
            if sized == 0 || width <= 0 || width > 256 || bmi.bmiHeader.biHeight.abs() != width {
                DeleteDC(dc);
                return None;
            }
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;
            bmi.bmiHeader.biHeight = -width;
            let side = width.unsigned_abs();
            let mut pixels = vec![0u8; (side * side * 4) as usize];
            let read = GetDIBits(
                dc,
                bitmap,
                0,
                side,
                pixels.as_mut_ptr().cast(),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            DeleteDC(dc);
            (read, side, pixels)
        };
        if read != side as i32 {
            return None;
        }
        let opaque = pixels.chunks(4).all(|p| p[3] == 0);
        for pixel in pixels.chunks_mut(4) {
            pixel.swap(0, 2);
            if opaque {
                pixel[3] = 255;
            }
        }
        Some(Icon {
            side,
            rgba: STANDARD.encode(&pixels),
        })
    }
}

#[cfg(not(windows))]
mod os {
    use super::App;
    use crate::privacy::Icon;

    pub fn list() -> Option<Vec<App>> {
        None
    }

    pub fn has_claude() -> bool {
        false
    }

    pub fn open(_: &str) -> bool {
        false
    }

    pub fn icon(_: &str) -> Option<Icon> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_encode_uri_component_but_stricter() {
        assert_eq!(encode("Quoi ?"), "Quoi%20%3F");
        assert_eq!(encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(encode("é"), "%C3%A9");
        assert_eq!(encode("a&q=b#c/d"), "a%26q%3Db%23c%2Fd");
    }

    #[test]
    fn claude_opens_in_its_app_only_when_windows_knows_the_link() {
        assert_eq!(
            link(Target::Claude, "qui a écrit Candide", true),
            "claude://claude.ai/new?q=qui%20a%20%C3%A9crit%20Candide"
        );
        assert_eq!(
            link(Target::Claude, "hi", false),
            "https://claude.ai/new?q=hi"
        );
    }

    #[test]
    fn every_other_target_opens_its_website() {
        for (target, url) in [
            (Target::Chatgpt, "https://chatgpt.com/?q=hello"),
            (Target::Gemini, "https://gemini.google.com/app?q=hello"),
            (
                Target::Perplexity,
                "https://www.perplexity.ai/search?q=hello",
            ),
            (Target::Search, "https://www.google.com/search?q=hello"),
        ] {
            assert_eq!(link(target, "hello", true), url);
        }
    }

    #[test]
    fn a_long_question_is_cut_at_14000_characters() {
        let url = link(Target::Claude, &"a".repeat(20_000), true);
        assert_eq!(url.len(), "claude://claude.ai/new?q=".len() + 14_000);
        // Characters, not bytes: an accent is never cut in half.
        let url = link(Target::Search, &"é".repeat(14_001), false);
        assert!(url.ends_with("%C3%A9"));
        assert_eq!(url.matches("%C3%A9").count(), 14_000);
    }

    #[test]
    fn the_target_comes_from_its_lowercase_name() {
        let parse = |name: &str| serde_json::from_str::<Target>(&format!("\"{name}\"")).ok();
        assert_eq!(parse("chatgpt"), Some(Target::Chatgpt));
        assert_eq!(parse("search"), Some(Target::Search));
        assert_eq!(parse("https://example.com"), None);
    }

    #[test]
    fn apps_stay() {
        assert!(is_app("Discord", "com.squirrel.Discord.Discord"));
        assert!(is_app(
            "Calculatrice",
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        ));
        assert!(is_app(
            "Display Driver Uninstaller",
            r"{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\Display Driver Uninstaller\Display Driver Uninstaller.exe"
        ));
    }

    #[test]
    fn uninstallers_go() {
        assert!(!is_app(
            "Uninstall",
            r"C:\Users\x\AppData\Local\DBeaver\Uninstall.exe"
        ));
        assert!(!is_app(
            "Uninstall Node.js",
            "Microsoft.AutoGenerated.{FB2B63A0-57F0-C0DE-03DD-1ADF0AC5B075}"
        ));
        assert!(!is_app("Désinstaller Foo", r"C:\Foo\unins000.exe"));
    }

    #[test]
    fn manuals_and_websites_go() {
        assert!(!is_app("Support", "http://forum.pj64-emu.com"));
        assert!(!is_app("Node.js website", "https://nodejs.org/"));
        assert!(!is_app(
            "Documentation",
            r"{6D809377-6AF0-444B-8957-A3773F02200E}\VideoLAN\VLC\Documentation.url"
        ));
        assert!(!is_app(
            "HWiNFO Manual",
            r"{6D809377-6AF0-444B-8957-A3773F02200E}\HWiNFO64\HWiNFO Manual.pdf"
        ));
        assert!(!is_app(
            "Python 3.13 Manuals (64-bit)",
            r"C:\Python313\Doc\html\index.html"
        ));
        assert!(!is_app(
            "Release Notes",
            r"{6D809377-6AF0-444B-8957-A3773F02200E}\VideoLAN\VLC\NEWS.txt"
        ));
    }
}

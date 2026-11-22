//! The clipboard history: the text you copy, newest first, once you allow it in the command bar. It is kept on this
//! PC across restarts, sealed with Windows' per-user encryption (DPAPI) in the app's local data folder, which a
//! roaming profile doesn't copy to a server. A message-only window hears each copy while the history is on, and
//! sleeps otherwise. Enter on an item pastes it into the window the bar came from, or a form of it the list offers:
//! a colour in another format, a link without its trackers. Tab's other actions open an item's link, write to its
//! address or show its file in File Explorer, once Rust has read the text again: the page never says what to open,
//! and no file is ever run. A copy never wakes the island, and nothing here goes on the network.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{apps, bar, tray};

/// DPAPI's seal and open for this Windows user, which the weather's yes uses too.
pub use os::{protect, unprotect};

/// The oldest items drop off past this many.
const ITEMS: usize = 100;
/// A copy past this size isn't kept, rather than cut, since a cut paste would be wrong. A long page or a source file
/// fits; a log or a table export doesn't, and the whole history is sealed and written again at each copy.
const ITEM_BYTES: usize = 64 * 1024;
/// The sealed history, and the flag that holds the yes, in the app's local data folder.
const KEPT: &str = "clipboard_history";
/// The next history, written beside the kept one before it takes its place.
const NEXT: &str = "clipboard_history.tmp";
const ALLOWED: &str = "clipboard_allowed";

/// Newest first, each text once.
#[derive(Debug, Default, PartialEq)]
struct History(Vec<String>);

/// Whether a copy can go in the history: some text, and not too big.
fn keeps(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= ITEM_BYTES
}

impl History {
    /// Puts `text` on top, moving it there if it was already in. False when nothing changed.
    fn add(&mut self, text: String) -> bool {
        if !keeps(&text) || self.0.first() == Some(&text) {
            return false;
        }
        self.0.retain(|kept| *kept != text);
        self.0.insert(0, text);
        self.0.truncate(ITEMS);
        true
    }

    fn seal(&self) -> Option<Vec<u8>> {
        os::protect(&serde_json::to_vec(&self.0).ok()?)
    }

    /// A sealed history, or an empty one when it no longer opens: another user's, or a damaged file. Read through
    /// `add`, so it keeps the limits.
    fn unseal(sealed: &[u8]) -> Self {
        let items: Vec<String> = os::unprotect(sealed)
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .unwrap_or_default();
        let mut history = History::default();
        for item in items.into_iter().rev() {
            history.add(item);
        }
        history
    }

    fn load(dir: &Path) -> Self {
        std::fs::read(dir.join(KEPT))
            .map(|sealed| Self::unseal(&sealed))
            .unwrap_or_default()
    }

    fn save(&self, dir: &Path) -> std::io::Result<()> {
        let sealed = self
            .seal()
            .ok_or_else(|| std::io::Error::other("DPAPI refused"))?;
        replace(dir, KEPT, NEXT, &sealed)
    }

    /// Deletes the kept history, and the next one a crash or a refused rename left beside it.
    fn forget(dir: &Path) {
        for name in [KEPT, NEXT] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
}

/// Writes `bytes` to `next` beside `name`, on the disk and not just in Windows' cache, then over `name`, so neither a
/// crash nor a power cut leaves half a file. The weather's yes is kept the same way.
pub fn replace(dir: &Path, name: &str, next: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let next = dir.join(next);
    std::fs::File::create(&next).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    })?;
    std::fs::rename(next, dir.join(name))
}

/// What the app that copied says about it, through the clipboard formats Windows' own history reads.
#[derive(Default)]
struct Marks {
    /// `ExcludeClipboardContentFromMonitorProcessing`: keep it from every clipboard monitor.
    exclude: bool,
    /// `Clipboard Viewer Ignore`, which password managers set.
    ignore: bool,
    /// `CanIncludeInClipboardHistory`: 0 keeps it out.
    history: Option<u32>,
}

impl Marks {
    fn private(&self) -> bool {
        self.exclude || self.ignore || self.history == Some(0)
    }
}

#[derive(Default)]
pub struct Clipboard {
    history: Mutex<History>,
    /// Allowed, and not paused from the tray.
    on: AtomicBool,
    /// The message-only window that hears copies and owns what Sumi writes.
    window: AtomicUsize,
    /// The clipboard's sequence number while it holds the top item as it was copied, so Enter on that item pastes
    /// it with its formatting.
    top: AtomicU32,
}

/// Where Enter on an item left it. Mirrored as `Landed` in src/lib/clipboard.ts.
#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Landed {
    Pasted,
    /// On the clipboard, but Windows wouldn't take Sumi's keys to that window: an app run as administrator.
    Copied,
    Failed,
}

/// Reads the kept history if it was allowed, then hears copies on a thread of its own.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<Clipboard>();
        if let Ok(dir) = app.path().app_local_data_dir()
            && dir.join(ALLOWED).exists()
        {
            if let Ok(mut history) = state.history.lock() {
                *history = History::load(&dir);
            }
            state.on.store(true, Ordering::SeqCst);
        }
        menu(&app);
        os::listen(&app);
    });
}

/// A copy: kept unless the history is off, Sumi wrote it, or the app that copied it marked it private.
fn copied(app: &AppHandle) {
    let state = app.state::<Clipboard>();
    let window = state.window.load(Ordering::SeqCst);
    // Sumi's own write: the paste already put that item on top.
    if !state.on.load(Ordering::SeqCst) || os::owner() == window {
        return;
    }
    let sequence = os::sequence();
    let text = os::read(window).filter(|text| keeps(text));
    let Ok(mut history) = state.history.lock() else {
        return;
    };
    // Paused while the clipboard was read: the pause stores `on` before it takes the lock, and the kept file stays.
    if !state.on.load(Ordering::SeqCst) {
        return;
    }
    let Some(text) = text else {
        state.top.store(0, Ordering::SeqCst);
        return;
    };
    if history.add(text)
        && let Ok(dir) = app.path().app_local_data_dir()
    {
        let _ = history.save(&dir);
    }
    state.top.store(sequence, Ordering::SeqCst);
}

/// The history, newest first, or nothing before the yes: the bar asks for it then.
#[tauri::command]
pub fn clipboard_history(state: State<'_, Clipboard>) -> Option<Vec<String>> {
    if !state.on.load(Ordering::SeqCst) {
        return None;
    }
    Some(
        state
            .history
            .lock()
            .map(|h| h.0.clone())
            .unwrap_or_default(),
    )
}

/// The yes, given in the bar, kept until the tray's pause. A history kept through a pause comes back, and what the
/// clipboard holds now goes on top, since nothing was heard before.
#[tauri::command]
pub async fn clipboard_allow(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(ALLOWED), "").map_err(|e| e.to_string())?;
    let state = app.state::<Clipboard>();
    if let Ok(mut history) = state.history.lock() {
        *history = History::load(&dir);
    }
    state.on.store(true, Ordering::SeqCst);
    os::listening(state.window.load(Ordering::SeqCst), true);
    copied(&app);
    menu(&app);
    Ok(state
        .history
        .lock()
        .map(|h| h.0.clone())
        .unwrap_or_default())
}

/// Enter on an item: it moves to the top and goes on the clipboard, then into the window the bar came from. `plain`
/// writes the text alone, even over the top item's own formatting. `form` lands in its place, as plain text: the
/// colour in another format, or the link without its trackers.
#[tauri::command]
pub async fn clipboard_paste(
    window: WebviewWindow,
    text: String,
    plain: bool,
    form: Option<String>,
) -> Landed {
    tauri::async_runtime::spawn_blocking(move || paste(&window, text, plain, form))
        .await
        .unwrap_or(Landed::Failed)
}

fn paste(window: &WebviewWindow, text: String, plain: bool, form: Option<String>) -> Landed {
    let state = window.state::<Clipboard>();
    let written = state.history.lock().is_ok_and(|mut history| {
        // Only what the history holds, or a form of it: the page can't put anything else on the clipboard.
        if !history.0.contains(&text) || form.as_ref().is_some_and(|form| !offers(&text, form)) {
            return false;
        }
        let fresh = !plain
            && form.is_none()
            && history.0.first() == Some(&text)
            && os::sequence() == state.top.load(Ordering::SeqCst);
        if !fresh {
            let pasted = form.as_deref().unwrap_or(&text);
            if !os::write(state.window.load(Ordering::SeqCst), pasted) {
                return false;
            }
            // A form isn't the item as it was copied: Enter on the item writes it again.
            let top = if form.is_none() { os::sequence() } else { 0 };
            state.top.store(top, Ordering::SeqCst);
        }
        if history.add(text)
            && let Ok(dir) = window.app_handle().path().app_local_data_dir()
        {
            let _ = history.save(&dir);
        }
        true
    });
    let target = bar::give_back(window);
    if !written {
        return Landed::Failed;
    }
    os::paste(target)
}

/// The items that name a file or a folder on this PC, which Tab offers to show in File Explorer. Looked up off the
/// main thread: a sleeping disk may take seconds to answer.
#[tauri::command]
pub async fn clipboard_paths(app: AppHandle) -> Vec<String> {
    let items = app
        .state::<Clipboard>()
        .history
        .lock()
        .map(|h| h.0.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        items
            .into_iter()
            .filter(|item| path(item).is_some_and(on_this_pc))
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Tab's open on an item: its link in the browser, a new message to its address, or its file selected in File
/// Explorer. Only an item the history holds, and only what its text says it is.
#[tauri::command]
pub async fn clipboard_open(window: WebviewWindow, text: String) -> bool {
    let held = window
        .state::<Clipboard>()
        .history
        .lock()
        .is_ok_and(|h| h.0.contains(&text));
    let opening = if held {
        tauri::async_runtime::spawn_blocking(move || opening(&text))
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    match opening {
        Some(Opening::Link(target) | Opening::Mail(target)) => {
            apps::open_checked(&window, target).await
        }
        Some(Opening::Folder(path)) => apps::reveal(&window, path).await,
        None => {
            bar::give_back(&window);
            false
        }
    }
}

/// What opening an item means, read from its text alone.
#[derive(Debug, PartialEq)]
enum Opening {
    /// A web page, in the default browser.
    Link(String),
    /// A `mailto:` with the address alone, in the default mail app.
    Mail(String),
    /// A file or a folder on this PC, selected in the folder that holds it.
    Folder(String),
}

fn opening(text: &str) -> Option<Opening> {
    let text = text.trim();
    if let Some(link) = link(text) {
        return Some(Opening::Link(link));
    }
    if address(text) {
        return Some(Opening::Mail(format!("mailto:{text}")));
    }
    path(text)
        .filter(|path| on_this_pc(path))
        // The Shell finds a path only in its usual form: `C:\a`, not `C:/a`, `C:\\a` or `C:\b\..\a`.
        .and_then(|path| {
            std::path::absolute(path)
                .ok()?
                .into_os_string()
                .into_string()
                .ok()
        })
        .map(Opening::Folder)
}

/// An http or https link with a host, and no space or control character, as the page reads one (`isLink` in
/// src/lib/clipboard.ts). A `"` is encoded, so it can't end the argument Windows hands the browser.
fn link(text: &str) -> Option<String> {
    let rest = ["https://", "http://"].iter().find_map(|scheme| {
        text.get(..scheme.len())
            .filter(|start| start.eq_ignore_ascii_case(scheme))
            .map(|_| &text[scheme.len()..])
    })?;
    let host = !rest.is_empty() && !rest.starts_with(['/', '?', '#']);
    let clean = !text.chars().any(|c| c.is_whitespace() || c.is_control());
    (host && clean && text.len() <= apps::LONGEST_LINK).then(|| text.replace('"', "%22"))
}

/// An e-mail address in plain ASCII, as the page reads one (`isMail` in src/lib/clipboard.ts). With no `?`, `&` or
/// `%`, its `mailto:` can't add a subject, a body or an attachment.
fn address(text: &str) -> bool {
    let Some((local, domain)) = text.rsplit_once('@') else {
        return false;
    };
    let word = |part: &str, signs: &[u8]| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || signs.contains(&b))
    };
    let labels: Vec<&str> = domain.split('.').collect();
    text.len() <= 254
        && local.len() <= 64
        && local.split('.').all(|part| word(part, b"_+-"))
        && labels.len() > 1
        && labels.iter().all(|label| {
            label.len() <= 63
                && word(label, b"-")
                && !label.starts_with('-')
                && !label.ends_with('-')
        })
        && labels
            .last()
            .is_some_and(|end| end.len() > 1 && end.bytes().all(|b| b.is_ascii_alphabetic()))
}

/// A path from a drive's root, `C:\…` or `C:/…`, on one line, without the quotes of Explorer's "Copy as path". A
/// network path (`\\server\share`) isn't one.
fn path(text: &str) -> Option<&str> {
    let text = text.trim();
    let path = text
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(text);
    let rooted =
        matches!(path.as_bytes(), [drive, b':', b'\\' | b'/', ..] if drive.is_ascii_alphabetic());
    (rooted && !path.contains('"') && !path.chars().any(char::is_control)).then_some(path)
}

/// Whether a path names a file or a folder on this PC. A mapped network drive is left out before the lookup, so it
/// never reaches another machine.
fn on_this_pc(path: &str) -> bool {
    !os::remote(path) && Path::new(path).exists()
}

/// Whether the list may paste `form` in place of `item`: a colour item's value in another format, or the item's link
/// with some of its parameters taken out.
fn offers(item: &str, form: &str) -> bool {
    let item = item.trim();
    let colour = ["#", "rgb(", "hsl("].iter().any(|start| {
        item.get(..start.len())
            .is_some_and(|s| s.eq_ignore_ascii_case(start))
    });
    (colour && item.len() < 64 && is_colour(form)) || trims(item, form)
}

/// A colour as the list writes it (`formatted` in src/lib/clipboard.ts): `#1E90FF`, `rgb(30, 144, 255)` or
/// `hsl(210, 100%, 56%)`.
fn is_colour(text: &str) -> bool {
    if let Some(hex) = text.strip_prefix('#') {
        return hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let (inner, units) = if let Some(inner) = text.strip_prefix("rgb(") {
        (inner, ["", "", ""])
    } else if let Some(inner) = text.strip_prefix("hsl(") {
        (inner, ["", "%", "%"])
    } else {
        return false;
    };
    let parts: Vec<&str> = inner.strip_suffix(')').unwrap_or("").split(", ").collect();
    parts.len() == 3
        && parts.iter().zip(units).all(|(part, unit)| {
            part.strip_suffix(unit).is_some_and(|n| {
                (1..=3).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit())
            })
        })
}

/// Whether `form` is `item`'s link with some of its query's parameters taken out and the others kept in order, as
/// « Sans traqueurs » pastes it. Cut where the page cuts it (`split` in src/lib/clipboard.ts).
fn trims(item: &str, form: &str) -> bool {
    fn split(url: &str) -> (&str, Option<&str>, Option<&str>) {
        let (rest, hash) = url
            .split_once('#')
            .map_or((url, None), |(rest, hash)| (rest, Some(hash)));
        let (head, query) = rest
            .split_once('?')
            .map_or((rest, None), |(head, query)| (head, Some(query)));
        (head, query, hash)
    }
    let (head, query, hash) = split(item);
    let (kept_head, kept, kept_hash) = split(form);
    let mut params = query.unwrap_or_default().split('&');
    link(item).is_some()
        && head == kept_head
        && hash == kept_hash
        && kept.is_none_or(|kept| {
            !kept.is_empty() && kept.split('&').all(|param| params.any(|p| p == param))
        })
}

/// What the screen capture copied: on the clipboard as Sumi's own write, which the listener skips, so it goes on top
/// of the history here while that is on.
pub fn keep(app: &AppHandle, text: String) -> bool {
    let state = app.state::<Clipboard>();
    if !os::write(state.window.load(Ordering::SeqCst), &text) {
        return false;
    }
    let Ok(mut history) = state.history.lock() else {
        return true;
    };
    if state.on.load(Ordering::SeqCst) {
        if history.add(text)
            && let Ok(dir) = app.path().app_local_data_dir()
        {
            let _ = history.save(&dir);
        }
        state.top.store(os::sequence(), Ordering::SeqCst);
    }
    true
}

/// Keeps the island out of screenshots and screen sharing while the list shows.
#[tauri::command]
pub fn clipboard_hide(window: WebviewWindow, hidden: bool) {
    if let Ok(hwnd) = window.hwnd() {
        os::hide(hwnd.0 as usize, hidden);
    }
}

/// The tray's pause: Sumi stops listening and forgets the yes. The history stays kept, sealed, for the next yes.
pub fn pause(app: &AppHandle) {
    let state = app.state::<Clipboard>();
    state.on.store(false, Ordering::SeqCst);
    os::listening(state.window.load(Ordering::SeqCst), false);
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = std::fs::remove_file(dir.join(ALLOWED));
    }
    if let Ok(mut history) = state.history.lock() {
        *history = History::default();
    }
    menu(app);
}

/// The tray's clear: the history empties and its file goes.
pub fn clear(app: &AppHandle) {
    if let Ok(mut history) = app.state::<Clipboard>().history.lock() {
        *history = History::default();
        if let Ok(dir) = app.path().app_local_data_dir() {
            History::forget(&dir);
        }
    }
    menu(app);
}

/// The tray offers the pause while the history is on, and the clear while one is kept.
fn menu(app: &AppHandle) {
    let on = app.state::<Clipboard>().on.load(Ordering::SeqCst);
    let kept = on
        || app
            .path()
            .app_local_data_dir()
            .is_ok_and(|dir| dir.join(KEPT).exists());
    tray::clipboard(app, on, kept);
}

#[cfg(windows)]
mod os {
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::Foundation::{
        CloseHandle, GlobalFree, HANDLE, HWND, LPARAM, LRESULT, LocalFree, WPARAM,
    };
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation,
    };
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows_sys::Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
        GetClipboardOwner, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW, RemoveClipboardFormatListener, SetClipboardData,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Memory::{
        GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
        VIRTUAL_KEY, VK_CONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_V,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
        GetWindowThreadProcessId, HWND_MESSAGE, KillTimer, MSG, PostMessageW, RegisterClassW,
        SetTimer, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WM_APP,
        WM_CLIPBOARDUPDATE, WM_TIMER, WNDCLASSW,
    };

    use super::{Clipboard, ITEM_BYTES, Landed, Marks};

    /// Posted to the window: `wparam` 1 starts listening to copies, 0 stops.
    const LISTEN: u32 = WM_APP;
    /// The timer that reads a copy once the app that made it is done. Reading at once holds the clipboard while
    /// that app flushes it (OleFlushClipboard), and its copy then fails: 7 times in 8 in a test with .NET apps.
    const SETTLE: usize = 1;
    const SETTLE_MS: u32 = 150;
    /// How long the window the bar came from may take to come back to the front.
    const FRONT: Duration = Duration::from_millis(100);
    static APP: OnceLock<AppHandle> = OnceLock::new();

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    /// Makes the message-only window and runs its messages, for the rest of the process.
    pub fn listen(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let name = wide("SumiClipboard");
        // SAFETY: `name` outlives both calls, and the class's procedure is a plain function.
        let window = unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WNDCLASSW {
                lpfnWndProc: Some(heard),
                hInstance: instance,
                lpszClassName: name.as_ptr(),
                ..Default::default()
            };
            RegisterClassW(&class);
            CreateWindowExW(
                0,
                name.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            )
        };
        if window.is_null() {
            return;
        }
        let state = app.state::<Clipboard>();
        // Stored before `on` is read, so a yes given meanwhile either sees the window or is seen here.
        state
            .window
            .store(window as usize, std::sync::atomic::Ordering::SeqCst);
        if state.on.load(std::sync::atomic::Ordering::SeqCst) {
            unsafe { AddClipboardFormatListener(window) };
        }
        let mut msg = MSG::default();
        // SAFETY: `msg` is this thread's own; the window lives as long as the thread.
        while unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) } > 0 {
            unsafe { DispatchMessageW(&msg) };
        }
    }

    unsafe extern "system" fn heard(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CLIPBOARDUPDATE => {
                // A copy right behind restarts the wait, so a burst is read once, at its end.
                unsafe { SetTimer(hwnd, SETTLE, SETTLE_MS, None) };
                0
            }
            WM_TIMER if wparam == SETTLE => {
                unsafe { KillTimer(hwnd, SETTLE) };
                if let Some(app) = APP.get() {
                    super::copied(app);
                }
                0
            }
            LISTEN => {
                unsafe {
                    if wparam == 0 {
                        RemoveClipboardFormatListener(hwnd);
                    } else {
                        AddClipboardFormatListener(hwnd);
                    }
                }
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    /// Starts or stops hearing copies, on the window's own thread. Before the window exists, `listen` reads `on`.
    pub fn listening(window: usize, on: bool) {
        if window != 0 {
            unsafe { PostMessageW(window as HWND, LISTEN, usize::from(on), 0) };
        }
    }

    pub fn owner() -> usize {
        unsafe { GetClipboardOwner() as usize }
    }

    pub fn sequence() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// Whether `path`, from a drive's root, is on a mapped network drive. Windows answers from the drive letters it
    /// keeps for this session, without asking the server.
    pub fn remote(path: &str) -> bool {
        // In windows-sys's WindowsProgramming, which Sumi doesn't turn on for one value.
        const DRIVE_REMOTE: u32 = 4;
        let root = wide(&format!("{}\\", path.get(..2).unwrap_or_default()));
        unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_REMOTE }
    }

    fn format(name: &str) -> u32 {
        let name = wide(name);
        unsafe { RegisterClipboardFormatW(name.as_ptr()) }
    }

    /// Opens the clipboard as `owner`, three tries 20 ms apart while another app holds it.
    fn open(owner: usize) -> bool {
        for attempt in 0..3 {
            if unsafe { OpenClipboard(owner as HWND) } != 0 {
                return true;
            }
            if attempt < 2 {
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        false
    }

    /// The bytes of a clipboard format, at most `limit`, or nothing when it's missing or larger. Needs the
    /// clipboard open.
    fn data(format: u32, limit: usize) -> Option<Vec<u8>> {
        // SAFETY: GlobalLock gives `size` readable bytes until GlobalUnlock, and the copy reads no further.
        unsafe {
            let handle: HANDLE = GetClipboardData(format);
            if handle.is_null() {
                return None;
            }
            let size = GlobalSize(handle);
            if size > limit {
                return None;
            }
            let ptr = GlobalLock(handle).cast::<u8>();
            if ptr.is_null() {
                return None;
            }
            let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
            GlobalUnlock(handle);
            Some(bytes)
        }
    }

    /// The clipboard's text, unless the app that copied it marked it private or it is too big to keep.
    // shortcut: text only, so copied files and images aren't kept; add them with a preview of their own.
    pub fn read(owner: usize) -> Option<String> {
        if !open(owner) {
            return None;
        }
        // Read with the clipboard open, so the marks and the text belong to the same copy.
        let has = |name: &str| unsafe { IsClipboardFormatAvailable(format(name)) } != 0;
        let marks = Marks {
            exclude: has("ExcludeClipboardContentFromMonitorProcessing"),
            ignore: has("Clipboard Viewer Ignore"),
            history: data(format("CanIncludeInClipboardHistory"), 64)
                .and_then(|b| Some(u32::from_le_bytes(b.get(..4)?.try_into().ok()?))),
        };
        // UTF-16 takes no more units than UTF-8 takes bytes: a larger one is past the cap either way.
        let text = (!marks.private())
            .then(|| data(u32::from(CF_UNICODETEXT), 2 * (ITEM_BYTES + 1)))
            .flatten()
            .map(|bytes| {
                let units: Vec<u16> = bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|pair| u16::from_le_bytes(*pair))
                    .take_while(|&unit| unit != 0)
                    .collect();
                String::from_utf16_lossy(&units)
            });
        unsafe { CloseClipboard() };
        text
    }

    /// Puts `text` alone on the clipboard, owned by `owner`, so its listener knows it for Sumi's. Marked first to
    /// stay off Windows' cloud clipboard, which the app that copied it may have kept it from.
    pub fn write(owner: usize, text: &str) -> bool {
        let units: Vec<u8> = text
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        if !open(owner) {
            return false;
        }
        let written = unsafe { EmptyClipboard() } != 0
            && put(format("CanUploadToCloudClipboard"), &0u32.to_le_bytes())
            && put(u32::from(CF_UNICODETEXT), &units);
        unsafe { CloseClipboard() };
        written
    }

    /// Hands `bytes` to the clipboard as `format`. Needs the clipboard open and emptied.
    fn put(format: u32, bytes: &[u8]) -> bool {
        // SAFETY: the block is allocated for `bytes`, which the copy fills exactly. Once SetClipboardData takes it,
        // the clipboard owns it; until then it is Sumi's to free.
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
            let ptr = GlobalLock(handle).cast::<u8>();
            if ptr.is_null() {
                return false;
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            GlobalUnlock(handle);
            let taken = !SetClipboardData(format, handle).is_null();
            if !taken {
                GlobalFree(handle);
            }
            taken
        }
    }

    /// Waits for `target` to come to the front, then presses Ctrl+V. Keys still held from the bar, Shift from
    /// Shift+Enter, are lifted once Ctrl is down, so no Alt or Win press of its own reaches the app.
    pub fn paste(target: usize) -> Landed {
        let start = Instant::now();
        while unsafe { GetForegroundWindow() as usize } != target {
            if target == 0 || start.elapsed() > FRONT {
                return Landed::Copied;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if above(target as HWND) {
            return Landed::Copied;
        }
        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    ..Default::default()
                },
            },
        };
        let held = [VK_LSHIFT, VK_RSHIFT, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN]
            .into_iter()
            .filter(|&vk| unsafe { GetAsyncKeyState(i32::from(vk)) } < 0);
        let inputs: Vec<INPUT> = [key(VK_CONTROL, false)]
            .into_iter()
            .chain(held.map(|vk| key(vk, true)))
            .chain([key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)])
            .collect();
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            )
        };
        if sent as usize == inputs.len() {
            Landed::Pasted
        } else {
            Landed::Copied
        }
    }

    /// Whether Windows drops Sumi's keys on their way to `window`: an app run as administrator while Sumi isn't. An
    /// app Sumi can't look into counts as one.
    fn above(window: HWND) -> bool {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return true;
        }
        let theirs = elevated(process);
        unsafe { CloseHandle(process) };
        theirs != Some(false) && elevated(unsafe { GetCurrentProcess() }) != Some(true)
    }

    fn elevated(process: HANDLE) -> Option<bool> {
        let mut token: HANDLE = std::ptr::null_mut();
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0;
        // SAFETY: the buffer is a TOKEN_ELEVATION, and its size is passed with it.
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                (&raw mut elevation).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut size,
            )
        } != 0;
        unsafe { CloseHandle(token) };
        read.then_some(elevation.TokenIsElevated != 0)
    }

    pub fn hide(window: usize, hidden: bool) {
        let affinity = if hidden {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        unsafe { SetWindowDisplayAffinity(window as HWND, affinity) };
    }

    pub fn protect(plain: &[u8]) -> Option<Vec<u8>> {
        crypt(plain, true)
    }

    pub fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
        crypt(sealed, false)
    }

    /// Seals or opens with DPAPI for the current Windows user, never asking anything on screen.
    fn crypt(data: &[u8], seal: bool) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(data.len()).ok()?,
            pbData: data.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `input` points into `data`, which both calls only read. Windows allocates `output` with
        // LocalAlloc: it is copied out, then freed once.
        unsafe {
            let done = if seal {
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            };
            if done == 0 || output.pbData.is_null() {
                return None;
            }
            let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            Some(bytes)
        }
    }
}

#[cfg(not(windows))]
mod os {
    use tauri::AppHandle;

    use super::Landed;

    pub fn listen(_: &AppHandle) {}
    pub fn listening(_: usize, _: bool) {}
    pub fn owner() -> usize {
        0
    }
    pub fn sequence() -> u32 {
        0
    }
    pub fn remote(_: &str) -> bool {
        false
    }
    pub fn read(_: usize) -> Option<String> {
        None
    }
    pub fn write(_: usize, _: &str) -> bool {
        false
    }
    pub fn paste(_: usize) -> Landed {
        Landed::Failed
    }
    pub fn hide(_: usize, _: bool) {}
    pub fn protect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
    pub fn unprotect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(items: &[&str]) -> History {
        History(items.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn puts_a_copy_on_top() {
        let mut h = History::default();
        assert!(h.add("un".into()));
        assert!(h.add("deux".into()));
        assert_eq!(h, history(&["deux", "un"]));
    }

    #[test]
    fn moves_a_copy_already_in_to_the_top() {
        let mut h = history(&["trois", "deux", "un"]);
        assert!(h.add("un".into()));
        assert_eq!(h, history(&["un", "trois", "deux"]));
        assert!(!h.add("un".into()));
        assert_eq!(h.0.len(), 3);
    }

    #[test]
    fn drops_the_oldest_past_the_limit() {
        let mut h = History::default();
        for i in 0..=ITEMS {
            h.add(i.to_string());
        }
        assert_eq!(h.0.len(), ITEMS);
        assert_eq!(h.0.first().map(String::as_str), Some("100"));
        assert_eq!(h.0.last().map(String::as_str), Some("1"));
    }

    #[test]
    fn skips_blank_and_huge_copies() {
        let mut h = History::default();
        assert!(!h.add(String::new()));
        assert!(!h.add(" \n\t".into()));
        assert!(!h.add("a".repeat(ITEM_BYTES + 1)));
        assert!(h.add("a".repeat(ITEM_BYTES)));
        assert_eq!(h.0.len(), 1);
    }

    #[test]
    fn skips_what_the_app_marked_private() {
        assert!(!Marks::default().private());
        assert!(
            Marks {
                exclude: true,
                ..Default::default()
            }
            .private()
        );
        assert!(
            Marks {
                ignore: true,
                ..Default::default()
            }
            .private()
        );
        assert!(
            Marks {
                history: Some(0),
                ..Default::default()
            }
            .private()
        );
        assert!(
            !Marks {
                history: Some(1),
                ..Default::default()
            }
            .private()
        );
    }

    #[test]
    fn opens_only_http_and_https_links() {
        assert_eq!(link("https://a.fr").as_deref(), Some("https://a.fr"));
        assert_eq!(
            link("HTTP://A.fr/p?q=1#x").as_deref(),
            Some("HTTP://A.fr/p?q=1#x")
        );
        assert_eq!(
            link("https://a.fr/\"x").as_deref(),
            Some("https://a.fr/%22x")
        );
        for text in [
            "https://",
            "https:///a",
            "https://?q",
            "https://a.fr/a b",
            "https://a.fr/\u{7}",
            "ftp://a.fr",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "C:\\Windows",
            "httpé://a.fr",
        ] {
            assert_eq!(link(text), None, "{text}");
        }
        assert!(link(&format!("https://a.fr/{}", "a".repeat(apps::LONGEST_LINK))).is_none());
    }

    #[test]
    fn writes_only_to_a_plain_address() {
        for text in ["camille.martin@exemple.fr", "a+b_c-d@sub.example.co.uk"] {
            assert!(address(text), "{text}");
        }
        for text in [
            "camille@exemple",
            "a@b.c",
            ".a@exemple.fr",
            "a..b@exemple.fr",
            "a@-exemple.fr",
            "a@exemple-.fr",
            "a?subject=x@exemple.fr",
            "a@exemple.fr?attach=C:\\x",
            "a%40b@exemple.fr",
            "a&b@exemple.fr",
            "josé@exemple.fr",
            "a b@exemple.fr",
            "@exemple.fr",
        ] {
            assert!(!address(text), "{text}");
        }
    }

    #[test]
    fn reads_a_path_from_a_drive_only() {
        assert_eq!(path("C:\\Users\\x"), Some("C:\\Users\\x"));
        assert_eq!(path(" d:/Photos \n"), Some("d:/Photos"));
        assert_eq!(path("\"C:\\a b\\c.txt\""), Some("C:\\a b\\c.txt"));
        assert_eq!(path("C:\\"), Some("C:\\"));
        for text in [
            "\\\\server\\share\\a.txt",
            "\\\\?\\C:\\a",
            "C:relative",
            "C:",
            "file:///C:/a",
            "1:\\a",
            "C:\\a\nC:\\b",
            "\"C:\\a",
            "C:\\a\"b",
        ] {
            assert_eq!(path(text), None, "{text}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn opens_what_the_text_is_and_shows_files_without_running_them() {
        assert_eq!(
            opening(" https://a.fr \n"),
            Some(Opening::Link("https://a.fr".into()))
        );
        assert_eq!(
            opening("a@b.fr"),
            Some(Opening::Mail("mailto:a@b.fr".into()))
        );
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let calc = format!("{windows}\\System32\\calc.exe");
        assert_eq!(opening(&calc), Some(Opening::Folder(calc.clone())));
        assert_eq!(
            opening(&format!("\"{windows}\"")),
            Some(Opening::Folder(windows.clone()))
        );
        for written in [
            windows.replace('\\', "/"),
            windows.replace('\\', "\\\\"),
            format!("{windows}\\System32\\.."),
        ] {
            assert_eq!(
                opening(&written),
                Some(Opening::Folder(windows.clone())),
                "{written}"
            );
        }
        assert!(!os::remote(&windows));
        assert_eq!(opening("C:\\sumi-nothing-here\\a.txt"), None);
        assert_eq!(opening("Réunion jeudi"), None);
        assert_eq!(opening("#1E90FF"), None);
    }

    #[test]
    fn pastes_only_a_colour_or_the_link_with_less() {
        for (item, form) in [
            ("#1e90ff", "rgb(30, 144, 255)"),
            ("rgb(30 144 255)", "#1E90FF"),
            ("HSL(210, 100%, 56%)", "hsl(210, 100%, 56%)"),
            ("#123", "rgb(17, 34, 51)"),
            (
                "https://a.fr/p?id=5&utm_source=x#top",
                "https://a.fr/p?id=5#top",
            ),
            ("https://a.fr/?utm_source=x&utm_medium=y", "https://a.fr/"),
            ("https://a.fr/?a=1&&b=2&fbclid=3", "https://a.fr/?a=1&b=2"),
            (" https://a.fr/?gclid=1 \n", "https://a.fr/"),
        ] {
            assert!(offers(item, form), "{item} → {form}");
        }
        for (item, form) in [
            ("#1e90ff", "rm -rf ~"),
            ("#1e90ff", "#1E90FF\n"),
            ("#1e90ff", "rgb(30,144,255)"),
            ("#1e90ff", "rgb(1000, 0, 0)"),
            ("#1e90ff", "hsl(210, 100, 56)"),
            ("Réunion jeudi", "#1E90FF"),
            ("https://a.fr/?a=1", "https://a.fr/?a=1&b=2"),
            ("https://a.fr/?a=1&b=2", "https://a.fr/?b=2&a=1"),
            ("https://a.fr/?a=1", "https://b.fr/?a=1"),
            ("https://a.fr/?a=1#x", "https://a.fr/?a=1"),
            ("https://a.fr/?a=1", "https://a.fr/?"),
            ("https://a.fr/p", "https://a.fr/p\nrm -rf ~"),
            ("ftp://a.fr/?a=1", "ftp://a.fr/"),
        ] {
            assert!(!offers(item, form), "{item} → {form}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn seals_and_opens_for_this_user_only() {
        let h = history(&["mot de passe ? non", "C:\\Users\\Valentin", "é 🙂"]);
        let sealed = h
            .seal()
            .expect("DPAPI seals for the user running the tests");
        let plain = serde_json::to_vec(&h.0).expect("strings serialize");
        assert!(!sealed.windows(plain.len()).any(|w| w == plain));
        assert_eq!(History::unseal(&sealed), h);
        assert_eq!(History::unseal(b"not sealed"), History::default());
    }

    #[cfg(windows)]
    #[test]
    fn keeps_the_history_across_a_restart() {
        let dir = std::env::temp_dir().join(format!("sumi-clipboard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(History::load(&dir), History::default());
        let h = history(&["deux", "un"]);
        h.save(&dir).expect("the temp folder is writable");
        assert_eq!(History::load(&dir), h);
        assert!(!dir.join(NEXT).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn clearing_leaves_no_history_behind() {
        let dir = std::env::temp_dir().join(format!("sumi-clipboard-clear-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let h = history(&["deux", "un"]);
        h.save(&dir).expect("the temp folder is writable");
        // A save cut short before its rename.
        std::fs::copy(dir.join(KEPT), dir.join(NEXT)).expect("the temp folder is writable");
        History::forget(&dir);
        assert!(!dir.join(KEPT).exists());
        assert!(!dir.join(NEXT).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

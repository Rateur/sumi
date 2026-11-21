//! The clipboard history: the text you copy, newest first, once you allow it in the command bar. It is kept on this
//! PC across restarts, sealed with Windows' per-user encryption (DPAPI) in the app's local data folder, which a
//! roaming profile doesn't copy to a server. A message-only window hears each copy while the history is on, and
//! sleeps otherwise. Enter on an item pastes it into the window the bar came from. A copy never wakes the island,
//! and nothing here goes on the network.

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{bar, tray};

/// The oldest items drop off past this many.
const ITEMS: usize = 100;
/// A copy past this size isn't kept, rather than cut, since a cut paste would be wrong. A long page or a source file
/// fits; a log or a table export doesn't, and the whole history is sealed and written again at each copy.
const ITEM_BYTES: usize = 64 * 1024;
/// The sealed history, and the flag that holds the yes, in the app's local data folder.
const KEPT: &str = "clipboard_history";
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

    /// Writes beside the file, then over it, so a crash never leaves half a history.
    fn save(&self, dir: &Path) -> std::io::Result<()> {
        let sealed = self
            .seal()
            .ok_or_else(|| std::io::Error::other("DPAPI refused"))?;
        std::fs::create_dir_all(dir)?;
        let next = dir.join(format!("{KEPT}.tmp"));
        std::fs::write(&next, sealed)?;
        std::fs::rename(next, dir.join(KEPT))
    }
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
/// writes the text alone, even over the top item's own formatting.
#[tauri::command]
pub async fn clipboard_paste(window: WebviewWindow, text: String, plain: bool) -> Landed {
    tauri::async_runtime::spawn_blocking(move || paste(&window, text, plain))
        .await
        .unwrap_or(Landed::Failed)
}

fn paste(window: &WebviewWindow, text: String, plain: bool) -> Landed {
    let state = window.state::<Clipboard>();
    let written = state.history.lock().is_ok_and(|mut history| {
        // Only what the history holds: the page can't put anything else on the clipboard.
        if !history.0.contains(&text) {
            return false;
        }
        let fresh = !plain
            && history.0.first() == Some(&text)
            && os::sequence() == state.top.load(Ordering::SeqCst);
        if !fresh {
            if !os::write(state.window.load(Ordering::SeqCst), &text) {
                return false;
            }
            state.top.store(os::sequence(), Ordering::SeqCst);
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
            let _ = std::fs::remove_file(dir.join(KEPT));
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
        GetWindowThreadProcessId, HWND_MESSAGE, MSG, PostMessageW, RegisterClassW,
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WM_APP, WM_CLIPBOARDUPDATE,
        WNDCLASSW,
    };

    use super::{Clipboard, ITEM_BYTES, Landed, Marks};

    /// Posted to the window: `wparam` 1 starts listening to copies, 0 stops.
    const LISTEN: u32 = WM_APP;
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
    pub fn read(owner: usize) -> Option<String> {
        let has = |name: &str| unsafe { IsClipboardFormatAvailable(format(name)) } != 0;
        let mut marks = Marks {
            exclude: has("ExcludeClipboardContentFromMonitorProcessing"),
            ignore: has("Clipboard Viewer Ignore"),
            history: None,
        };
        if marks.private() || !open(owner) {
            return None;
        }
        marks.history = data(format("CanIncludeInClipboardHistory"), 64)
            .and_then(|b| Some(u32::from_le_bytes(b.get(..4)?.try_into().ok()?)));
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

    /// Puts `text` alone on the clipboard, owned by `owner`, so its listener knows it for Sumi's.
    pub fn write(owner: usize, text: &str) -> bool {
        let units = wide(text);
        if !open(owner) {
            return false;
        }
        // SAFETY: the block is allocated for `units`, which the copy fills exactly. Once SetClipboardData takes it,
        // the clipboard owns it; until then it is Sumi's to free.
        let written = unsafe {
            EmptyClipboard() != 0 && {
                let handle = GlobalAlloc(GMEM_MOVEABLE, units.len() * 2);
                let ptr = GlobalLock(handle).cast::<u16>();
                !ptr.is_null() && {
                    std::ptr::copy_nonoverlapping(units.as_ptr(), ptr, units.len());
                    GlobalUnlock(handle);
                    let taken = !SetClipboardData(u32::from(CF_UNICODETEXT), handle).is_null();
                    if !taken {
                        GlobalFree(handle);
                    }
                    taken
                }
            }
        };
        unsafe { CloseClipboard() };
        written
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
        assert!(!dir.join(format!("{KEPT}.tmp")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

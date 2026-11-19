//! Which apps use the microphone or the camera, and whether the microphone is muted. Windows' audio layer (Core
//! Audio) lists the apps that capture sound, and its camera layer (Media Foundation) the apps that stream video.
//! Both call back when that changes, so nothing runs in between. The registry list behind Windows' privacy page isn't
//! used: recent Windows 11 builds stopped updating it, and a crash leaves stale entries in it for months.
//! The names go to the page and nowhere else.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, Sender, channel};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// One app using the microphone, the camera or both. `since_ms` is Unix time, when Sumi first saw it.
/// Mirrored in src/lib/privacy.ts (`PrivacyApp`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub name: String,
    pub mic: bool,
    pub camera: bool,
    pub since_ms: i64,
    pub icon: Option<Icon>,
}

/// An app's icon as straight RGBA pixels in base64, `side` px square, for the page to paint without an image
/// encoder in the app. Mirrored in src/lib/privacy.ts, inline in `PrivacyApp`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Icon {
    pub side: u32,
    pub rgba: String,
}

/// What the page draws: the apps, oldest first, and the microphone's mute. Mirrored in src/lib/privacy.ts.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Privacy {
    apps: Vec<App>,
    muted: bool,
    can_mute: bool,
}

enum Msg {
    /// A capture session started, stopped or went.
    Sessions,
    /// A capture device came, went or became the default.
    Devices,
    /// The processes streaming from a camera now.
    Camera(Vec<u32>),
    /// A mute set from the page.
    Mute(bool),
    /// The microphone's mute changed, from Sumi or elsewhere.
    Volume,
}

pub struct Devices {
    tx: Sender<Msg>,
    snapshot: Mutex<Privacy>,
    /// The processes behind each app shown, for bringing its own window forward.
    owners: Mutex<HashMap<String, Vec<u32>>>,
}

#[tauri::command]
pub fn privacy_state(devices: tauri::State<'_, Devices>) -> Privacy {
    devices
        .snapshot
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

/// Mutes or unmutes the default microphone, for every app, as Windows' own mute does.
#[tauri::command]
pub fn privacy_mute(devices: tauri::State<'_, Devices>, muted: bool) {
    let _ = devices.tx.send(Msg::Mute(muted));
}

/// Brings an app's window to the front, where its own camera and microphone buttons are: Windows can't turn the
/// camera off for every app without admin rights, the way it mutes the microphone.
/// Answers whether a window came forward. It runs on the window's own thread, which has the input queue that
/// bringing another app forward needs.
#[tauri::command]
pub fn privacy_show(devices: tauri::State<'_, Devices>, name: String) -> bool {
    let pids = devices
        .owners
        .lock()
        .ok()
        .and_then(|owners| owners.get(&name).cloned());
    #[cfg(windows)]
    return pids.is_some_and(|pids| win::show(&pids));
    #[cfg(not(windows))]
    return pids.is_some_and(|_| false);
}

/// Opens Windows' own page for the camera or the microphone, which lists every app's access and lets you change it.
#[tauri::command]
pub fn privacy_settings(camera: bool) {
    #[cfg(windows)]
    win::settings(camera);
    #[cfg(not(windows))]
    let _ = camera;
}

/// Starts watching on a thread of its own, for the same reason as the music: Tauri's main thread is single-threaded
/// COM. If Windows' audio or camera layer is missing, that half stays empty.
pub fn watch(app: &AppHandle) {
    let (tx, rx) = channel();
    app.manage(Devices {
        tx: tx.clone(),
        snapshot: Mutex::default(),
        owners: Mutex::default(),
    });
    let app = app.clone();
    std::thread::spawn(move || run(&app, &tx, &rx));
}

/// Merges who captures sound and who streams video into one line per app. An app keeps the time it was first seen
/// while it stays; one that stops and comes back starts over.
fn gather(
    mic: &[String],
    camera: &[String],
    since: &mut HashMap<String, i64>,
    now: i64,
) -> Vec<App> {
    let mut apps: Vec<App> = Vec::new();
    for (name, is_camera) in mic
        .iter()
        .map(|n| (n, false))
        .chain(camera.iter().map(|n| (n, true)))
    {
        let app = match apps.iter_mut().find(|a| &a.name == name) {
            Some(app) => app,
            None => {
                let since_ms = *since.entry(name.clone()).or_insert(now);
                apps.push(App {
                    name: name.clone(),
                    mic: false,
                    camera: false,
                    since_ms,
                    icon: None,
                });
                apps.last_mut().expect("just pushed")
            }
        };
        if is_camera {
            app.camera = true;
        } else {
            app.mic = true;
        }
    }
    since.retain(|name, _| apps.iter().any(|a| &a.name == name));
    apps.sort_by_key(|a| a.since_ms);
    apps
}

#[cfg(not(windows))]
fn run(_: &AppHandle, _: &Sender<Msg>, _: &Receiver<Msg>) {}

#[cfg(windows)]
fn run(app: &AppHandle, tx: &Sender<Msg>, rx: &Receiver<Msg>) {
    win::run(app, tx, rx);
}

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::sync::mpsc::{Receiver, Sender};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY, S_OK};
    use windows::Win32::Media::Audio::Endpoints::{
        IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    };
    use windows::Win32::Media::Audio::{
        AUDIO_VOLUME_NOTIFICATION_DATA, AudioSessionDisconnectReason, AudioSessionState,
        AudioSessionStateActive, DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow, ERole,
        IAudioSessionControl, IAudioSessionControl2, IAudioSessionEvents, IAudioSessionEvents_Impl,
        IAudioSessionManager2, IAudioSessionNotification, IAudioSessionNotification_Impl,
        IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator,
        eCapture, eCommunications, eConsole,
    };
    use windows::Win32::Media::MediaFoundation::{
        IMFSensorActivitiesReport, IMFSensorActivitiesReportCallback,
        IMFSensorActivitiesReportCallback_Impl, IMFSensorActivityMonitor, MF_VERSION,
        MFSTARTUP_LITE,
    };
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::LibraryLoader::{
        GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::core::{BOOL, ComObject, GUID, HSTRING, Interface, PCWSTR, PWSTR, Ref, implement};

    use super::{Devices, Icon, Msg, Privacy, gather};

    /// Several callbacks come in a row when an app opens the microphone: one wait gathers them into one message.
    const BURST: Duration = Duration::from_millis(150);

    /// A running process: its parent and its exe's file name.
    struct Process {
        parent: u32,
        exe: String,
    }

    /// The name read for a pid, with the exe it was read for and that exe's full path, for its icon.
    struct Named {
        exe: String,
        name: String,
        path: Option<String>,
    }

    /// Callbacks run on Windows' threads: they only post a message.
    #[implement(
        IAudioSessionNotification,
        IAudioSessionEvents,
        IMMNotificationClient,
        IAudioEndpointVolumeCallback
    )]
    struct Ping(Sender<Msg>);

    impl Ping {
        fn send(&self, msg: Msg) -> windows::core::Result<()> {
            let _ = self.0.send(msg);
            Ok(())
        }
    }

    impl IAudioSessionNotification_Impl for Ping_Impl {
        fn OnSessionCreated(&self, _: Ref<IAudioSessionControl>) -> windows::core::Result<()> {
            self.send(Msg::Sessions)
        }
    }

    impl IAudioSessionEvents_Impl for Ping_Impl {
        fn OnDisplayNameChanged(&self, _: &PCWSTR, _: *const GUID) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnIconPathChanged(&self, _: &PCWSTR, _: *const GUID) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnSimpleVolumeChanged(
            &self,
            _: f32,
            _: BOOL,
            _: *const GUID,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnChannelVolumeChanged(
            &self,
            _: u32,
            _: *const f32,
            _: u32,
            _: *const GUID,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnGroupingParamChanged(
            &self,
            _: *const GUID,
            _: *const GUID,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnStateChanged(&self, _: AudioSessionState) -> windows::core::Result<()> {
            self.send(Msg::Sessions)
        }
        fn OnSessionDisconnected(
            &self,
            _: AudioSessionDisconnectReason,
        ) -> windows::core::Result<()> {
            self.send(Msg::Sessions)
        }
    }

    impl IMMNotificationClient_Impl for Ping_Impl {
        fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
            self.send(Msg::Devices)
        }
        fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
            self.send(Msg::Devices)
        }
        fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
            self.send(Msg::Devices)
        }
        fn OnDefaultDeviceChanged(
            &self,
            flow: EDataFlow,
            _: ERole,
            _: &PCWSTR,
        ) -> windows::core::Result<()> {
            if flow == eCapture {
                self.send(Msg::Devices)?;
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
            Ok(())
        }
    }

    impl IAudioEndpointVolumeCallback_Impl for Ping_Impl {
        fn OnNotify(&self, _: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
            self.send(Msg::Volume)
        }
    }

    /// The camera layer reports every streaming change; the callback reads who streams and posts it.
    #[implement(IMFSensorActivitiesReportCallback)]
    struct Sensors(Sender<Msg>);

    impl IMFSensorActivitiesReportCallback_Impl for Sensors_Impl {
        fn OnActivitiesReport(
            &self,
            report: Ref<IMFSensorActivitiesReport>,
        ) -> windows::core::Result<()> {
            let mut pids = Vec::new();
            if let Some(report) = report.as_ref() {
                for i in 0..unsafe { report.GetCount()? } {
                    let Ok(sensor) = (unsafe { report.GetActivityReport(i) }) else {
                        continue;
                    };
                    for j in 0..unsafe { sensor.GetProcessCount() }.unwrap_or(0) {
                        let Ok(process) = (unsafe { sensor.GetProcessActivity(j) }) else {
                            continue;
                        };
                        if unsafe { process.GetStreamingState() }.is_ok_and(BOOL::as_bool) {
                            pids.extend(unsafe { process.GetProcessId() });
                        }
                    }
                }
            }
            let _ = self.0.send(Msg::Camera(pids));
            Ok(())
        }
    }

    /// The capture devices being watched: each one's session manager, and the sessions heard from.
    #[derive(Default)]
    struct Capture {
        managers: Vec<IAudioSessionManager2>,
        sessions: Vec<IAudioSessionControl>,
        defaults: Vec<IAudioEndpointVolume>,
    }

    impl Capture {
        /// Every active microphone, with a callback for new sessions on it, and the default ones' mute.
        fn open(enumerator: &IMMDeviceEnumerator, ping: &ComObject<Ping>) -> Self {
            let mut capture = Self::default();
            let notification: IAudioSessionNotification = ping.to_interface();
            if let Ok(devices) =
                unsafe { enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) }
            {
                for i in 0..unsafe { devices.GetCount() }.unwrap_or(0) {
                    let Ok(device) = (unsafe { devices.Item(i) }) else {
                        continue;
                    };
                    let Ok(manager) =
                        (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) })
                    else {
                        continue;
                    };
                    // Windows only sends session news once the sessions have been listed.
                    let _ = unsafe { manager.GetSessionEnumerator() };
                    if unsafe { manager.RegisterSessionNotification(&notification) }.is_ok() {
                        capture.managers.push(manager);
                    }
                }
            }
            let callback: IAudioEndpointVolumeCallback = ping.to_interface();
            let mut ids: Vec<String> = Vec::new();
            for role in [eConsole, eCommunications] {
                let Ok(device) = (unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, role) })
                else {
                    continue;
                };
                let Ok(raw) = (unsafe { device.GetId() }) else {
                    continue;
                };
                let id = unsafe { raw.to_string() }.unwrap_or_default();
                unsafe { CoTaskMemFree(Some(raw.0.cast_const().cast())) };
                if ids.contains(&id) {
                    continue;
                }
                let Ok(volume) =
                    (unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) })
                else {
                    continue;
                };
                let _ = unsafe { volume.RegisterControlChangeNotify(&callback) };
                ids.push(id);
                capture.defaults.push(volume);
            }
            capture
        }

        /// Who captures sound now. Sessions are listed again, each with a callback for when it starts or stops.
        fn listen(&mut self, ping: &ComObject<Ping>) -> Vec<u32> {
            let events: IAudioSessionEvents = ping.to_interface();
            for session in self.sessions.drain(..) {
                let _ = unsafe { session.UnregisterAudioSessionNotification(&events) };
            }
            let mut pids = Vec::new();
            for manager in &self.managers {
                let Ok(list) = (unsafe { manager.GetSessionEnumerator() }) else {
                    continue;
                };
                for i in 0..unsafe { list.GetCount() }.unwrap_or(0) {
                    let Ok(session) = (unsafe { list.GetSession(i) }) else {
                        continue;
                    };
                    if unsafe { session.RegisterAudioSessionNotification(&events) }.is_ok() {
                        self.sessions.push(session.clone());
                    }
                    let Ok(control) = session.cast::<IAudioSessionControl2>() else {
                        continue;
                    };
                    // Teams and others keep a session open after a call: only one that captures counts.
                    let active =
                        unsafe { session.GetState() }.is_ok_and(|s| s == AudioSessionStateActive);
                    let system = unsafe { control.IsSystemSoundsSession() } == S_OK;
                    if active && !system {
                        pids.extend(unsafe { control.GetProcessId() });
                    }
                }
            }
            pids
        }

        /// Muted only when every default microphone is: a live headset beside a muted laptop mic still hears.
        fn muted(&self) -> bool {
            !self.defaults.is_empty()
                && self
                    .defaults
                    .iter()
                    .all(|v| unsafe { v.GetMute() }.is_ok_and(BOOL::as_bool))
        }

        fn mute(&self, muted: bool) {
            for volume in &self.defaults {
                let _ = unsafe { volume.SetMute(muted, std::ptr::null()) };
            }
        }

        fn close(&mut self, ping: &ComObject<Ping>) {
            let events: IAudioSessionEvents = ping.to_interface();
            for session in self.sessions.drain(..) {
                let _ = unsafe { session.UnregisterAudioSessionNotification(&events) };
            }
            let notification: IAudioSessionNotification = ping.to_interface();
            for manager in self.managers.drain(..) {
                let _ = unsafe { manager.UnregisterSessionNotification(&notification) };
            }
            let callback: IAudioEndpointVolumeCallback = ping.to_interface();
            for volume in self.defaults.drain(..) {
                let _ = unsafe { volume.UnregisterControlChangeNotify(&callback) };
            }
        }
    }

    // shortcut: a capture driver that hangs inside one of Windows' calls holds this thread, and the dot waits with it;
    // the rest of Sumi doesn't. Add timeouts if one is ever seen doing it.
    pub(super) fn run(app: &AppHandle, tx: &Sender<Msg>, rx: &Receiver<Msg>) {
        if let Err(e) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
            log::warn!("privacy: COM didn't start: {e}");
            return;
        }
        let Ok(enumerator) = (unsafe {
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        })
        .inspect_err(|e| log::warn!("privacy: no audio device enumerator: {e}")) else {
            return;
        };
        let ping = ComObject::new(Ping(tx.clone()));
        let client: IMMNotificationClient = ping.to_interface();
        let _ = unsafe { enumerator.RegisterEndpointNotificationCallback(&client) };
        // The camera half: kept alive as long as the loop. Without Media Foundation, only the microphone shows.
        let _monitor =
            camera_monitor(tx).inspect_err(|e| log::warn!("privacy: no camera monitor: {e}"));

        let own = std::process::id();
        let mut capture = Capture::open(&enumerator, &ping);
        let mut camera: Vec<u32> = Vec::new();
        let mut since: HashMap<String, i64> = HashMap::new();
        // The name read for each pid. A pid Windows has since given to another exe gets a new name.
        let mut names: HashMap<u32, Named> = HashMap::new();
        let mut icons: HashMap<String, Option<Icon>> = HashMap::new();
        // The state sent last, so an unchanged one isn't sent again.
        let mut last: Option<Privacy> = None;
        let mut next = Some(Msg::Sessions);
        loop {
            let mut devices = false;
            while let Some(msg) = next.take() {
                match msg {
                    Msg::Devices => devices = true,
                    Msg::Camera(pids) => camera = pids,
                    Msg::Mute(muted) => capture.mute(muted),
                    Msg::Sessions | Msg::Volume => {}
                }
                next = rx.recv_timeout(BURST).ok();
            }
            if devices {
                capture.close(&ping);
                capture = Capture::open(&enumerator, &ping);
            }

            let mic = capture.listen(&ping);
            let processes = processes();
            // Which path each name came from, for its icon, and which processes.
            let mut paths: HashMap<String, String> = HashMap::new();
            let mut hosts: HashMap<String, Vec<u32>> = HashMap::new();
            let mut name = |pid: u32| -> Option<String> {
                if pid == own || pid == 0 {
                    return None;
                }
                let host = host(pid, &processes);
                let exe = processes
                    .get(&host)
                    .map(|p| p.exe.clone())
                    .unwrap_or_default();
                let (name, path) = match names.get(&host) {
                    Some(known) if known.exe == exe => (known.name.clone(), known.path.clone()),
                    _ => {
                        let path = image_path(host);
                        let name = app_name(host, path.clone(), &processes)?;
                        let named = Named {
                            exe,
                            name: name.clone(),
                            path: path.clone(),
                        };
                        names.insert(host, named);
                        (name, path)
                    }
                };
                if let Some(path) = path {
                    paths.entry(name.clone()).or_insert(path);
                }
                hosts.entry(name.clone()).or_default().push(host);
                Some(name)
            };
            let mic: Vec<String> = mic.into_iter().filter_map(&mut name).collect();
            let camera_names: Vec<String> = camera.iter().copied().filter_map(&mut name).collect();
            names.retain(|pid, _| processes.contains_key(pid));
            let mut apps = gather(&mic, &camera_names, &mut since, unix_ms());
            if let Ok(mut owners) = app.state::<Devices>().owners.lock() {
                *owners = hosts
                    .into_iter()
                    .map(|(name, pids)| (name, roots(&pids, &processes)))
                    .collect();
            }
            for app in &mut apps {
                if let Some(path) = paths.get(&app.name) {
                    app.icon = icons
                        .entry(path.clone())
                        .or_insert_with(|| icon(path))
                        .clone();
                }
            }
            let state = Privacy {
                apps,
                muted: capture.muted(),
                can_mute: !capture.defaults.is_empty(),
            };
            if last.as_ref() != Some(&state) {
                let _ = app.emit("privacy://state", &state);
                if let Ok(mut snapshot) = app.state::<Devices>().snapshot.lock() {
                    snapshot.clone_from(&state);
                }
                last = Some(state);
            }
            next = match rx.recv() {
                Ok(msg) => Some(msg),
                Err(_) => return,
            };
        }
    }

    pub(super) fn settings(camera: bool) {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let page = if camera {
            "ms-settings:privacy-webcam"
        } else {
            "ms-settings:privacy-microphone"
        };
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (open, page) = (wide("open"), wide(page));
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                open.as_ptr(),
                page.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }

    /// Media Foundation, found at run time: Windows N editions ship without it unless the Media Feature Pack is in,
    /// and a load-time import would keep Sumi from starting there at all.
    fn camera_monitor(tx: &Sender<Msg>) -> windows::core::Result<IMFSensorActivityMonitor> {
        type Startup = unsafe extern "system" fn(u32, u32) -> windows::core::HRESULT;
        type Create = unsafe extern "system" fn(
            *mut core::ffi::c_void,
            *mut *mut core::ffi::c_void,
        ) -> windows::core::HRESULT;
        let load = |dll: &str| unsafe {
            LoadLibraryExW(&HSTRING::from(dll), None, LOAD_LIBRARY_SEARCH_SYSTEM32)
        };
        let (plat, sensors) = (load("mfplat.dll")?, load("mfsensorgroup.dll")?);
        let startup = unsafe { GetProcAddress(plat, windows::core::s!("MFStartup")) }
            .ok_or_else(windows::core::Error::from_thread)?;
        let create =
            unsafe { GetProcAddress(sensors, windows::core::s!("MFCreateSensorActivityMonitor")) }
                .ok_or_else(windows::core::Error::from_thread)?;
        // SAFETY: both are documented with exactly these signatures.
        let (startup, create): (Startup, Create) = unsafe {
            (
                std::mem::transmute::<unsafe extern "system" fn() -> isize, Startup>(startup),
                std::mem::transmute::<unsafe extern "system" fn() -> isize, Create>(create),
            )
        };
        unsafe { startup(MF_VERSION, MFSTARTUP_LITE) }.ok()?;
        let callback: IMFSensorActivitiesReportCallback = Sensors(tx.clone()).into();
        let mut monitor = std::ptr::null_mut();
        unsafe { create(callback.as_raw(), &mut monitor) }.ok()?;
        // SAFETY: on success the call hands over one reference to the new monitor.
        let monitor = unsafe { IMFSensorActivityMonitor::from_raw(monitor) };
        unsafe { monitor.Start() }?;
        Ok(monitor)
    }

    /// The processes that own an app's windows: from the one capturing, up its parents of the same exe, as a
    /// browser's or Electron app's helper process leads to the main one.
    fn roots(pids: &[u32], processes: &HashMap<u32, Process>) -> Vec<u32> {
        let mut roots = Vec::new();
        for &pid in pids {
            let mut pid = pid;
            for _ in 0..8 {
                let Some(process) = processes.get(&pid) else {
                    break;
                };
                match processes.get(&process.parent) {
                    Some(up) if up.exe.eq_ignore_ascii_case(&process.exe) => pid = process.parent,
                    _ => break,
                }
            }
            roots.push(pid);
        }
        roots.extend_from_slice(pids);
        // dedup only drops repeats that sit side by side.
        roots.sort_unstable();
        roots.dedup();
        roots
    }

    /// Brings forward the frontmost window of these processes. A Store app's window belongs to ApplicationFrameHost,
    /// with the app's own window inside it.
    pub(super) fn show(pids: &[u32]) -> bool {
        use windows_sys::Win32::Foundation::{HWND, LPARAM};
        use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
        use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumChildWindows, EnumWindows, GW_OWNER, GetClassNameW, GetForegroundWindow, GetWindow,
            GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, MSG,
            PM_NOREMOVE, PeekMessageW, SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindowAsync,
        };

        struct Search {
            pids: Vec<u32>,
            found: HWND,
            /// The second pass also takes a window hidden in the tray or cloaked on another virtual desktop.
            hidden: bool,
        }
        fn owned(hwnd: HWND, pids: &[u32]) -> bool {
            let mut pid = 0;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            pids.contains(&pid)
        }
        unsafe extern "system" fn child(hwnd: HWND, search: LPARAM) -> i32 {
            // SAFETY: show() passes a pointer to its own Search, alive for the whole EnumWindows call, and only
            // shared references to it exist while children are listed.
            let search = unsafe { &*(search as *const Search) };
            i32::from(!owned(hwnd, &search.pids))
        }
        unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> i32 {
            // SAFETY: as in child. Only shared references are taken, even across EnumChildWindows, and `found` is
            // written once, through the pointer, after the last of them.
            let search = unsafe { &*(lparam as *const Search) };
            let found = unsafe {
                let mut cloaked = 0u32;
                let _ =
                    DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as u32, (&raw mut cloaked).cast(), 4);
                (search.hidden || (IsWindowVisible(hwnd) != 0 && cloaked == 0))
                    && GetWindow(hwnd, GW_OWNER).is_null()
                    && GetWindowTextLengthW(hwnd) > 0
            } && {
                let mut class = [0u16; 32];
                let len = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), 32) };
                let frame = String::from_utf16_lossy(&class[..usize::try_from(len).unwrap_or(0)])
                    == "ApplicationFrameWindow";
                owned(hwnd, &search.pids)
                    || (frame && unsafe { EnumChildWindows(hwnd, Some(child), lparam) } == 0)
            };
            if found {
                unsafe { (*(lparam as *mut Search)).found = hwnd };
            }
            i32::from(!found)
        }

        let mut search = Search {
            pids: pids.to_vec(),
            found: std::ptr::null_mut(),
            hidden: false,
        };
        unsafe { EnumWindows(Some(each), (&raw mut search) as LPARAM) };
        // A call app minimized to the tray hides its window: shown again, it comes back.
        if search.found.is_null() {
            search.hidden = true;
            unsafe { EnumWindows(Some(each), (&raw mut search) as LPARAM) };
        }
        let hwnd = search.found;
        if hwnd.is_null() {
            return false;
        }
        unsafe {
            // Async: a hung app never holds Sumi's main thread waiting for its answer.
            if IsIconic(hwnd) != 0 {
                ShowWindowAsync(hwnd, SW_RESTORE);
            } else if IsWindowVisible(hwnd) == 0 {
                ShowWindowAsync(hwnd, SW_SHOW);
            }
            // The click reached WebView2's process, not this one, so Windows wouldn't let it pick the foreground
            // window: sharing input with the current foreground thread for a moment does.
            let mut msg = MSG::default();
            PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
            let front = GetWindowThreadProcessId(GetForegroundWindow(), std::ptr::null_mut());
            let me = GetCurrentThreadId();
            let attached = front != 0 && front != me && AttachThreadInput(me, front, 1) != 0;
            let shown = SetForegroundWindow(hwnd) != 0;
            if attached {
                AttachThreadInput(me, front, 0);
            }
            shown
        }
    }

    fn unix_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    }

    /// Every process now.
    fn processes() -> HashMap<u32, Process> {
        let mut all = HashMap::new();
        let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return all;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(0),
            ..Default::default()
        };
        let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
        while more {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let exe = String::from_utf16_lossy(&entry.szExeFile[..len]);
            let parent = entry.th32ParentProcessID;
            all.insert(entry.th32ProcessID, Process { parent, exe });
            more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
        }
        let _ = unsafe { CloseHandle(snapshot) };
        all
    }

    /// The app a process belongs to: a WebView2 process stands for the app that hosts it.
    fn host(pid: u32, processes: &HashMap<u32, Process>) -> u32 {
        let mut pid = pid;
        for _ in 0..8 {
            match processes.get(&pid) {
                Some(process)
                    if process.exe.eq_ignore_ascii_case("msedgewebview2.exe")
                        && processes.contains_key(&process.parent) =>
                {
                    pid = process.parent;
                }
                _ => break,
            }
        }
        pid
    }

    /// The name people know an app by: its exe's description ("Discord", "Google Chrome"), else the exe's name.
    fn app_name(
        pid: u32,
        path: Option<String>,
        processes: &HashMap<u32, Process>,
    ) -> Option<String> {
        let described = path.as_deref().and_then(description);
        described.or_else(|| {
            let exe = path.or_else(|| processes.get(&pid).map(|p| p.exe.clone()))?;
            let file = exe.rsplit(['\\', '/']).next()?;
            Some(
                file.strip_suffix(".exe")
                    .or_else(|| file.strip_suffix(".EXE"))
                    .unwrap_or(file)
                    .to_string(),
            )
        })
    }

    /// The exe's own icon, at the size Windows draws large icons, read as 32-bit pixels. Old icons without any alpha
    /// are opaque.
    fn icon(path: &str) -> Option<Icon> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        use windows_sys::Win32::Graphics::Gdi::{
            BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
            DeleteObject, GetDIBits,
        };
        use windows_sys::Win32::UI::Shell::ExtractIconExW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

        let wide: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let mut large = std::ptr::null_mut();
        let found =
            unsafe { ExtractIconExW(wide.as_ptr(), 0, &mut large, std::ptr::null_mut(), 1) };
        if found == 0 || large.is_null() {
            return None;
        }
        let mut info = ICONINFO::default();
        let mut pixels = Vec::new();
        let mut side = 0u32;
        if unsafe { GetIconInfo(large, &mut info) } != 0 && !info.hbmColor.is_null() {
            let dc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or(0);
            // A first call with no buffer fills in the bitmap's size.
            let sized = unsafe {
                GetDIBits(
                    dc,
                    info.hbmColor,
                    0,
                    0,
                    std::ptr::null_mut(),
                    &mut bmi,
                    DIB_RGB_COLORS,
                )
            };
            let width = bmi.bmiHeader.biWidth;
            if sized != 0 && width > 0 && width <= 256 && bmi.bmiHeader.biHeight.abs() == width {
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB;
                bmi.bmiHeader.biHeight = -width;
                let side_px = width.unsigned_abs();
                pixels = vec![0u8; (side_px * side_px * 4) as usize];
                let read = unsafe {
                    GetDIBits(
                        dc,
                        info.hbmColor,
                        0,
                        side_px,
                        pixels.as_mut_ptr().cast(),
                        &mut bmi,
                        DIB_RGB_COLORS,
                    )
                };
                if read == width {
                    side = side_px;
                }
                // Old icons keep their transparency in the AND mask: white there is see-through.
                if side != 0 && !info.hbmMask.is_null() && pixels.chunks(4).all(|p| p[3] == 0) {
                    let mut mask = vec![0u8; pixels.len()];
                    let read = unsafe {
                        GetDIBits(
                            dc,
                            info.hbmMask,
                            0,
                            side_px,
                            mask.as_mut_ptr().cast(),
                            &mut bmi,
                            DIB_RGB_COLORS,
                        )
                    };
                    if read == width {
                        for (pixel, bit) in pixels.chunks_mut(4).zip(mask.chunks(4)) {
                            pixel[3] = if bit[0] == 0 { 255 } else { 0 };
                        }
                    }
                }
            }
            unsafe { DeleteDC(dc) };
        }
        unsafe {
            if !info.hbmColor.is_null() {
                DeleteObject(info.hbmColor);
            }
            if !info.hbmMask.is_null() {
                DeleteObject(info.hbmMask);
            }
            DestroyIcon(large);
        }
        if side == 0 {
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

    fn image_path(pid: u32) -> Option<String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buffer = vec![0u16; 1024];
        let mut len = u32::try_from(buffer.len()).unwrap_or(0);
        let read = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut len,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        read.ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }

    fn description(path: &str) -> Option<String> {
        let path = HSTRING::from(path);
        let size = unsafe { GetFileVersionInfoSizeW(&path, None) };
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        unsafe { GetFileVersionInfoW(&path, None, size, data.as_mut_ptr().cast()) }.ok()?;
        let query = |key: &str| -> Option<(*const u16, u32)> {
            let mut value: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut len = 0u32;
            let found = unsafe {
                VerQueryValueW(
                    data.as_ptr().cast(),
                    &HSTRING::from(key),
                    &mut value,
                    &mut len,
                )
            };
            (found.as_bool() && !value.is_null() && len > 0)
                .then_some((value.cast_const().cast::<u16>(), len))
        };
        // Its first entry is a language and a code page, two u16s: 4 bytes.
        let (translation, _) = query("\\VarFileInfo\\Translation").filter(|&(_, len)| len >= 4)?;
        // SAFETY: those 4 bytes lie inside `data`, still alive, and the block keeps its values 4-byte aligned.
        let (lang, codepage) = unsafe { (*translation, *translation.add(1)) };
        let (text, len) = query(&format!(
            "\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"
        ))?;
        // SAFETY: the string lies inside `data`, still alive, and a string's length comes in u16s, not bytes.
        let text = unsafe { std::slice::from_raw_parts(text, len as usize) };
        let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
        let name = String::from_utf16_lossy(&text[..end]).trim().to_string();
        (!name.is_empty()).then_some(name)
    }

    #[cfg(test)]
    mod tests {
        use std::collections::HashMap;

        use super::{Process, app_name, host, roots};

        fn table(list: &[(u32, u32, &str)]) -> HashMap<u32, Process> {
            list.iter()
                .map(|&(pid, parent, exe)| {
                    let exe = exe.to_string();
                    (pid, Process { parent, exe })
                })
                .collect()
        }

        #[test]
        fn a_helper_process_leads_to_the_main_one_of_the_same_exe() {
            let processes = table(&[
                (1, 0, "explorer.exe"),
                (10, 1, "chrome.exe"),
                (11, 10, "Chrome.exe"),
                (12, 11, "chrome.exe"),
                (20, 1, "Discord.exe"),
            ]);
            // Up to the main process, not past it to explorer.exe.
            assert_eq!(roots(&[12], &processes), [10, 12]);
            // Each pid once, even when its repeats aren't side by side.
            assert_eq!(roots(&[12, 20], &processes), [10, 12, 20]);
        }

        #[test]
        fn a_webview_process_stands_for_its_host() {
            let processes = table(&[
                (1, 0, "explorer.exe"),
                (30, 1, "Teams.exe"),
                (31, 30, "msedgewebview2.exe"),
                (32, 31, "MSEdgeWebView2.exe"),
                (40, 99, "msedgewebview2.exe"),
            ]);
            assert_eq!(host(32, &processes), 30);
            assert_eq!(host(30, &processes), 30);
            // Its host is gone: the webview stands for itself.
            assert_eq!(host(40, &processes), 40);
        }

        #[test]
        fn without_a_path_the_name_is_the_exe_without_its_suffix() {
            let processes = table(&[(5, 1, "zoom.exe"), (6, 1, "SETUP.EXE")]);
            assert_eq!(app_name(5, None, &processes).as_deref(), Some("zoom"));
            assert_eq!(app_name(6, None, &processes).as_deref(), Some("SETUP"));
            assert_eq!(app_name(7, None, &processes), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn one_line_per_app_with_what_it_uses() {
        let mut since = HashMap::new();
        let apps = gather(
            &names(&["Discord", "Teams"]),
            &names(&["Teams"]),
            &mut since,
            10,
        );
        assert_eq!(apps.len(), 2);
        assert!(
            apps.iter()
                .any(|a| a.name == "Discord" && a.mic && !a.camera)
        );
        assert!(apps.iter().any(|a| a.name == "Teams" && a.mic && a.camera));
    }

    #[test]
    fn an_app_keeps_the_time_it_was_first_seen_and_starts_over_after_a_stop() {
        let mut since = HashMap::new();
        gather(&names(&["Discord"]), &[], &mut since, 10);
        let apps = gather(&names(&["Discord", "Zoom"]), &[], &mut since, 50);
        assert_eq!(
            apps.iter()
                .map(|a| (a.name.as_str(), a.since_ms))
                .collect::<Vec<_>>(),
            [("Discord", 10), ("Zoom", 50)]
        );
        gather(&[], &[], &mut since, 60);
        assert_eq!(
            gather(&names(&["Discord"]), &[], &mut since, 70)[0].since_ms,
            70
        );
    }

    #[test]
    fn two_processes_of_one_app_make_one_line() {
        let mut since = HashMap::new();
        assert_eq!(
            gather(
                &names(&["Chrome", "Chrome"]),
                &names(&["Chrome"]),
                &mut since,
                1
            )
            .len(),
            1
        );
    }
}

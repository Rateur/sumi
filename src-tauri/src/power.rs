//! The battery: the laptop's, from Windows' power manager, and the level a Bluetooth device reports, as Windows shows
//! it in its Bluetooth settings. Everything comes from Windows' events on a thread of its own, which sleeps in
//! between: plugging in, the laptop running low, a device with a battery connecting or running low. What it reads goes
//! to the page and nowhere else: nothing is logged or stored.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The low peek fires at or under this level. Settings, in 0.9, will make it a choice.
const LOW: u8 = 20;

/// A level that came this long before its device said it connected counts as read on the connection: the two
/// watchers below don't keep each other's order.
const FRESH: Duration = Duration::from_secs(5);

/// What the command bar says: the laptop's level, `None` without a battery, whether it is plugged in, the minutes
/// left when Windows knows them, and the connected devices that report a battery. Mirrored in src/lib/power.ts.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Battery {
    percent: Option<u8>,
    plugged: bool,
    minutes: Option<u32>,
    devices: Vec<Device>,
}

/// A connected device's battery. Mirrored in src/lib/power.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Device {
    name: String,
    glyph: Glyph,
    percent: u8,
}

/// What the device peek draws beside its name. Mirrored in src/lib/power.ts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Glyph {
    Headset,
    Mouse,
    Controller,
    #[default]
    Other,
}

/// The laptop running low. Mirrored in src/lib/power.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Low {
    percent: u8,
    minutes: Option<u32>,
}

/// What a reading tells the page: power://plugged, power://low, power://device or power://device-low.
#[derive(Debug, PartialEq)]
enum Peek {
    Plugged(u8),
    Low(Low),
    Device(Device),
    DeviceLow(Device),
}

/// The connected devices with a battery, as last read, for the bar.
#[derive(Default)]
pub struct Power {
    devices: Mutex<Vec<Device>>,
}

/// One read when the bar opens, not a poll.
#[tauri::command]
pub fn battery(power: tauri::State<'_, Power>) -> Battery {
    let devices = power.devices.lock().map(|d| d.clone()).unwrap_or_default();
    #[cfg(windows)]
    return Battery {
        devices,
        ..win::laptop()
    };
    #[cfg(not(windows))]
    return Battery {
        devices,
        ..Battery::default()
    };
}

/// Starts watching on a thread of its own, as the music does: Tauri's main thread is single-threaded COM. Without
/// a battery and without Bluetooth, the thread ends at once.
pub fn watch(app: &AppHandle) {
    app.manage(Power::default());
    let app = app.clone();
    std::thread::spawn(move || run(&app));
}

/// The laptop at the last reading: whether it was plugged in, and whether the low peek fired since.
#[derive(Default)]
struct Laptop {
    plugged: bool,
    warned: bool,
}

impl Laptop {
    /// Plugging in peeks, and the next discharge may warn again. On battery, the first reading at or under `LOW`
    /// warns, never only an exact match, since some PCs step by more than 1 %. Unplugging says nothing, even low:
    /// the next level does.
    fn read(&mut self, percent: u8, plugged: bool, minutes: Option<u32>) -> Option<Peek> {
        let was = std::mem::replace(&mut self.plugged, plugged);
        if plugged {
            self.warned = false;
            return (!was).then_some(Peek::Plugged(percent));
        }
        if was || percent > LOW || self.warned {
            return None;
        }
        self.warned = true;
        Some(Peek::Low(Low { percent, minutes }))
    }
}

/// A Bluetooth device, by address: what its endpoint says (name, kind, connection) and what its nodes say (level).
#[derive(Default)]
struct Gadget {
    name: String,
    /// `None` for a phone or a computer, which show their own battery.
    glyph: Option<Glyph>,
    connected: bool,
    percent: Option<u8>,
    /// When the level came, `None` for one read at launch, which may be from an earlier connection.
    read: Option<Instant>,
    /// Since it connected: whether a level came, and whether the page heard of it.
    live: bool,
    told: bool,
    /// Whether the low peek fired since the level was last above `LOW`.
    warned: bool,
}

impl Gadget {
    fn device(&self) -> Option<Device> {
        Some(Device {
            name: self.name.clone(),
            glyph: self.glyph?,
            percent: self.percent?,
        })
    }
}

/// The devices, and whether both watchers have listed what was there at launch: until then nothing peeks.
#[derive(Default)]
struct Gadgets {
    by_address: HashMap<String, Gadget>,
    ready: bool,
}

impl Gadgets {
    /// What an endpoint said: any of its name, its kind and its connection.
    fn endpoint(
        &mut self,
        address: &str,
        name: Option<String>,
        glyph: Option<Option<Glyph>>,
        connected: Option<bool>,
        now: Instant,
    ) -> Option<Peek> {
        let ready = self.ready;
        let g = self.by_address.entry(address.to_string()).or_default();
        if let Some(name) = name {
            g.name = name;
        }
        if let Some(glyph) = glyph {
            g.glyph = glyph;
        }
        let connected = connected?;
        let was = std::mem::replace(&mut g.connected, connected);
        if !connected || was {
            g.live &= connected;
            return None;
        }
        // At launch the level Windows has is the one it shows; later, only a fresh one counts.
        g.told = !ready;
        g.live = if ready {
            g.read.is_some_and(|at| now.duration_since(at) <= FRESH)
        } else {
            g.percent.is_some()
        };
        if g.live { tell(g, ready) } else { None }
    }

    /// A node's level. Windows keeps the last one of a device that left, so a level only counts while connected.
    fn level(&mut self, address: &str, percent: u8, now: Instant) -> Option<Peek> {
        let ready = self.ready;
        let g = self.by_address.entry(address.to_string()).or_default();
        g.percent = Some(percent);
        g.read = ready.then_some(now);
        if percent > LOW {
            g.warned = false;
        }
        if !g.connected {
            return None;
        }
        g.live = true;
        tell(g, ready)
    }

    /// The connected devices whose level came while connected, by name.
    fn connected(&self) -> Vec<Device> {
        let mut devices: Vec<Device> = self
            .by_address
            .values()
            .filter(|g| g.connected && g.live)
            .filter_map(Gadget::device)
            .collect();
        devices.sort_by(|a, b| a.name.cmp(&b.name));
        devices
    }
}

/// A level that just came on a connection: the low peek once per discharge, otherwise the device peek once per
/// connection. Nothing for what was there at launch, nor for a phone or a computer.
fn tell(g: &mut Gadget, ready: bool) -> Option<Peek> {
    let device = g.device().filter(|_| ready)?;
    if device.percent <= LOW && !g.warned {
        g.warned = true;
        g.told = true;
        return Some(Peek::DeviceLow(device));
    }
    if g.told {
        return None;
    }
    g.told = true;
    Some(Peek::Device(device))
}

/// The Bluetooth address in an endpoint's or a node's id: its last run of exactly 12 hex digits, colons dropped.
/// `Bluetooth#Bluetooth00:45:e2:3b:f6:80-d8:f0:c0:83:4a:ff` and `BTHENUM\{…}_VID&…\7&cd23df0&0&D8F0C0834AFF_C00000000`
/// are both D8F0C0834AFF.
fn address(id: &str) -> Option<String> {
    id.replace(':', "")
        .split(|c: char| !c.is_ascii_hexdigit())
        .rfind(|run| run.len() == 12)
        .map(str::to_ascii_uppercase)
}

/// The glyph for the categories Windows files a device under, such as `Communication.Headset.Bluetooth` or
/// `Input.Gaming`. `None` for a phone or a computer.
fn glyph(categories: &[String]) -> Option<Glyph> {
    let has = |prefix: &str| categories.iter().any(|c| c.starts_with(prefix));
    if has("Communication.Phone") || has("Computer") {
        return None;
    }
    Some(if has("Communication.Headset") || has("Audio.Head") {
        Glyph::Headset
    } else if has("Input.Mouse") {
        Glyph::Mouse
    } else if has("Input.Gaming") {
        Glyph::Controller
    } else {
        Glyph::Other
    })
}

/// Minutes from Windows' 100 ns ticks. Windows gives the largest value when it doesn't know.
fn minutes(ticks: i64) -> Option<u32> {
    if ticks <= 0 || ticks == i64::MAX {
        return None;
    }
    u32::try_from(ticks / 600_000_000).ok().filter(|&m| m > 0)
}

#[cfg(not(windows))]
fn run(_: &AppHandle) {}

#[cfg(windows)]
fn run(app: &AppHandle) {
    win::run(app);
}

#[cfg(windows)]
mod win {
    use std::sync::mpsc::{Sender, channel};
    use std::time::Instant;

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
    };
    use windows::Foundation::{EventHandler, IPropertyValue, TypedEventHandler};
    use windows::System::Power::{BatteryStatus, PowerManager, PowerSupplyStatus};
    use windows::core::{Array, HSTRING, IInspectable, Interface};
    use windows_collections::{IIterable, IMapView};

    use super::{Battery, Gadgets, Glyph, Laptop, Peek, Power, address, glyph, minutes};

    /// The level Windows shows in its Bluetooth settings, on a device's own nodes.
    const LEVEL: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
    const CONNECTED: &str = "System.Devices.Aep.IsConnected";
    const CATEGORY: &str = "System.Devices.Aep.Category";
    /// Paired devices only, Bluetooth and Bluetooth LE: without the pairing, the watcher would scan the air.
    const PAIRED: &str = "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR \
        System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\") AND \
        System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True";
    /// The nodes Bluetooth makes for a device. AQS can't filter on the level itself.
    const NODES: &str = "System.Devices.DeviceInstanceId:~<\"BTH\"";

    enum Msg {
        /// The laptop's supply or level changed.
        Laptop,
        Endpoint {
            address: String,
            name: Option<String>,
            glyph: Option<Option<Glyph>>,
            connected: Option<bool>,
        },
        /// An endpoint was unpaired.
        Gone(String),
        Level(String, u8),
        /// A watcher listed what was there at launch.
        Listed,
    }

    fn plugged() -> bool {
        PowerManager::PowerSupplyStatus().is_ok_and(|s| s != PowerSupplyStatus::NotPresent)
    }

    fn present() -> bool {
        PowerManager::BatteryStatus().is_ok_and(|s| s != BatteryStatus::NotPresent)
    }

    fn percent() -> Option<u8> {
        let p = PowerManager::RemainingChargePercent().ok()?;
        u8::try_from(p.clamp(0, 100)).ok()
    }

    /// The laptop now: nothing without a battery, and the minutes left only on battery.
    pub(super) fn laptop() -> Battery {
        if !present() {
            return Battery::default();
        }
        let plugged = plugged();
        Battery {
            percent: percent(),
            plugged,
            minutes: if plugged { None } else { left() },
            devices: Vec::new(),
        }
    }

    pub(super) fn run(app: &AppHandle) {
        let (tx, rx) = channel();
        // Read once at launch: a PC without a battery hears nothing from the power manager.
        let mut laptop = Laptop {
            plugged: plugged(),
            warned: false,
        };
        let mut heard = false;
        if present() {
            let ping = || {
                let tx = tx.clone();
                EventHandler::<IInspectable>::new(move |_, _| {
                    let _ = tx.send(Msg::Laptop);
                    Ok(())
                })
            };
            heard = PowerManager::PowerSupplyStatusChanged(&ping())
                .and_then(|_| PowerManager::RemainingChargePercentChanged(&ping()))
                .inspect_err(|e| log::warn!("power: the battery can't be heard: {e}"))
                .is_ok();
        }
        // The watchers live as long as the loop, and with them their handlers. One without the other is no use.
        let watchers = endpoints(&tx)
            .and_then(|e| nodes(&tx).inspect_err(|_| drop(e.Stop())).map(|n| (e, n)))
            .inspect_err(|e| log::warn!("power: Bluetooth levels can't be heard: {e}"));
        drop(tx);
        if watchers.is_err() && !heard {
            return;
        }
        let mut gadgets = Gadgets::default();
        let mut listed = 0;
        while let Ok(msg) = rx.recv() {
            let now = Instant::now();
            let peek = match msg {
                Msg::Laptop => read(&mut laptop),
                Msg::Endpoint {
                    address,
                    name,
                    glyph,
                    connected,
                } => gadgets.endpoint(&address, name, glyph, connected, now),
                Msg::Gone(address) => {
                    gadgets.by_address.remove(&address);
                    None
                }
                Msg::Level(address, percent) => gadgets.level(&address, percent, now),
                Msg::Listed => {
                    listed += 1;
                    gadgets.ready = listed == 2;
                    None
                }
            };
            if let Ok(mut devices) = app.state::<Power>().devices.lock() {
                *devices = gadgets.connected();
            }
            if let Some(peek) = peek {
                emit(app, peek);
            }
        }
    }

    fn left() -> Option<u32> {
        PowerManager::RemainingDischargeTime()
            .ok()
            .and_then(|t| minutes(t.Duration))
    }

    fn read(laptop: &mut Laptop) -> Option<Peek> {
        let plugged = plugged();
        laptop.read(percent()?, plugged, if plugged { None } else { left() })
    }

    fn emit(app: &AppHandle, peek: Peek) {
        let _ = match peek {
            Peek::Plugged(percent) => app.emit("power://plugged", percent),
            Peek::Low(low) => app.emit("power://low", low),
            Peek::Device(device) => app.emit("power://device", device),
            Peek::DeviceLow(device) => app.emit("power://device-low", device),
        };
    }

    fn props(keys: &[&str]) -> IIterable<HSTRING> {
        IIterable::from(keys.iter().map(|&k| HSTRING::from(k)).collect::<Vec<_>>())
    }

    fn value(props: &IMapView<HSTRING, IInspectable>, key: &str) -> Option<IPropertyValue> {
        props.Lookup(&HSTRING::from(key)).ok()?.cast().ok()
    }

    fn categories(props: &IMapView<HSTRING, IInspectable>) -> Option<Option<Glyph>> {
        let mut out = Array::<HSTRING>::new();
        value(props, CATEGORY)?.GetStringArray(&mut out).ok()?;
        Some(glyph(
            &out.iter().map(|c| c.to_string()).collect::<Vec<_>>(),
        ))
    }

    /// Handlers run on Windows' thread pool: they read what came with the event and post it, nothing more.
    fn endpoints(tx: &Sender<Msg>) -> windows::core::Result<DeviceWatcher> {
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from(PAIRED),
            &props(&[CONNECTED, CATEGORY]),
            DeviceInformationKind::AssociationEndpoint,
        )?;
        let send = tx.clone();
        watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                let Some(info) = info.as_ref() else {
                    return Ok(());
                };
                let props = info.Properties()?;
                if let Some(address) = address(&info.Id()?.to_string()) {
                    let _ = send.send(Msg::Endpoint {
                        address,
                        name: info.Name().ok().map(|n| n.to_string()),
                        glyph: categories(&props),
                        connected: value(&props, CONNECTED).and_then(|v| v.GetBoolean().ok()),
                    });
                }
                Ok(())
            },
        ))?;
        let send = tx.clone();
        watcher.Updated(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                let Some(update) = update.as_ref() else {
                    return Ok(());
                };
                let props = update.Properties()?;
                if let Some(address) = address(&update.Id()?.to_string()) {
                    let _ = send.send(Msg::Endpoint {
                        address,
                        name: None,
                        glyph: categories(&props),
                        connected: value(&props, CONNECTED).and_then(|v| v.GetBoolean().ok()),
                    });
                }
                Ok(())
            }),
        )?;
        let send = tx.clone();
        watcher.Removed(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                if let Some(address) = update
                    .as_ref()
                    .and_then(|u| address(&u.Id().ok()?.to_string()))
                {
                    let _ = send.send(Msg::Gone(address));
                }
                Ok(())
            }),
        )?;
        listed(&watcher, tx)?;
        watcher.Start()?;
        Ok(watcher)
    }

    fn nodes(tx: &Sender<Msg>) -> windows::core::Result<DeviceWatcher> {
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from(NODES),
            &props(&[LEVEL]),
            DeviceInformationKind::Device,
        )?;
        let level =
            |id: windows::core::Result<HSTRING>,
             props: windows::core::Result<IMapView<HSTRING, IInspectable>>| {
                let percent = value(&props.ok()?, LEVEL)?.GetUInt8().ok()?;
                Some(Msg::Level(
                    address(&id.ok()?.to_string())?,
                    percent.min(100),
                ))
            };
        let send = tx.clone();
        watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                if let Some(msg) = info.as_ref().and_then(|i| level(i.Id(), i.Properties())) {
                    let _ = send.send(msg);
                }
                Ok(())
            },
        ))?;
        let send = tx.clone();
        watcher.Updated(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                if let Some(msg) = update.as_ref().and_then(|u| level(u.Id(), u.Properties())) {
                    let _ = send.send(msg);
                }
                Ok(())
            }),
        )?;
        // Windows sends no update after the initial list to a watcher that doesn't hear removals too. An unpaired
        // device's endpoint goes as well, and that one says it.
        watcher.Removed(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(|_, _| Ok(())),
        )?;
        listed(&watcher, tx)?;
        watcher.Start()?;
        Ok(watcher)
    }

    fn listed(watcher: &DeviceWatcher, tx: &Sender<Msg>) -> windows::core::Result<()> {
        let send = tx.clone();
        watcher.EnumerationCompleted(&TypedEventHandler::<DeviceWatcher, IInspectable>::new(
            move |_, _| {
                let _ = send.send(Msg::Listed);
                Ok(())
            },
        ))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{Device, Gadgets, Glyph, LOW, Laptop, Low, Peek, address, glyph, minutes};

    #[test]
    fn plugging_in_peeks_and_unplugging_says_nothing() {
        let mut laptop = Laptop::default();
        assert_eq!(laptop.read(47, true, None), Some(Peek::Plugged(47)));
        assert_eq!(laptop.read(48, true, None), None);
        assert_eq!(laptop.read(48, false, Some(200)), None);
    }

    #[test]
    fn warns_once_per_discharge_at_the_first_reading_under_the_line() {
        let mut laptop = Laptop::default();
        assert_eq!(laptop.read(LOW + 1, false, None), None);
        // A PC that steps by 2 % never reads 20.
        let low = Low {
            percent: LOW - 1,
            minutes: Some(65),
        };
        assert_eq!(laptop.read(LOW - 1, false, Some(65)), Some(Peek::Low(low)));
        assert_eq!(laptop.read(LOW - 3, false, Some(50)), None);
        // Plugging in starts a new discharge.
        laptop.read(LOW - 3, true, None);
        laptop.read(LOW - 3, false, None);
        assert!(matches!(
            laptop.read(LOW - 4, false, None),
            Some(Peek::Low(_))
        ));
    }

    #[test]
    fn unplugging_low_says_nothing_until_the_next_level() {
        let mut laptop = Laptop {
            plugged: true,
            warned: false,
        };
        assert_eq!(laptop.read(15, false, None), None);
        assert!(matches!(laptop.read(14, false, None), Some(Peek::Low(_))));
    }

    #[test]
    fn launch_on_mains_is_no_plug_in() {
        let mut laptop = Laptop {
            plugged: true,
            warned: false,
        };
        assert_eq!(laptop.read(80, true, None), None);
    }

    #[test]
    fn finds_the_address_in_an_endpoint_and_its_nodes() {
        let headset = Some("D8F0C0834AFF".to_string());
        assert_eq!(
            address("Bluetooth#Bluetooth00:45:e2:3b:f6:80-d8:f0:c0:83:4a:ff"),
            headset
        );
        assert_eq!(
            address(
                r"BTHENUM\{0000111e-0000-1000-8000-00805f9b34fb}_VID&000105d6_PID&000a\7&cd23df0&0&D8F0C0834AFF_C00000000"
            ),
            headset
        );
        assert_eq!(
            address(r"BTHENUM\Dev_D8F0C0834AFF\7&cd23df0&0&BluetoothDevice_D8F0C0834AFF"),
            headset
        );
        assert_eq!(
            address(
                r"BTHLEDevice\{9fa480e0-4967-4542-9390-d343dc5d04ae}_5abc3518f430\8&2d944a55&1&0014"
            ),
            Some("5ABC3518F430".to_string())
        );
        assert_eq!(address(r"BTHHFENUM\BthHFPAudio\8&2b389efe&1&97"), None);
    }

    #[test]
    fn draws_headsets_mice_and_controllers_and_leaves_phones_out() {
        let of = |c: &[&str]| glyph(&c.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(
            of(&["Communication.Headset.Bluetooth", "Audio"]),
            Some(Glyph::Headset)
        );
        assert_eq!(of(&["Input.Mouse"]), Some(Glyph::Mouse));
        assert_eq!(of(&["Input.Gaming"]), Some(Glyph::Controller));
        assert_eq!(of(&["Audio.Speakers"]), Some(Glyph::Other));
        assert_eq!(of(&[]), Some(Glyph::Other));
        assert_eq!(of(&["Communication.Phone", "Audio"]), None);
        assert_eq!(of(&["Computer.Notebook"]), None);
    }

    #[test]
    fn reads_minutes_and_knows_when_windows_does_not() {
        assert_eq!(minutes(65 * 600_000_000), Some(65));
        assert_eq!(minutes(i64::MAX), None);
        assert_eq!(minutes(0), None);
        assert_eq!(minutes(-1), None);
    }

    fn headset(percent: u8) -> Device {
        Device {
            name: "Casque".into(),
            glyph: Glyph::Headset,
            percent,
        }
    }

    /// A headset paired before launch, last seen at `percent`, listed while away.
    fn listed(percent: u8) -> (Gadgets, Instant) {
        let mut g = Gadgets::default();
        let t = Instant::now();
        g.endpoint(
            "A",
            Some("Casque".into()),
            Some(Some(Glyph::Headset)),
            Some(false),
            t,
        );
        g.level("A", percent, t);
        g.ready = true;
        (g, t)
    }

    #[test]
    fn a_device_peeks_with_the_level_that_comes_after_it_connects() {
        let (mut g, t) = listed(90);
        // The level Windows kept from last time is no news.
        assert_eq!(g.endpoint("A", None, None, Some(true), t), None);
        assert!(g.connected().is_empty());
        assert_eq!(g.level("A", 60, t), Some(Peek::Device(headset(60))));
        assert_eq!(g.level("A", 59, t), None);
        assert_eq!(g.connected(), vec![headset(59)]);
    }

    #[test]
    fn a_level_just_before_the_connection_counts() {
        let (mut g, t) = listed(90);
        assert_eq!(g.level("A", 80, t), None);
        let later = t + Duration::from_secs(1);
        assert_eq!(
            g.endpoint("A", None, None, Some(true), later),
            Some(Peek::Device(headset(80)))
        );
        // Long after, it would be the last connection's.
        g.endpoint("A", None, None, Some(false), later);
        let much_later = later + Duration::from_secs(60);
        assert_eq!(g.endpoint("A", None, None, Some(true), much_later), None);
    }

    #[test]
    fn a_device_warns_once_per_discharge() {
        let (mut g, t) = listed(90);
        g.endpoint("A", None, None, Some(true), t);
        assert_eq!(g.level("A", 25, t), Some(Peek::Device(headset(25))));
        assert_eq!(g.level("A", 18, t), Some(Peek::DeviceLow(headset(18))));
        assert_eq!(g.level("A", 15, t), None);
        // Back after a moment, still low: a plain peek.
        g.endpoint("A", None, None, Some(false), t);
        g.endpoint("A", None, None, Some(true), t + Duration::from_secs(60));
        assert_eq!(g.level("A", 15, t), Some(Peek::Device(headset(15))));
        // Charged, then low again.
        g.level("A", 80, t);
        assert_eq!(g.level("A", 20, t), Some(Peek::DeviceLow(headset(20))));
    }

    #[test]
    fn what_was_there_at_launch_shows_in_the_bar_without_a_peek() {
        let mut g = Gadgets::default();
        let t = Instant::now();
        assert_eq!(g.level("A", 70, t), None);
        assert_eq!(
            g.endpoint(
                "A",
                Some("Casque".into()),
                Some(Some(Glyph::Headset)),
                Some(true),
                t
            ),
            None
        );
        g.ready = true;
        assert_eq!(g.connected(), vec![headset(70)]);
        assert_eq!(g.level("A", 69, t), None);
    }

    #[test]
    fn a_phone_never_peeks() {
        let mut g = Gadgets::default();
        let t = Instant::now();
        g.ready = true;
        g.endpoint("P", Some("iPhone".into()), Some(None), Some(true), t);
        assert_eq!(g.level("P", 10, t), None);
        assert!(g.connected().is_empty());
    }
}

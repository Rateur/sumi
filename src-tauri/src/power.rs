//! The battery: the laptop's, from Windows' power manager, and the level a Bluetooth device reports, as Windows shows
//! it in its Bluetooth settings. Everything comes from Windows' events on a thread of its own, which sleeps in
//! between: plugging in, the laptop running low, a device with a battery connecting or running low, and what the
//! batteries panel shows. What it reads goes to the page and nowhere else: nothing is logged or stored.

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

/// The time to full shows once the PC has been on mains this long, while the charge rate settles.
const SETTLE: Duration = Duration::from_secs(120);

/// What the bar and the batteries panel show: the laptop's level, `None` without a battery, whether it is plugged
/// in, the minutes left on battery and to full on mains when Windows knows them, energy saver, and the connected
/// devices that report a battery. Mirrored in src/lib/power.ts.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Battery {
    percent: Option<u8>,
    plugged: bool,
    minutes: Option<u32>,
    full: Option<u32>,
    saver: bool,
    devices: Vec<Device>,
}

/// A connected device's battery. Mirrored in src/lib/power.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Device {
    name: String,
    kind: Kind,
    percent: u8,
}

/// What a device is, for its glyph and its place in the panel. Mirrored in src/lib/power.ts.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Headset,
    Speaker,
    Controller,
    Mouse,
    Keyboard,
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

/// The connected devices with a battery as last read, and since when the PC has been on mains, `None` from before
/// launch or on battery.
#[derive(Default)]
pub struct Power {
    devices: Mutex<Vec<Device>>,
    since: Mutex<Option<Instant>>,
}

impl Power {
    fn now(&self) -> Battery {
        let devices = self.devices.lock().map(|d| d.clone()).unwrap_or_default();
        #[cfg_attr(not(windows), allow(unused_variables))]
        let settled = self
            .since
            .lock()
            .map(|s| s.is_none_or(|t| t.elapsed() >= SETTLE))
            .unwrap_or(true);
        #[cfg(windows)]
        return Battery {
            devices,
            ..win::laptop(settled)
        };
        #[cfg(not(windows))]
        return Battery {
            devices,
            ..Battery::default()
        };
    }
}

/// One read as the bar or the panel opens, not a poll: power://battery brings what changes after.
#[tauri::command]
pub fn battery(power: tauri::State<'_, Power>) -> Battery {
    power.now()
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
    /// `None` for a phone or a computer, which show their own battery, and until the endpoint is heard.
    kind: Option<Kind>,
    connected: bool,
    percent: Option<u8>,
    /// When the level came, `None` for one read at launch, which may be from an earlier connection.
    read: Option<Instant>,
    /// Since it connected: whether a level came, and whether the page heard of it.
    live: bool,
    told: bool,
    /// Whether the low warning came since the level was last above `LOW`.
    warned: bool,
}

impl Gadget {
    fn device(&self) -> Option<Device> {
        Some(Device {
            name: self.name.clone(),
            kind: self.kind?,
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
        kind: Option<Option<Kind>>,
        connected: Option<bool>,
        now: Instant,
    ) -> Option<Peek> {
        let ready = self.ready;
        let g = self.by_address.entry(address.to_string()).or_default();
        if let Some(name) = name {
            g.name = name;
        }
        if let Some(kind) = kind {
            g.kind = kind;
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

    /// The connected devices whose level came while connected. The page puts them in order.
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

/// A level that just came. The first one on a connection peeks, red at `LOW` or under, which counts as the low
/// warning; a mouse or a keyboard reconnects each time it wakes, so it peeks only that low. After that, the low peek
/// once per discharge. Nothing for what was there at launch, nor for a phone or a computer.
fn tell(g: &mut Gadget, ready: bool) -> Option<Peek> {
    let device = g.device().filter(|_| ready)?;
    let low = device.percent <= LOW && !g.warned;
    g.warned |= low;
    if !std::mem::replace(&mut g.told, true) {
        let quiet = matches!(device.kind, Kind::Mouse | Kind::Keyboard);
        return match (quiet, low) {
            (false, _) => Some(Peek::Device(device)),
            (true, true) => Some(Peek::DeviceLow(device)),
            (true, false) => None,
        };
    }
    low.then_some(Peek::DeviceLow(device))
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

/// What a device is, from its Bluetooth Class of Device (major, minor), its Bluetooth LE Appearance, then the
/// categories Windows files it under. `None` for a phone or a computer.
fn kind(cod: Option<(u32, u32)>, appearance: Option<u32>, categories: &[String]) -> Option<Kind> {
    let has = |prefix: &str| categories.iter().any(|c| c.starts_with(prefix));
    let phone = matches!(cod, Some((1 | 2, _)))
        || appearance.is_some_and(|a| matches!(a >> 6, 1 | 2))
        || has("Communication.Phone")
        || has("Computer");
    if phone {
        return None;
    }
    let by_cod = cod.and_then(|(major, minor)| match (major, minor) {
        // Audio and video: wearable headset, headphones, loudspeaker.
        (4, 1 | 6) => Some(Kind::Headset),
        (4, 5) => Some(Kind::Speaker),
        // Peripheral: joystick or gamepad, then keyboard, pointing device, or both.
        (5, m) if matches!(m & 0x0f, 1 | 2) => Some(Kind::Controller),
        (5, m) if (m >> 4) & 3 == 2 => Some(Kind::Mouse),
        (5, m) if (m >> 4) & 3 != 0 => Some(Kind::Keyboard),
        _ => None,
    });
    let by_appearance = appearance.and_then(|a| match a {
        0x03c1 => Some(Kind::Keyboard),
        0x03c2 => Some(Kind::Mouse),
        0x03c3 | 0x03c4 => Some(Kind::Controller),
        0x0841 => Some(Kind::Speaker),
        // Earbuds, headset, headphones.
        0x0941..=0x0943 => Some(Kind::Headset),
        _ => None,
    });
    let by_category = if has("Communication.Headset") || has("Audio.Head") {
        Some(Kind::Headset)
    } else if has("Audio.Speakers") {
        Some(Kind::Speaker)
    } else if has("Input.Gaming") {
        Some(Kind::Controller)
    } else if has("Input.Mouse") {
        Some(Kind::Mouse)
    } else if has("Input.Keyboard") {
        Some(Kind::Keyboard)
    } else {
        None
    };
    Some(
        by_cod
            .or(by_appearance)
            .or(by_category)
            .unwrap_or(Kind::Other),
    )
}

/// Minutes from Windows' 100 ns ticks. Windows gives the largest value when it doesn't know.
fn minutes(ticks: i64) -> Option<u32> {
    if ticks <= 0 || ticks == i64::MAX {
        return None;
    }
    u32::try_from(ticks / 600_000_000).ok().filter(|&m| m > 0)
}

/// Minutes to full from the battery's report in mWh and mW, rounded up to 10 so it doesn't flicker, once the charge
/// has `settled`. `None` without a charge rate: the page says "Plugged in".
fn to_full(full: i32, remaining: i32, rate: i32, settled: bool) -> Option<u32> {
    if !settled || rate <= 0 || full <= remaining {
        return None;
    }
    let (gap, rate) = (
        u64::try_from(full - remaining).ok()?,
        u64::try_from(rate).ok()?,
    );
    u32::try_from((gap * 60).div_ceil(rate).div_ceil(10) * 10).ok()
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
    use windows::System::Power::{
        BatteryStatus, EnergySaverStatus, PowerManager, PowerSupplyStatus,
    };
    use windows::core::{Array, HSTRING, IInspectable, Interface};
    use windows_collections::{IIterable, IMapView};

    use super::{Battery, Gadgets, Kind, Laptop, Peek, Power, address, kind, minutes, to_full};

    /// The level Windows shows in its Bluetooth settings, on a device's own nodes.
    const LEVEL: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
    const CONNECTED: &str = "System.Devices.Aep.IsConnected";
    const MAJOR: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
    const MINOR: &str = "System.Devices.Aep.Bluetooth.Cod.Minor";
    const APPEARANCE: &str = "System.Devices.Aep.Bluetooth.Le.Appearance";
    const CATEGORY: &str = "System.Devices.Aep.Category";
    /// Paired devices only, Bluetooth and Bluetooth LE: without the pairing, the watcher would scan the air.
    const PAIRED: &str = "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR \
        System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\") AND \
        System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True";
    /// The nodes Bluetooth makes for a device. AQS can't filter on the level itself.
    const NODES: &str = "System.Devices.DeviceInstanceId:~<\"BTH\"";

    enum Msg {
        /// The laptop's supply, level or energy saver changed.
        Laptop,
        Endpoint {
            address: String,
            name: Option<String>,
            kind: Option<Option<Kind>>,
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

    fn left() -> Option<u32> {
        PowerManager::RemainingDischargeTime()
            .ok()
            .and_then(|t| minutes(t.Duration))
    }

    /// From the battery's own report: Windows gives no time to full.
    fn full(settled: bool) -> Option<u32> {
        let report = windows::Devices::Power::Battery::AggregateBattery()
            .and_then(|b| b.GetReport())
            .ok()?;
        let read = |v: windows::core::Result<windows::Foundation::IReference<i32>>| {
            v.and_then(|v| v.Value()).ok()
        };
        to_full(
            read(report.FullChargeCapacityInMilliwattHours())?,
            read(report.RemainingCapacityInMilliwattHours())?,
            read(report.ChargeRateInMilliwatts())?,
            settled,
        )
    }

    /// The laptop now: nothing without a battery, the minutes left on battery, and to full on mains.
    pub(super) fn laptop(settled: bool) -> Battery {
        if !present() {
            return Battery::default();
        }
        let plugged = plugged();
        Battery {
            percent: percent(),
            plugged,
            minutes: if plugged { None } else { left() },
            full: if plugged { full(settled) } else { None },
            saver: PowerManager::EnergySaverStatus().is_ok_and(|s| s == EnergySaverStatus::On),
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
                .and_then(|_| PowerManager::EnergySaverStatusChanged(&ping()))
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
        let power = app.state::<Power>();
        let mut gadgets = Gadgets {
            ready: watchers.is_err(),
            ..Gadgets::default()
        };
        let mut listed = 0;
        let mut shown = None;
        while let Ok(msg) = rx.recv() {
            let now = Instant::now();
            let peek = match msg {
                Msg::Laptop => read(&mut laptop, &power, now),
                Msg::Endpoint {
                    address,
                    name,
                    kind,
                    connected,
                } => gadgets.endpoint(&address, name, kind, connected, now),
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
            if let Ok(mut devices) = power.devices.lock() {
                *devices = gadgets.connected();
            }
            if let Some(peek) = peek {
                emit(app, peek);
            }
            // What an open panel shows, sent only when it changed.
            if gadgets.ready {
                let now = Some(power.now());
                if now != shown {
                    let _ = app.emit("power://battery", &now);
                    shown = now;
                }
            }
        }
    }

    /// Reads the laptop after an event, and keeps when it was plugged in for the time to full.
    fn read(laptop: &mut Laptop, power: &Power, now: Instant) -> Option<Peek> {
        let plugged = plugged();
        if plugged != laptop.plugged
            && let Ok(mut since) = power.since.lock()
        {
            *since = plugged.then_some(now);
        }
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

    /// A number Windows keeps as a byte or a short: the property value converts it.
    fn number(props: &IMapView<HSTRING, IInspectable>, key: &str) -> Option<u32> {
        value(props, key)?.GetUInt32().ok()
    }

    fn kind_of(props: &IMapView<HSTRING, IInspectable>) -> Option<Kind> {
        let mut categories = Array::<HSTRING>::new();
        let categories = value(props, CATEGORY)
            .and_then(|v| v.GetStringArray(&mut categories).ok())
            .map(|()| categories.iter().map(|c| c.to_string()).collect::<Vec<_>>())
            .unwrap_or_default();
        let cod = number(props, MAJOR).zip(number(props, MINOR));
        kind(cod, number(props, APPEARANCE), &categories)
    }

    /// Handlers run on Windows' thread pool: they read what came with the event and post it, nothing more.
    fn endpoints(tx: &Sender<Msg>) -> windows::core::Result<DeviceWatcher> {
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from(PAIRED),
            &props(&[CONNECTED, MAJOR, MINOR, APPEARANCE, CATEGORY]),
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
                        kind: Some(kind_of(&props)),
                        connected: value(&props, CONNECTED).and_then(|v| v.GetBoolean().ok()),
                    });
                }
                Ok(())
            },
        ))?;
        // An update carries what changed: the connection. What a device is doesn't change.
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
                        kind: None,
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

    use super::{Device, Gadgets, Kind, LOW, Laptop, Low, Peek, address, kind, minutes, to_full};

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
    fn tells_devices_apart_by_class_appearance_then_category() {
        let none: &[String] = &[];
        // As this PC's devices read: a headset, a speaker, a controller.
        assert_eq!(kind(Some((4, 1)), None, none), Some(Kind::Headset));
        assert_eq!(kind(Some((4, 6)), None, none), Some(Kind::Headset));
        assert_eq!(kind(Some((4, 5)), None, none), Some(Kind::Speaker));
        assert_eq!(kind(Some((5, 2)), None, none), Some(Kind::Controller));
        assert_eq!(kind(Some((5, 0b10_0000)), None, none), Some(Kind::Mouse));
        assert_eq!(kind(Some((5, 0b01_0000)), None, none), Some(Kind::Keyboard));
        assert_eq!(kind(None, Some(0x03c1), none), Some(Kind::Keyboard));
        assert_eq!(kind(None, Some(0x03c2), none), Some(Kind::Mouse));
        assert_eq!(kind(None, Some(0x03c4), none), Some(Kind::Controller));
        assert_eq!(kind(None, Some(0x0841), none), Some(Kind::Speaker));
        assert_eq!(kind(None, Some(0x0941), none), Some(Kind::Headset));
        assert_eq!(kind(None, Some(0x0943), none), Some(Kind::Headset));
        let headset = ["Communication.Headset.Bluetooth".to_string()];
        assert_eq!(kind(None, None, &headset), Some(Kind::Headset));
        assert_eq!(kind(Some((4, 10)), None, none), Some(Kind::Other));
        assert_eq!(kind(None, None, none), Some(Kind::Other));
    }

    #[test]
    fn leaves_phones_and_computers_out() {
        let none: &[String] = &[];
        assert_eq!(kind(Some((2, 3)), None, none), None);
        assert_eq!(kind(Some((1, 3)), None, none), None);
        // The iPhone's Bluetooth LE endpoint, as this PC reads it.
        assert_eq!(kind(None, Some(64), none), None);
        assert_eq!(kind(None, Some(0x0080), none), None);
        assert_eq!(kind(None, None, &["Communication.Phone".to_string()]), None);
    }

    #[test]
    fn reads_minutes_and_knows_when_windows_does_not() {
        assert_eq!(minutes(65 * 600_000_000), Some(65));
        assert_eq!(minutes(i64::MAX), None);
        assert_eq!(minutes(0), None);
        assert_eq!(minutes(-1), None);
    }

    #[test]
    fn rounds_the_time_to_full_up_to_ten_minutes_once_settled() {
        // 20 Wh to go at 30 W: 40 minutes.
        assert_eq!(to_full(45_000, 25_000, 30_000, true), Some(40));
        // 41 minutes reads 50.
        assert_eq!(to_full(45_000, 24_500, 30_000, true), Some(50));
        assert_eq!(to_full(45_000, 25_000, 30_000, false), None);
        // This PC, full and idle: no rate.
        assert_eq!(to_full(35_350, 35_170, 0, true), None);
        assert_eq!(to_full(45_000, 45_000, 1_000, true), None);
    }

    fn device(kind: Kind, percent: u8) -> Device {
        Device {
            name: "Casque".into(),
            kind,
            percent,
        }
    }

    /// A device paired before launch, last seen at `percent`, listed while away.
    fn listed(kind: Kind, percent: u8) -> (Gadgets, Instant) {
        let mut g = Gadgets::default();
        let t = Instant::now();
        g.endpoint("A", Some("Casque".into()), Some(Some(kind)), Some(false), t);
        g.level("A", percent, t);
        g.ready = true;
        (g, t)
    }

    #[test]
    fn a_device_peeks_with_the_level_that_comes_after_it_connects() {
        let (mut g, t) = listed(Kind::Headset, 90);
        // The level Windows kept from last time is no news.
        assert_eq!(g.endpoint("A", None, None, Some(true), t), None);
        assert!(g.connected().is_empty());
        let headset = |p| device(Kind::Headset, p);
        assert_eq!(g.level("A", 60, t), Some(Peek::Device(headset(60))));
        assert_eq!(g.level("A", 59, t), None);
        assert_eq!(g.connected(), vec![headset(59)]);
    }

    #[test]
    fn a_level_just_before_the_connection_counts() {
        let (mut g, t) = listed(Kind::Headset, 90);
        assert_eq!(g.level("A", 80, t), None);
        let later = t + Duration::from_secs(1);
        assert_eq!(
            g.endpoint("A", None, None, Some(true), later),
            Some(Peek::Device(device(Kind::Headset, 80)))
        );
        // Long after, it would be the last connection's.
        g.endpoint("A", None, None, Some(false), later);
        let much_later = later + Duration::from_secs(60);
        assert_eq!(g.endpoint("A", None, None, Some(true), much_later), None);
    }

    #[test]
    fn a_device_warns_once_per_discharge() {
        let (mut g, t) = listed(Kind::Headset, 90);
        let headset = |p| device(Kind::Headset, p);
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
    fn connecting_low_is_the_low_warning() {
        let (mut g, t) = listed(Kind::Controller, 90);
        g.endpoint("A", None, None, Some(true), t);
        assert_eq!(
            g.level("A", 15, t),
            Some(Peek::Device(device(Kind::Controller, 15)))
        );
        assert_eq!(g.level("A", 14, t), None);
    }

    #[test]
    fn a_mouse_or_a_keyboard_peeks_only_when_low() {
        for k in [Kind::Mouse, Kind::Keyboard] {
            let (mut g, t) = listed(k, 90);
            g.endpoint("A", None, None, Some(true), t);
            assert_eq!(g.level("A", 52, t), None);
            assert_eq!(g.level("A", 19, t), Some(Peek::DeviceLow(device(k, 19))));
            // Waking up low says it once.
            let (mut g, t) = listed(k, 90);
            g.endpoint("A", None, None, Some(true), t);
            assert_eq!(g.level("A", 12, t), Some(Peek::DeviceLow(device(k, 12))));
            assert_eq!(g.level("A", 11, t), None);
        }
    }

    #[test]
    fn what_was_there_at_launch_shows_in_the_panel_without_a_peek() {
        let mut g = Gadgets::default();
        let t = Instant::now();
        assert_eq!(g.level("A", 70, t), None);
        assert_eq!(
            g.endpoint(
                "A",
                Some("Casque".into()),
                Some(Some(Kind::Headset)),
                Some(true),
                t
            ),
            None
        );
        g.ready = true;
        assert_eq!(g.connected(), vec![device(Kind::Headset, 70)]);
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

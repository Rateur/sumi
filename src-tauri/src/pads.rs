//! The battery of Nintendo's Switch Pro Controller and Sony's DualShock 4 and DualSense on Bluetooth, which give
//! Windows none. They are read from their HID reports, shared with every other app: Steam and games keep theirs.
//! Nothing that changes how a controller works is ever sent. The Pro Controller is asked for its "device info",
//! whose reply carries the level; a PlayStation controller is only listened to, and its level is in the full reports
//! Steam or a game turns on: without them, it stays without a level. A controller is read as it connects and every 5
//! minutes while it stays. With none, the thread sleeps. Byte layouts from dekuNukem's Nintendo Switch reverse
//! engineering notes and the facts in Linux's hid-playstation driver, with no code taken.

use std::time::Duration;

/// How often a connected controller is read again.
const EVERY: Duration = Duration::from_secs(5 * 60);

/// How long a controller that just connected gets before it is read.
const SETTLE: Duration = Duration::from_secs(1);

/// Nintendo's and Sony's USB vendor ids, and the controllers' product ids.
const NINTENDO: u16 = 0x057e;
const PRO: u16 = 0x2009;
const SONY: u16 = 0x054c;
const PLAYSTATION: [u16; 4] = [0x05c4, 0x09cc, 0x0ce6, 0x0df2];

/// The Pro Controller's only output: report 0x01, packet 0, the rumble at rest, then subcommand 0x02, "device info".
/// Never 0x03, which changes the report mode games and Steam rely on.
const DEVICE_INFO: [u8; 11] = [
    0x01, 0, 0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40, 0x02,
];

/// The level in a Pro Controller's reply (0x21) or full report (0x30): the high nibble of byte 2 is 8 full, 6
/// medium, 4 low, 2 critical and 0 empty, plus 1 while charging. The bars the Switch shows, critical at 20 % so it
/// warns.
fn pro(report: &[u8]) -> Option<u8> {
    match report {
        [0x21 | 0x30, _, status, ..] => [0, 20, 50, 75, 100].get(usize::from(status >> 5)).copied(),
        _ => None,
    }
}

/// The level in a PlayStation controller's full report on Bluetooth. Its status byte holds 0 to 10 in the low
/// nibble, a tenth each, read as the middle of that tenth.
fn playstation(report: &[u8]) -> Option<u8> {
    match report {
        // DualShock 4: bit 4 says it's on a cable, and past 10 it's full, unless that cable has a fault.
        [0x11, ..] => {
            let status = *report.get(32)?;
            match status & 0x0f {
                tenths @ 0..=9 => Some(tenths * 10 + 5),
                10 => Some(100),
                _ => (status & 0x10 == 0).then_some(100),
            }
        }
        // DualSense: the high nibble is 0 on battery, 1 charging, 2 full, and anything else an error.
        [0x31, ..] => {
            let status = *report.get(54)?;
            match status >> 4 {
                0 | 1 => Some(((status & 0x0f) * 10 + 5).min(100)),
                2 => Some(100),
                _ => None,
            }
        }
        _ => None,
    }
}

#[cfg(windows)]
pub use win::watch;

#[cfg(windows)]
mod win {
    use std::ptr::{null, null_mut};
    use std::sync::mpsc::{RecvTimeoutError, Sender, channel};
    use std::time::Instant;

    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
    };
    use windows::Foundation::{IPropertyValue, TypedEventHandler};
    use windows::core::{HSTRING, IInspectable, Interface};
    use windows_collections::{IIterable, IMapView};
    use windows_sys::Win32::Devices::HumanInterfaceDevice::{
        HIDP_CAPS, HIDP_STATUS_SUCCESS, HidD_FreePreparsedData, HidD_GetPreparsedData, HidP_GetCaps,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, GetLastError, HANDLE,
        INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        ReadFile, WriteFile,
    };
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
    use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    use super::{DEVICE_INFO, EVERY, NINTENDO, PLAYSTATION, PRO, SETTLE, SONY, playstation, pro};
    use crate::power::{Msg, address};

    const VENDOR: &str = "System.DeviceInterface.Hid.VendorId";
    const PRODUCT: &str = "System.DeviceInterface.Hid.ProductId";
    const INSTANCE: &str = "System.Devices.DeviceInstanceId";
    /// A device's parent (DEVPKEY_Device_Parent), where a Bluetooth controller's address is.
    const PARENT: &str = "{4340a6c5-93fa-4706-972c-7b648008a5a7} 8";
    /// Each wait for a report, and how many reports to look through for the level.
    const WAIT: u32 = 500;
    const READS: usize = 8;

    /// A connected controller: its HID path, its Bluetooth address, and when to read it next.
    struct Pad {
        path: String,
        address: String,
        pro: bool,
        next: Instant,
    }

    enum Heard {
        Added {
            path: String,
            instance: String,
            vendor: u16,
            product: u16,
        },
        Removed(String),
    }

    /// Watches on a thread of its own, which sleeps until a controller connects or leaves, and between two reads.
    pub fn watch(power: &Sender<Msg>) {
        let power = power.clone();
        std::thread::spawn(move || run(&power));
    }

    fn run(power: &Sender<Msg>) {
        let (tx, rx) = channel();
        // The watcher lives as long as the loop, and with it its handlers.
        let Ok(_watcher) =
            watcher(&tx).inspect_err(|e| log::warn!("pads: controllers can't be heard: {e}"))
        else {
            return;
        };
        drop(tx);
        let mut pads: Vec<Pad> = Vec::new();
        loop {
            let heard = match pads.iter().map(|p| p.next).min() {
                Some(at) => match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                    Ok(heard) => Some(heard),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => return,
                },
                None => match rx.recv() {
                    Ok(heard) => Some(heard),
                    Err(_) => return,
                },
            };
            match heard {
                Some(Heard::Added {
                    path,
                    instance,
                    vendor,
                    product,
                }) => {
                    let known = (vendor, product) == (NINTENDO, PRO)
                        || vendor == SONY && PLAYSTATION.contains(&product);
                    // On a cable, it charges and isn't Bluetooth: there's no address to file it under.
                    if known && let Some(address) = bluetooth(&instance) {
                        pads.retain(|p| p.path != path);
                        pads.push(Pad {
                            path,
                            address,
                            pro: product == PRO,
                            next: Instant::now() + SETTLE,
                        });
                    }
                }
                Some(Heard::Removed(path)) => pads.retain(|p| p.path != path),
                None => {}
            }
            let now = Instant::now();
            for pad in pads.iter_mut().filter(|p| p.next <= now) {
                pad.next = now + EVERY;
                let level = if pad.pro {
                    ask(&pad.path)
                } else {
                    listen(&pad.path)
                };
                if let Some(level) = level
                    && power
                        .send(Msg::Own(pad.address.clone(), level, None))
                        .is_err()
                {
                    return;
                }
            }
        }
    }

    /// The Bluetooth address of a HID device, from its parent: `None` on a cable.
    fn bluetooth(instance: &str) -> Option<String> {
        let keys = IIterable::from(vec![HSTRING::from(PARENT)]);
        let device = DeviceInformation::CreateFromIdAsyncWithKindAndAdditionalProperties(
            &HSTRING::from(instance),
            &keys,
            DeviceInformationKind::Device,
        )
        .ok()?
        .join()
        .ok()?;
        let parent = value(&device.Properties().ok()?, PARENT)?
            .GetString()
            .ok()?
            .to_string();
        address(&parent).filter(|_| parent.to_ascii_uppercase().starts_with("BTH"))
    }

    /// The Pro Controller: asks for its device info and reads the level in what comes back.
    fn ask(path: &str) -> Option<u8> {
        let hid = Hid::open(path, true)?;
        let (input, output) = hid.sizes()?;
        let mut device_info = vec![0; output];
        device_info
            .get_mut(..DEVICE_INFO.len())?
            .copy_from_slice(&DEVICE_INFO);
        hid.write(&device_info)?;
        hid.find(input, pro)
    }

    /// A PlayStation controller: reads what it sends anyway.
    fn listen(path: &str) -> Option<u8> {
        let hid = Hid::open(path, false)?;
        let (input, _) = hid.sizes()?;
        hid.find(input, playstation)
    }

    /// A HID device opened for overlapped reads and writes, shared with every app that has it open too. Exclusive
    /// access isn't needed: a controller another app hid or locked can't be opened, and is left alone.
    struct Hid(HANDLE);

    impl Drop for Hid {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    impl Hid {
        fn open(path: &str, write: bool) -> Option<Hid> {
            let path: Vec<u16> = path.encode_utf16().chain([0]).collect();
            let access = if write {
                GENERIC_READ | GENERIC_WRITE
            } else {
                GENERIC_READ
            };
            // SAFETY: `path` is a NUL-terminated UTF-16 string that outlives the call.
            let handle = unsafe {
                CreateFileW(
                    path.as_ptr(),
                    access,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED,
                    null_mut(),
                )
            };
            (handle != INVALID_HANDLE_VALUE).then_some(Hid(handle))
        }

        /// The size of its input and output reports, the report id included.
        fn sizes(&self) -> Option<(usize, usize)> {
            let mut data = 0;
            if !unsafe { HidD_GetPreparsedData(self.0, &mut data) } {
                return None;
            }
            // SAFETY: an all-zero HIDP_CAPS is a valid value, which HidP_GetCaps then fills.
            let mut caps: HIDP_CAPS = unsafe { std::mem::zeroed() };
            let status = unsafe { HidP_GetCaps(data, &mut caps) };
            unsafe { HidD_FreePreparsedData(data) };
            (status == HIDP_STATUS_SUCCESS).then(|| {
                (
                    usize::from(caps.InputReportByteLength),
                    usize::from(caps.OutputReportByteLength),
                )
            })
        }

        fn write(&self, report: &[u8]) -> Option<usize> {
            let len = u32::try_from(report.len()).ok()?;
            // SAFETY: `wait` doesn't return before the write ends or is cancelled, so `report` outlives it.
            self.wait(|overlapped| unsafe {
                WriteFile(self.0, report.as_ptr(), len, null_mut(), overlapped)
            })
        }

        /// Reads reports until `level` finds one in them, `READS` at most, each within `WAIT` ms.
        fn find(&self, size: usize, level: fn(&[u8]) -> Option<u8>) -> Option<u8> {
            let mut report = vec![0; size];
            let len = u32::try_from(size).ok()?;
            (0..READS).find_map(|_| {
                // SAFETY: `wait` doesn't return before the read ends or is cancelled, so `report` outlives it.
                let read = self.wait(|overlapped| unsafe {
                    ReadFile(self.0, report.as_mut_ptr(), len, null_mut(), overlapped)
                })?;
                level(report.get(..read)?)
            })
        }

        /// Starts a read or a write and waits `WAIT` ms for it at most: the bytes it moved, or `None`. A late one is
        /// cancelled, and waited for until Windows lets go of its buffer.
        fn wait(&self, start: impl FnOnce(*mut OVERLAPPED) -> i32) -> Option<usize> {
            let event = unsafe { CreateEventW(null(), 1, 0, null()) };
            if event.is_null() {
                return None;
            }
            // SAFETY: an all-zero OVERLAPPED is the documented starting value, and it outlives the I/O below.
            let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            overlapped.hEvent = event;
            let mut moved = 0;
            let started =
                start(&mut overlapped) != 0 || unsafe { GetLastError() } == ERROR_IO_PENDING;
            let done = started && {
                let ended = unsafe { WaitForSingleObject(event, WAIT) } == WAIT_OBJECT_0;
                if !ended {
                    unsafe { CancelIoEx(self.0, &overlapped) };
                }
                let got = unsafe { GetOverlappedResult(self.0, &overlapped, &mut moved, 1) } != 0;
                ended && got
            };
            unsafe { CloseHandle(event) };
            done.then_some(moved as usize)
        }
    }

    fn value(props: &IMapView<HSTRING, IInspectable>, key: &str) -> Option<IPropertyValue> {
        props.Lookup(&HSTRING::from(key)).ok()?.cast().ok()
    }

    fn added(info: &DeviceInformation) -> Option<Heard> {
        let props = info.Properties().ok()?;
        let number = |key| value(&props, key)?.GetUInt16().ok();
        Some(Heard::Added {
            path: info.Id().ok()?.to_string(),
            instance: value(&props, INSTANCE)?.GetString().ok()?.to_string(),
            vendor: number(VENDOR)?,
            product: number(PRODUCT)?,
        })
    }

    /// The controllers' HID devices as they come and go. Handlers run on Windows' thread pool: they read what came
    /// with the event and post it, nothing more.
    fn watcher(tx: &Sender<Heard>) -> windows::core::Result<DeviceWatcher> {
        let aqs = format!(
            "System.Devices.InterfaceClassGuid:=\"{{4d1e55b2-f16f-11cf-88cb-001111000030}}\" AND \
             System.Devices.InterfaceEnabled:=System.StructuredQueryType.Boolean#True AND \
             ({VENDOR}:={NINTENDO} OR {VENDOR}:={SONY})"
        );
        let keys = IIterable::from(vec![
            HSTRING::from(VENDOR),
            HSTRING::from(PRODUCT),
            HSTRING::from(INSTANCE),
        ]);
        let watcher = DeviceInformation::CreateWatcherAqsFilterAndAdditionalProperties(
            &HSTRING::from(aqs),
            &keys,
        )?;
        let send = tx.clone();
        watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                if let Some(heard) = info.as_ref().and_then(added) {
                    let _ = send.send(heard);
                }
                Ok(())
            },
        ))?;
        // Windows sends nothing after the first list to a watcher that doesn't hear updates too.
        watcher.Updated(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(|_, _| Ok(())),
        )?;
        let send = tx.clone();
        watcher.Removed(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                if let Some(update) = update.as_ref() {
                    let _ = send.send(Heard::Removed(update.Id()?.to_string()));
                }
                Ok(())
            }),
        )?;
        watcher.Start()?;
        Ok(watcher)
    }
}

#[cfg(test)]
mod tests {
    use super::{playstation, pro};

    #[test]
    fn reads_the_pro_controllers_bars() {
        // The device info reply, full and charging, then a full report at medium, then low, critical and empty.
        assert_eq!(pro(&[0x21, 0x05, 0x91, 0x00]), Some(100));
        assert_eq!(pro(&[0x30, 0x05, 0x60]), Some(75));
        assert_eq!(pro(&[0x30, 0x05, 0x40]), Some(50));
        assert_eq!(pro(&[0x30, 0x05, 0x2e]), Some(20));
        assert_eq!(pro(&[0x30, 0x05, 0x00]), Some(0));
        // The simple report games get by default carries none.
        assert_eq!(pro(&[0x3f, 0x00, 0x80]), None);
        assert_eq!(pro(&[0x21, 0x05]), None);
    }

    fn report(id: u8, at: usize, status: u8) -> Vec<u8> {
        let mut report = vec![0; at + 10];
        report[0] = id;
        report[at] = status;
        report
    }

    #[test]
    fn reads_a_dualshock_4s_full_report() {
        assert_eq!(playstation(&report(0x11, 32, 0x07)), Some(75));
        assert_eq!(playstation(&report(0x11, 32, 0x00)), Some(5));
        assert_eq!(playstation(&report(0x11, 32, 0x1a)), Some(100));
        // Past 10 on battery is full; on a cable, a fault.
        assert_eq!(playstation(&report(0x11, 32, 0x0b)), Some(100));
        assert_eq!(playstation(&report(0x11, 32, 0x1b)), None);
    }

    #[test]
    fn reads_a_dualsenses_full_report() {
        assert_eq!(playstation(&report(0x31, 54, 0x04)), Some(45));
        assert_eq!(playstation(&report(0x31, 54, 0x18)), Some(85));
        assert_eq!(playstation(&report(0x31, 54, 0x2a)), Some(100));
        assert_eq!(playstation(&report(0x31, 54, 0x0f)), Some(100));
        assert_eq!(playstation(&report(0x31, 54, 0xa3)), None);
    }

    #[test]
    fn says_nothing_from_the_simple_report_or_a_short_one() {
        // Bluetooth's default report, before Steam or a game turns the full one on.
        assert_eq!(playstation(&report(0x01, 8, 0x08)), None);
        assert_eq!(playstation(&[0x11, 0x00]), None);
        assert_eq!(playstation(&[0x31; 40]), None);
    }
}

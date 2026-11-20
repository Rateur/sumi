//! Xbox controllers' battery on the Xbox Wireless Adapter, which Windows' Bluetooth settings don't list, from
//! Windows' own game input (Windows.Gaming.Input). On Bluetooth, an Xbox controller gives Windows its level, and
//! power.rs reads that one. Game input says nothing when a level changes: a controller is read as it arrives and
//! every 5 minutes while it stays. With none, the thread sleeps.

use std::time::Duration;

/// How often a connected controller is read again.
const EVERY: Duration = Duration::from_secs(5 * 60);

/// How long a controller that just arrived gets to have its first report.
const SOON: Duration = Duration::from_secs(2);

/// The level from a battery report's capacities, in mWh.
fn percent(remaining: i32, full: i32) -> Option<u8> {
    if full <= 0 || remaining < 0 {
        return None;
    }
    let (remaining, full) = (i64::from(remaining.min(full)), i64::from(full));
    u8::try_from((remaining * 100 + full / 2) / full).ok()
}

/// Whether a HID device's path is Bluetooth's: classic HID's service, or HID over Bluetooth LE's.
fn on_bluetooth(path: &str) -> bool {
    let path = path.to_ascii_lowercase();
    path.contains("{00001124-") || path.contains("{00001812-")
}

#[cfg(windows)]
pub use win::watch;

#[cfg(windows)]
mod win {
    use std::sync::mpsc::{RecvTimeoutError, SendError, Sender, channel};

    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Foundation::{EventHandler, IReference};
    use windows::Gaming::Input::RawGameController;
    use windows::System::Power::BatteryStatus;
    use windows::core::HSTRING;

    use super::{EVERY, SOON, on_bluetooth, percent};
    use crate::power::{Kind, Msg};

    /// The HID device interface class.
    const HID: &str = "{4d1e55b2-f16f-11cf-88cb-001111000030}";

    /// Watches on a thread of its own, which sleeps until a controller arrives or leaves, and between two reads.
    pub fn watch(power: &Sender<Msg>) {
        let power = power.clone();
        std::thread::spawn(move || run(&power));
    }

    fn run(power: &Sender<Msg>) {
        let (tx, rx) = channel();
        // Handlers run on Windows' thread pool: they post the controller, nothing more.
        let on = |arrived: bool| {
            let tx = tx.clone();
            EventHandler::<RawGameController>::new(move |_, controller| {
                if let Some(controller) = controller.as_ref() {
                    let _ = tx.send((controller.clone(), arrived));
                }
                Ok(())
            })
        };
        if RawGameController::RawGameControllerAdded(&on(true))
            .and_then(|_| RawGameController::RawGameControllerRemoved(&on(false)))
            .inspect_err(|e| log::warn!("xbox: controllers can't be heard: {e}"))
            .is_err()
        {
            return;
        }
        // Those already there. Windows may still be finding them: those come through the handler.
        if let Ok(list) = RawGameController::RawGameControllers() {
            for controller in list {
                let _ = tx.send((controller, true));
            }
        }
        drop(tx);
        // The controllers Sumi reads, by the id power.rs files them under.
        let mut pads: Vec<(String, RawGameController)> = Vec::new();
        loop {
            let heard = if pads.is_empty() {
                rx.recv().map_err(drop)
            } else {
                match rx.recv_timeout(EVERY) {
                    Err(RecvTimeoutError::Disconnected) => return,
                    heard => heard.map_err(drop),
                }
            };
            let sent = match heard {
                Ok((controller, true)) => arrived(power, &mut pads, controller),
                Ok((controller, false)) => left(power, &mut pads, &controller),
                Err(()) if pads.is_empty() => return,
                Err(()) => pads
                    .iter()
                    .try_for_each(|(id, controller)| match level(controller) {
                        Some(level) => power.send(Msg::Own(id.clone(), level, None)),
                        None => Ok(()),
                    }),
            };
            if sent.is_err() {
                return;
            }
        }
    }

    /// A wireless controller off Bluetooth with a level: posted with it, since it has no endpoint for power.rs to
    /// hear. One just arrived may not have its report yet: it gets a second try.
    fn arrived(
        power: &Sender<Msg>,
        pads: &mut Vec<(String, RawGameController)>,
        controller: RawGameController,
    ) -> Result<(), SendError<Msg>> {
        let Ok(id) = controller.NonRoamableId().map(|id| format!("xbox {id}")) else {
            return Ok(());
        };
        if pads.iter().any(|(p, _)| *p == id)
            || !controller.IsWireless().unwrap_or(false)
            || bluetooth(&controller)
        {
            return Ok(());
        }
        let Some(level) = level(&controller).or_else(|| {
            std::thread::sleep(SOON);
            level(&controller)
        }) else {
            return Ok(());
        };
        power.send(Msg::Own(id.clone(), level, None))?;
        power.send(Msg::Endpoint {
            address: id.clone(),
            name: controller.DisplayName().map(|n| n.to_string()).ok(),
            kind: Some(Some(Kind::Controller)),
            connected: Some(true),
        })?;
        pads.push((id, controller));
        Ok(())
    }

    fn left(
        power: &Sender<Msg>,
        pads: &mut Vec<(String, RawGameController)>,
        controller: &RawGameController,
    ) -> Result<(), SendError<Msg>> {
        let Ok(id) = controller.NonRoamableId().map(|id| format!("xbox {id}")) else {
            return Ok(());
        };
        let Some(i) = pads.iter().position(|(p, _)| *p == id) else {
            return Ok(());
        };
        pads.remove(i);
        power.send(Msg::Gone(id))
    }

    fn level(controller: &RawGameController) -> Option<u8> {
        let report = controller.TryGetBatteryReport().ok()?;
        if report.Status().ok()? == BatteryStatus::NotPresent {
            return None;
        }
        let read = |v: windows::core::Result<IReference<i32>>| v.and_then(|v| v.Value()).ok();
        percent(
            read(report.RemainingCapacityInMilliwattHours())?,
            read(report.FullChargeCapacityInMilliwattHours())?,
        )
    }

    /// Whether the controller is on Bluetooth, from the HID devices of the same make and model.
    fn bluetooth(controller: &RawGameController) -> bool {
        let (Ok(vendor), Ok(product)) = (
            controller.HardwareVendorId(),
            controller.HardwareProductId(),
        ) else {
            return false;
        };
        let aqs = format!(
            "System.Devices.InterfaceClassGuid:=\"{HID}\" AND \
             System.DeviceInterface.Hid.VendorId:={vendor} AND System.DeviceInterface.Hid.ProductId:={product}"
        );
        DeviceInformation::FindAllAsyncAqsFilter(&HSTRING::from(aqs))
            .and_then(|found| found.join())
            .is_ok_and(|found| {
                found
                    .into_iter()
                    .any(|d| d.Id().is_ok_and(|id| on_bluetooth(&id.to_string())))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{on_bluetooth, percent};

    #[test]
    fn reads_the_level_from_the_capacities() {
        assert_eq!(percent(50, 100), Some(50));
        assert_eq!(percent(2, 3), Some(67));
        // A report past full, or without a capacity, says nothing wrong.
        assert_eq!(percent(120, 100), Some(100));
        assert_eq!(percent(10, 0), None);
        assert_eq!(percent(-1, 100), None);
    }

    #[test]
    fn knows_a_bluetooth_controller_by_its_path() {
        assert!(on_bluetooth(
            r"\\?\HID#{00001812-0000-1000-8000-00805f9b34fb}_Dev_VID&02045e_PID&0b13_REV&0509_aabbccddeeff#a&1&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        ));
        assert!(on_bluetooth(
            r"\\?\HID#{00001124-0000-1000-8000-00805f9b34fb}_VID&0002045e_PID&02e0#9&2a5f3e9b&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        ));
        // On the Xbox Wireless Adapter or a cable.
        assert!(!on_bluetooth(
            r"\\?\HID#VID_045E&PID_02EA&IG_00#8&1b2c3d4e&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        ));
    }
}

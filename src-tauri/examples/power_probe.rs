//! Spike for #82, run without the app: `cargo run --example power_probe`. It checks that an unpackaged process can
//! hear `PowerManager`'s events, prints what this PC reports, and lists the devices Windows gives a battery level,
//! from a one-off query and from a `DeviceWatcher`. It prints events for 20 s, or for the seconds given, then stops.

fn main() {
    #[cfg(windows)]
    win::main();
}

#[cfg(windows)]
mod win {
    use std::sync::mpsc::{Sender, channel};
    use std::time::{Duration, Instant};

    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
    };
    use windows::Foundation::{EventHandler, IPropertyValue, TypedEventHandler};
    use windows::System::Power::PowerManager;
    use windows::core::{HSTRING, IInspectable, Interface};
    use windows_collections::IIterable;

    /// The level Windows shows in Settings for a Bluetooth device.
    const BATTERY: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
    /// DEVPKEY_Device_DevNodeStatus.
    const STATUS: &str = "{4340A6C5-93FA-4706-972C-7B648008A5A7} 2";
    const WAIT: Duration = Duration::from_secs(20);

    fn ping(tx: &Sender<String>, what: &'static str) -> EventHandler<IInspectable> {
        let tx = tx.clone();
        EventHandler::new(move |_, _| {
            let _ = tx.send(what.to_string());
            Ok(())
        })
    }

    fn props() -> IIterable<HSTRING> {
        IIterable::from(vec![
            HSTRING::from(BATTERY),
            HSTRING::from("System.Devices.ContainerId"),
            HSTRING::from("System.Devices.ClassGuid"),
            HSTRING::from("System.Devices.Aep.IsConnected"),
            HSTRING::from("System.Devices.Aep.Bluetooth.Cod.Major"),
            HSTRING::from("System.Devices.Aep.Bluetooth.Cod.Minor"),
            HSTRING::from(STATUS),
            HSTRING::from("System.Devices.Aep.Category"),
        ])
    }

    fn show(value: &IInspectable) -> String {
        let Ok(v) = value.cast::<IPropertyValue>() else {
            return "?".into();
        };
        let kind = v.Type().map(|t| t.0).unwrap_or(-1);
        v.GetUInt8()
            .map(|n| n.to_string())
            .or_else(|_| v.GetUInt32().map(|n| n.to_string()))
            .or_else(|_| v.GetBoolean().map(|b| b.to_string()))
            .or_else(|_| v.GetGuid().map(|g| format!("{g:?}")))
            .or_else(|_| v.GetString().map(|s| s.to_string()))
            .or_else(|_| {
                let mut out = windows::core::Array::<HSTRING>::new();
                v.GetStringArray(&mut out).map(|()| {
                    out.iter()
                        .map(|s| s.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                })
            })
            .map(|s| format!("{s} (type {kind})"))
            .unwrap_or_else(|_| format!("? (type {kind})"))
    }

    fn describe(info: &DeviceInformation) -> String {
        let name = info.Name().unwrap_or_default();
        let mut line = format!(
            "{name:?} kind={:?} id={:?}",
            info.Kind().map(|k| k.0),
            info.Id().unwrap_or_default()
        );
        if let Ok(map) = info.Properties() {
            for key in [
                BATTERY,
                "System.Devices.ContainerId",
                "System.Devices.ClassGuid",
                "System.Devices.Aep.IsConnected",
                "System.Devices.Aep.Bluetooth.Cod.Major",
                "System.Devices.Aep.Bluetooth.Cod.Minor",
                STATUS,
                "System.Devices.Aep.Category",
            ] {
                if let Ok(value) = map.Lookup(&HSTRING::from(key)) {
                    line += &format!("\n      {key} = {}", show(&value));
                }
            }
        }
        line
    }

    fn container(id: &IInspectable) -> String {
        let Ok(guid) = id.cast::<IPropertyValue>().and_then(|v| v.GetGuid()) else {
            return "?".into();
        };
        let id = HSTRING::from(format!("{{{guid:?}}}"));
        let keys = [
            "System.Devices.Category",
            "System.Devices.CategoryIds",
            "System.Devices.Connected",
            "System.Devices.Paired",
        ];
        DeviceInformation::CreateFromIdAsyncWithKindAndAdditionalProperties(
            &id,
            &IIterable::from(keys.into_iter().map(HSTRING::from).collect::<Vec<_>>()),
            DeviceInformationKind::DeviceContainer,
        )
        .and_then(|op| op.join())
        .map(|c| {
            let mut line = format!("{:?}", c.Name().unwrap_or_default());
            for key in keys {
                if let Ok(v) = c.Properties().and_then(|m| m.Lookup(&HSTRING::from(key))) {
                    line += &format!(" {key}={}", show(&v));
                }
            }
            line
        })
        .unwrap_or_else(|e| format!("error {e}"))
    }

    pub fn main() {
        println!("== PowerManager, read once");
        println!(
            "BatteryStatus          {:?}",
            PowerManager::BatteryStatus().map(|s| s.0)
        );
        println!(
            "PowerSupplyStatus      {:?}",
            PowerManager::PowerSupplyStatus().map(|s| s.0)
        );
        println!(
            "RemainingChargePercent {:?}",
            PowerManager::RemainingChargePercent()
        );
        println!(
            "RemainingDischargeTime {:?} s",
            PowerManager::RemainingDischargeTime().map(|t| t.Duration / 10_000_000)
        );

        let (tx, rx) = channel();
        println!("== PowerManager, subscriptions (an Ok token means Windows took the handler)");
        println!(
            "BatteryStatusChanged          {:?}",
            PowerManager::BatteryStatusChanged(&ping(&tx, "BatteryStatusChanged"))
        );
        println!(
            "PowerSupplyStatusChanged      {:?}",
            PowerManager::PowerSupplyStatusChanged(&ping(&tx, "PowerSupplyStatusChanged"))
        );
        println!(
            "RemainingChargePercentChanged {:?}",
            PowerManager::RemainingChargePercentChanged(&ping(
                &tx,
                "RemainingChargePercentChanged"
            ))
        );
        println!(
            "RemainingDischargeTimeChanged {:?}",
            PowerManager::RemainingDischargeTimeChanged(&ping(
                &tx,
                "RemainingDischargeTimeChanged"
            ))
        );
        println!(
            "EnergySaverStatusChanged      {:?}",
            PowerManager::EnergySaverStatusChanged(&ping(&tx, "EnergySaverStatusChanged"))
        );

        for (label, kind, aqs) in [
            (
                "Device, instance id starts with BTH",
                DeviceInformationKind::Device,
                String::from("System.Devices.DeviceInstanceId:~<\"BTH\""),
            ),
            (
                "AssociationEndpoint, Bluetooth",
                DeviceInformationKind::AssociationEndpoint,
                String::from(
                    "System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\"",
                ),
            ),
        ] {
            println!("== FindAll, {label}");
            match DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
                &HSTRING::from(aqs),
                &props(),
                kind,
            )
            .and_then(|op| op.join())
            {
                Ok(all) => {
                    for info in &all {
                        let has = info
                            .Properties()
                            .and_then(|m| m.Lookup(&HSTRING::from(BATTERY)))
                            .is_ok_and(|v| v.cast::<IPropertyValue>().is_ok());
                        if kind == DeviceInformationKind::Device && !has {
                            continue;
                        }
                        println!("  {}", describe(&info));
                        if let Ok(id) = info
                            .Properties()
                            .and_then(|m| m.Lookup(&HSTRING::from("System.Devices.ContainerId")))
                        {
                            println!("      container {}", container(&id));
                        }
                    }
                    println!("  ({} found)", all.Size().unwrap_or(0));
                }
                Err(e) => println!("  error {e}"),
            }
        }

        println!("== DeviceWatcher, Device kind, instance id starts with BTH");
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from("System.Devices.DeviceInstanceId:~<\"BTH\""),
            &props(),
            DeviceInformationKind::Device,
        );
        match &watcher {
            Ok(w) => {
                let t = tx.clone();
                let _ = w.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
                    move |_, info| {
                        if let Some(info) = info.as_ref() {
                            let _ = t.send(format!("watcher Added {}", describe(info)));
                        }
                        Ok(())
                    },
                ));
                let t = tx.clone();
                let _ = w.Updated(
                    &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                        move |_, u| {
                            if let Some(u) = u.as_ref() {
                                let battery = u
                                    .Properties()
                                    .and_then(|m| m.Lookup(&HSTRING::from(BATTERY)))
                                    .map(|v| show(&v))
                                    .unwrap_or_else(|_| "-".into());
                                let _ = t.send(format!(
                                    "watcher Updated {:?} battery={battery}",
                                    u.Id().unwrap_or_default()
                                ));
                            }
                            Ok(())
                        },
                    ),
                );
                let t = tx.clone();
                let _ = w.Removed(
                    &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
                        move |_, u| {
                            if let Some(u) = u.as_ref() {
                                let _ = t.send(format!(
                                    "watcher Removed {:?}",
                                    u.Id().unwrap_or_default()
                                ));
                            }
                            Ok(())
                        },
                    ),
                );
                let t = tx.clone();
                let _ = w.EnumerationCompleted(
                    &TypedEventHandler::<DeviceWatcher, IInspectable>::new(move |_, _| {
                        let _ = t.send("watcher EnumerationCompleted".into());
                        Ok(())
                    }),
                );
                println!("Start {:?}", w.Start());
            }
            Err(e) => println!("  error {e}"),
        }

        let wait = std::env::args()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .map_or(WAIT, Duration::from_secs);
        let end = Instant::now() + wait;
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            if let Ok(event) = rx.recv_timeout(left) {
                println!("event: {event}");
            }
        }
        if let Ok(w) = watcher {
            let _ = w.Stop();
        }
        println!("== done after {} s", wait.as_secs());
    }
}

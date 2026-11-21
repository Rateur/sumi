//! A JBL speaker's level, which it gives only to JBL's app: Windows has none. As a paired speaker connects, a
//! passive Bluetooth LE watch of 5 s at most finds its advertisement, then one short Bluetooth LE connection asks it
//! for its device info, `AA 11 00`, reads the battery in the reply, and lets the speaker go. Nothing else is sent.
//! The models, the frames and the battery token come from JBLControl (MIT, see THIRD_PARTY_NOTICES.md).

/// Harman's Bluetooth company ID, in JBL's advertisements.
const COMPANY: u16 = 0x0057;

/// The speakers that answer `AA 11 00`, by product ID, from JBLControl's catalog. Left out: the models that speak a
/// newer protocol (Go 5, Grip, Xtreme 5, Boombox 4, the Essential 3 SE), the Wi-Fi ones, and those without
/// Bluetooth LE.
const MODELS: &[u16] = &[
    0x1EBC, // Charge 3
    0x1F17, 0x1F29, // Charge 4
    0x2040, // Charge 5
    0x20E3, // Charge 6
    0x20F5, // Clip 5
    0x1ED1, // Flip 4
    0x1F31, // Flip 5
    0x204F, // Flip 6
    0x2107, // Flip 7
    0x20E4, 0x210A, // Go 4
    0x215C, 0x2181, // Go 4 Duo, left and right
    0x1ED2, // Pulse 3
    0x1F56, // Pulse 4
    0x2050, // Pulse 5
    0x214C, // Tuner 3
    0x1EFC, 0x1F26, 0x2038, // Xtreme 2
    0x202F, // Xtreme 3
    0x20DC, // Xtreme 4
    0x1EE7, 0x1F27, // Boombox
    0x1F53, // Boombox 2
    0x206D, // Boombox 3
];

/// Whether Harman's advertisement data names a speaker in `MODELS`: its product ID comes first, little-endian.
/// Windows gives the data without the company ID.
fn known(data: &[u8]) -> bool {
    matches!(data, [low, high, ..] if MODELS.contains(&u16::from_le_bytes([*low, *high])))
}

/// Whether a Bluetooth LE address is the speaker's: the Go 4 keeps its classic address's lower 5 bytes.
fn same(classic: u64, le: u64) -> bool {
    (classic ^ le) & 0xff_ffff_ffff == 0
}

/// The level in what the speaker sent: frames are `AA`, a command, a length and the payload, and may split across
/// notifications. The device info comes in `AA 12` frames of one token each, `00`, the token, its value; the
/// battery's token is `44`, its level in the low 7 bits, the high bit set while charging. `None` until it came.
fn level(mut bytes: &[u8]) -> Option<u8> {
    loop {
        bytes = &bytes[bytes.iter().position(|&b| b == 0xAA)?..];
        let command = *bytes.get(1)?;
        // These commands give their length on two bytes, big-endian.
        let (header, size) = if matches!(command, 0x92 | 0x96..=0x99) {
            (
                4,
                u16::from_be_bytes([*bytes.get(2)?, *bytes.get(3)?]).into(),
            )
        } else {
            (3, usize::from(*bytes.get(2)?))
        };
        let payload = bytes.get(header..header + size)?;
        if command == 0x12
            && let [_, 0x44, value, ..] = payload
        {
            return Some(value & 0x7f).filter(|&p| p <= 100);
        }
        bytes = &bytes[header + size..];
    }
}

#[cfg(windows)]
pub(super) use win::ask;

#[cfg(windows)]
mod win {
    use std::sync::Mutex;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use windows::Devices::Bluetooth::Advertisement::{
        BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
        BluetoothLEScanningMode,
    };
    use windows::Devices::Bluetooth::GenericAttributeProfile::{
        GattCharacteristic, GattClientCharacteristicConfigurationDescriptorValue as Cccd,
        GattCommunicationStatus, GattDeviceService, GattValueChangedEventArgs, GattWriteOption,
    };
    use windows::Devices::Bluetooth::{
        BluetoothAddressType, BluetoothCacheMode, BluetoothLEDevice,
    };
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::Streams::{DataReader, DataWriter, IBuffer};
    use windows::core::GUID;

    use super::{COMPANY, known, level, same};

    /// JBL's control service: the speaker notifies on the first characteristic, and is written to on the second.
    const SERVICE: GUID = GUID::from_u128(0x65786365_6c70_6f69_6e74_2e636f6d0000);
    const NOTIFY: GUID = GUID::from_u128(0x65786365_6c70_6f69_6e74_2e636f6d0001);
    const WRITE: GUID = GUID::from_u128(0x65786365_6c70_6f69_6e74_2e636f6d0002);
    /// The Go 4 advertises every few seconds and answered in 0.3 s.
    const SCAN: Duration = Duration::from_secs(5);
    const REPLY: Duration = Duration::from_secs(3);

    /// The level of the JBL speaker at this classic address, or `None` when it isn't one or doesn't answer. Blocks
    /// for a few seconds: it runs on a thread of its own.
    pub fn ask(address: &str) -> Option<u8> {
        let (le, kind) = find(u64::from_str_radix(address, 16).ok()?)?;
        let device = BluetoothLEDevice::FromBluetoothAddressWithBluetoothAddressTypeAsync(le, kind)
            .ok()?
            .join()
            .ok()?;
        let percent = device
            .GetGattServicesForUuidWithCacheModeAsync(SERVICE, BluetoothCacheMode::Uncached)
            .and_then(|op| op.join())
            .and_then(|r| r.Services())
            .and_then(|s| s.GetAt(0))
            .ok()
            .and_then(|service| {
                let percent = read(&service);
                let _ = service.Close();
                percent
            });
        let _ = device.Close();
        percent
    }

    /// The speaker's Bluetooth LE address, from its advertisement: a passive watch sends nothing.
    fn find(classic: u64) -> Option<(u64, BluetoothAddressType)> {
        let (tx, rx) = channel();
        let watcher = BluetoothLEAdvertisementWatcher::new().ok()?;
        watcher
            .SetScanningMode(BluetoothLEScanningMode::Passive)
            .ok()?;
        watcher
            .Received(&TypedEventHandler::<
                BluetoothLEAdvertisementWatcher,
                BluetoothLEAdvertisementReceivedEventArgs,
            >::new(move |_, args| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let le = args.BluetoothAddress()?;
                if !same(classic, le) {
                    return Ok(());
                }
                for data in args.Advertisement()?.ManufacturerData()? {
                    if data.CompanyId()? == COMPANY
                        && bytes(&data.Data()?).is_some_and(|d| known(&d))
                    {
                        let _ = tx.send((le, args.BluetoothAddressType()?));
                    }
                }
                Ok(())
            }))
            .ok()?;
        watcher.Start().ok()?;
        let found = rx.recv_timeout(SCAN).ok();
        let _ = watcher.Stop();
        found
    }

    /// Notifications on, `AA 11 00` once, the battery from the reply, notifications off.
    fn read(service: &GattDeviceService) -> Option<u8> {
        let notify = characteristic(service, NOTIFY)?;
        let write = characteristic(service, WRITE)?;
        let (tx, rx) = channel();
        let heard = Mutex::new(Vec::new());
        let token = notify
            .ValueChanged(&TypedEventHandler::<
                GattCharacteristic,
                GattValueChangedEventArgs,
            >::new(move |_, args| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                if let (Some(bytes), Ok(mut heard)) =
                    (bytes(&args.CharacteristicValue()?), heard.lock())
                {
                    heard.extend(bytes);
                    if let Some(percent) = level(&heard) {
                        let _ = tx.send(percent);
                    }
                }
                Ok(())
            }))
            .ok()?;
        let asked = subscribe(&notify, Cccd::Notify) && info(&write);
        let percent = if asked {
            rx.recv_timeout(REPLY).ok()
        } else {
            None
        };
        subscribe(&notify, Cccd::None);
        let _ = notify.RemoveValueChanged(token);
        percent
    }

    fn characteristic(service: &GattDeviceService, uuid: GUID) -> Option<GattCharacteristic> {
        service
            .GetCharacteristicsForUuidWithCacheModeAsync(uuid, BluetoothCacheMode::Uncached)
            .ok()?
            .join()
            .ok()?
            .Characteristics()
            .ok()?
            .GetAt(0)
            .ok()
    }

    fn subscribe(notify: &GattCharacteristic, value: Cccd) -> bool {
        notify
            .WriteClientCharacteristicConfigurationDescriptorWithResultAsync(value)
            .and_then(|op| op.join())
            .and_then(|r| r.Status())
            .is_ok_and(|s| s == GattCommunicationStatus::Success)
    }

    /// The device-info request, the only command Sumi sends.
    fn info(write: &GattCharacteristic) -> bool {
        DataWriter::new()
            .and_then(|w| {
                w.WriteBytes(&[0xAA, 0x11, 0x00])?;
                w.DetachBuffer()
            })
            .and_then(|buffer| {
                write
                    .WriteValueWithResultAndOptionAsync(&buffer, GattWriteOption::WriteWithResponse)
            })
            .and_then(|op| op.join())
            .and_then(|r| r.Status())
            .is_ok_and(|s| s == GattCommunicationStatus::Success)
    }

    fn bytes(buffer: &IBuffer) -> Option<Vec<u8>> {
        let mut bytes = vec![0; buffer.Length().ok()? as usize];
        DataReader::FromBuffer(buffer)
            .ok()?
            .ReadBytes(&mut bytes)
            .ok()?;
        Some(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::{known, level, same};

    #[test]
    fn reads_the_battery_in_the_go_4s_reply() {
        // The reply this Go 4 gave: 100 %, not charging.
        assert_eq!(level(&[0xaa, 0x12, 0x03, 0x00, 0x44, 0x64]), Some(100));
        // The high bit says it charges: a Charge 5 at 20 %.
        assert_eq!(level(&[0xaa, 0x12, 0x03, 0x00, 0x44, 0x94]), Some(20));
    }

    #[test]
    fn finds_the_battery_among_the_other_tokens_and_split_frames() {
        let mut reply = vec![0x01, 0xaa, 0x12, 0x0b, 0x00, 0xc1, 0x08];
        reply.extend(b"JBL Go 4");
        // A two-byte length, then the colour.
        reply.extend([0xaa, 0x99, 0x00, 0x02, 0x44, 0x10]);
        reply.extend([0xaa, 0x12, 0x03, 0x00, 0x43, 0x03]);
        assert_eq!(level(&reply), None);
        reply.extend([0xaa, 0x12, 0x03, 0x00, 0x44]);
        assert_eq!(level(&reply), None);
        reply.push(0x1e);
        assert_eq!(level(&reply), Some(30));
    }

    #[test]
    fn a_level_over_100_is_none() {
        assert_eq!(level(&[0xaa, 0x12, 0x03, 0x00, 0x44, 0x7f]), None);
    }

    #[test]
    fn knows_a_jbl_speaker_by_its_product_id() {
        // The Go 4's advertisement, without Harman's company ID.
        assert!(known(&[
            0xe4, 0x20, 0x03, 0x38, 0x25, 0xec, 0x4e, 0x42, 0x09, 0x00
        ]));
        // The Go 5 speaks another protocol.
        assert!(!known(&[0x68, 0x21, 0x00]));
        assert!(!known(&[0xe4]));
    }

    #[test]
    fn matches_the_classic_and_le_addresses_on_their_lower_5_bytes() {
        // The Go 4's classic address, its Bluetooth LE one, and the Fast Pair one it also advertises.
        assert!(same(0xE826_CF6A_E88C, 0x5526_CF6A_E88C));
        assert!(!same(0xE826_CF6A_E88C, 0x5526_CE6B_E88C));
    }
}

//! Earbuds' and headphones' battery from Google's Fast Pair, which many brands build in (Sony, Nothing and CMF,
//! OnePlus, JBL, Pixel Buds…) and Windows doesn't read. When a paired audio device connects, its Message Stream, an
//! RFCOMM channel of its own that Windows' audio never uses, is opened if it has one, and kept open while it stays
//! connected: the device sends each bud's level and the case's as it connects and whenever one changes. Sumi only
//! listens and sends nothing. Built from Google's public specification, not from anyone's code:
//! https://developers.google.com/nearby/fast-pair/specifications/extensions/messagestream

use serde::Serialize;

/// Each bud's level and the case's, `None` when the device doesn't know. Mirrored in src/lib/power.ts.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Buds {
    left: Option<u8>,
    right: Option<u8>,
    case: Option<u8>,
}

impl Buds {
    #[cfg(test)]
    pub fn new(left: Option<u8>, right: Option<u8>, case: Option<u8>) -> Self {
        Buds { left, right, case }
    }

    /// The device's level: the lower bud, since they go out together. A headset gives one level, as the left.
    fn percent(&self) -> Option<u8> {
        self.left.into_iter().chain(self.right).min()
    }
}

/// One battery byte: bit 7 says it charges, the rest is the level, 0x7F when unknown.
fn level(byte: u8) -> Option<u8> {
    Some(byte & 0x7f).filter(|&percent| percent <= 100)
}

/// The bytes read so far. A message is a group, a code, a big-endian length, then that many bytes: the battery is
/// group 0x03 (device information), code 0x03, with the left bud, the right bud and the case.
#[derive(Default)]
struct Frames(Vec<u8>);

impl Frames {
    /// Adds what was read and returns the last battery among the whole messages. A cut message waits for the rest.
    fn feed(&mut self, bytes: &[u8]) -> Option<Buds> {
        self.0.extend_from_slice(bytes);
        let mut buds = None;
        while let [group, code, high, low, ..] = self.0[..] {
            let end = 4 + usize::from(u16::from_be_bytes([high, low]));
            if self.0.len() < end {
                break;
            }
            if let ((0x03, 0x03), [left, right, case, ..]) = ((group, code), &self.0[4..end]) {
                buds = Some(Buds {
                    left: level(*left),
                    right: level(*right),
                    case: level(*case),
                });
            }
            self.0.drain(..end);
        }
        buds
    }
}

#[cfg(windows)]
pub use win::watch;

#[cfg(windows)]
mod win {
    use std::collections::HashMap;
    use std::sync::mpsc::{Sender, channel};

    use windows::Devices::Bluetooth::Rfcomm::RfcommServiceId;
    use windows::Devices::Bluetooth::{BluetoothCacheMode, BluetoothDevice};
    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
    };
    use windows::Foundation::{IPropertyValue, TypedEventHandler};
    use windows::Networking::Sockets::StreamSocket;
    use windows::Storage::Streams::{DataReader, InputStreamOptions};
    use windows::core::{GUID, HSTRING, IInspectable, Interface};
    use windows_collections::{IIterable, IMapView};

    use super::Frames;
    use crate::power::{Msg, address};

    /// The Message Stream's RFCOMM service.
    const STREAM: GUID = GUID::from_u128(0xdf21fe2c_2515_4fdb_8886_f12c4d67927c);
    const CONNECTED: &str = "System.Devices.Aep.IsConnected";
    const MAJOR: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
    /// Paired classic Bluetooth devices: the stream runs over RFCOMM.
    const PAIRED: &str = "System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" AND \
        System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True";
    /// The Bluetooth class of an audio device.
    const AUDIO: u32 = 4;

    /// What a handler heard about a device: whether it's an audio device, from the list, and whether it's connected.
    type Heard = (String, Option<bool>, Option<bool>);

    /// Watches on a thread of its own, which sleeps until a device connects or leaves.
    pub fn watch(power: &Sender<Msg>) {
        let power = power.clone();
        std::thread::spawn(move || run(&power));
    }

    fn run(power: &Sender<Msg>) {
        let (tx, rx) = channel();
        // The watcher lives as long as the loop, and with it its handlers.
        let Ok(_watcher) =
            watcher(&tx).inspect_err(|e| log::warn!("fastpair: devices can't be heard: {e}"))
        else {
            return;
        };
        drop(tx);
        let mut audio = HashMap::new();
        let mut open: HashMap<String, StreamSocket> = HashMap::new();
        for (id, is_audio, connected) in rx {
            if let Some(is_audio) = is_audio {
                audio.insert(id.clone(), is_audio);
            }
            match connected {
                Some(true) if audio.get(&id) == Some(&true) && !open.contains_key(&id) => {
                    let Some(address) = address(&id) else {
                        continue;
                    };
                    // Not a Fast Pair device, or it said no: nothing more until it connects again.
                    let Ok(Some(socket)) = stream(&id) else {
                        continue;
                    };
                    let (reader, power) = (socket.clone(), power.clone());
                    std::thread::spawn(move || read(&reader, &address, &power));
                    open.insert(id, socket);
                }
                // Closing the socket ends its reader.
                Some(false) => {
                    if let Some(socket) = open.remove(&id) {
                        let _ = socket.Close();
                    }
                }
                _ => {}
            }
        }
    }

    /// The device's Message Stream, opened, or `None` when it has none. The services are asked of the device itself,
    /// not from what Windows kept at pairing, since an update can add the stream.
    fn stream(id: &str) -> windows::core::Result<Option<StreamSocket>> {
        let device = BluetoothDevice::FromIdAsync(&HSTRING::from(id))?.join()?;
        let services = device
            .GetRfcommServicesForIdWithCacheModeAsync(
                &RfcommServiceId::FromUuid(STREAM)?,
                BluetoothCacheMode::Uncached,
            )?
            .join()?
            .Services()?;
        let Ok(service) = services.GetAt(0) else {
            return Ok(None);
        };
        let socket = StreamSocket::new()?;
        socket
            .ConnectAsync(
                &service.ConnectionHostName()?,
                &service.ConnectionServiceName()?,
            )?
            .join()?;
        Ok(Some(socket))
    }

    /// Reads the stream until it closes, as the device leaves or Sumi closes it, and posts each battery it sends.
    /// Asleep in between: the device pushes, nothing is asked.
    fn read(
        socket: &StreamSocket,
        address: &str,
        power: &Sender<Msg>,
    ) -> windows::core::Result<()> {
        let reader = DataReader::CreateDataReader(&socket.InputStream()?)?;
        reader.SetInputStreamOptions(InputStreamOptions::Partial)?;
        let mut frames = Frames::default();
        loop {
            let read = reader.LoadAsync(256)?.join()?;
            if read == 0 {
                return Ok(());
            }
            let mut bytes = vec![0; read as usize];
            reader.ReadBytes(&mut bytes)?;
            let Some(buds) = frames.feed(&bytes) else {
                continue;
            };
            if let Some(percent) = buds.percent()
                && power
                    .send(Msg::Own(address.to_string(), percent, Some(buds)))
                    .is_err()
            {
                return Ok(());
            }
        }
    }

    fn value(props: &IMapView<HSTRING, IInspectable>, key: &str) -> Option<IPropertyValue> {
        props.Lookup(&HSTRING::from(key)).ok()?.cast().ok()
    }

    fn connected(props: &IMapView<HSTRING, IInspectable>) -> Option<bool> {
        value(props, CONNECTED)?.GetBoolean().ok()
    }

    /// Handlers run on Windows' thread pool: they read what came with the event and post it, nothing more.
    fn watcher(tx: &Sender<Heard>) -> windows::core::Result<DeviceWatcher> {
        let keys = IIterable::from(vec![HSTRING::from(CONNECTED), HSTRING::from(MAJOR)]);
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            &HSTRING::from(PAIRED),
            &keys,
            DeviceInformationKind::AssociationEndpoint,
        )?;
        let send = tx.clone();
        watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                if let Some(info) = info.as_ref() {
                    let props = info.Properties()?;
                    let major = value(&props, MAJOR).and_then(|v| v.GetUInt32().ok());
                    let _ = send.send((
                        info.Id()?.to_string(),
                        Some(major == Some(AUDIO)),
                        connected(&props),
                    ));
                }
                Ok(())
            },
        ))?;
        let send = tx.clone();
        watcher.Updated(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                if let Some(update) = update.as_ref() {
                    let _ = send.send((
                        update.Id()?.to_string(),
                        None,
                        connected(&update.Properties()?),
                    ));
                }
                Ok(())
            }),
        )?;
        let send = tx.clone();
        watcher.Removed(
            &TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
                if let Some(update) = update.as_ref() {
                    let _ = send.send((update.Id()?.to_string(), Some(false), Some(false)));
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
    use super::{Buds, Frames};

    #[test]
    fn reads_the_battery_after_the_model_and_the_address() {
        let mut frames = Frames::default();
        // The model ID and the BLE address, as the JBL Go 4 sends them, carry no battery.
        assert_eq!(
            frames.feed(&[0x03, 0x01, 0x00, 0x03, 0x0a, 0x0b, 0x0c]),
            None
        );
        assert_eq!(
            frames.feed(&[0x03, 0x02, 0x00, 0x06, 1, 2, 3, 4, 5, 6]),
            None
        );
        // The specification's own example: left 87 %, right 65 %, the case unknown.
        let buds = frames.feed(&[0x03, 0x03, 0x00, 0x03, 0x57, 0x41, 0x7f]);
        assert_eq!(buds, Some(Buds::new(Some(87), Some(65), None)));
        assert_eq!(buds.and_then(|b| b.percent()), Some(65));
    }

    #[test]
    fn waits_for_a_message_cut_between_two_reads() {
        let mut frames = Frames::default();
        assert_eq!(frames.feed(&[0x03, 0x03, 0x00]), None);
        assert_eq!(frames.feed(&[0x03, 0xd2, 0x50]), None);
        // Bit 7 says a bud charges: the level is the rest.
        assert_eq!(
            frames.feed(&[0x64, 0xff, 0x00]),
            Some(Buds::new(Some(82), Some(80), Some(100)))
        );
    }

    #[test]
    fn keeps_the_last_battery_among_several_messages() {
        let mut frames = Frames::default();
        let both = [
            0x03, 0x03, 0x00, 0x03, 0x50, 0x50, 0x7f, 0x03, 0x03, 0x00, 0x03, 0x4f, 0x50, 0x7f,
        ];
        assert_eq!(
            frames.feed(&both),
            Some(Buds::new(Some(79), Some(80), None))
        );
        assert_eq!(frames.feed(&[]), None);
    }

    #[test]
    fn skips_what_it_does_not_read_and_a_short_battery() {
        let mut frames = Frames::default();
        // An acknowledgement, then a battery too short to read, then a whole one.
        let bytes = [
            0xff, 0x01, 0x00, 0x02, 0x04, 0x01, 0x03, 0x03, 0x00, 0x01, 0x50, 0x03, 0x03, 0x00,
            0x03, 0x30, 0x7f, 0x7f,
        ];
        assert_eq!(frames.feed(&bytes), Some(Buds::new(Some(48), None, None)));
    }

    #[test]
    fn the_level_is_the_lower_bud_or_the_one_known() {
        assert_eq!(Buds::new(Some(40), Some(70), Some(90)).percent(), Some(40));
        assert_eq!(Buds::new(None, Some(70), Some(90)).percent(), Some(70));
        // A headset's one level, as the left.
        assert_eq!(Buds::new(Some(55), None, None).percent(), Some(55));
        // The case alone isn't the device's level.
        assert_eq!(Buds::new(None, None, Some(90)).percent(), None);
    }
}

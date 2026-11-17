//! Music from any app that Windows' media controls can see: Spotify, browsers, VLC and the rest. It runs on its
//! own thread and only wakes up for Windows' events, so nothing runs while nothing changes. What it reads is never
//! logged or written anywhere: it goes to the page and nowhere else.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, Sender, channel};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// One player as the page draws it. Times are in milliseconds, and `updated_ms` is Unix time, like a timer's end:
/// the page moves the progress bar on its own from there, so no message is sent while a song plays.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    pub end_ms: i64,
    pub position_ms: i64,
    pub updated_ms: i64,
    pub rate: f64,
}

/// What was sent last, for a page that starts listening after the first events.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Snapshot {
    players: Vec<Player>,
    artwork: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Play,
    Pause,
    Next,
    Previous,
}

enum Msg {
    Sessions,
    Media(String),
    Playback,
    Control(String, Action),
    Seek(String, i64),
}

/// The thread's mailbox and its last snapshot.
pub struct Media {
    tx: Mutex<Sender<Msg>>,
    snapshot: Mutex<Snapshot>,
}

/// Plays, pauses or skips on one player. The answer isn't awaited: the player's own events tell the page.
#[tauri::command]
pub fn media_control(media: tauri::State<'_, Media>, id: String, action: Action) {
    if let Ok(tx) = media.tx.lock() {
        let _ = tx.send(Msg::Control(id, action));
    }
}

/// Moves one player to `ms` from the start of its song, for a drag on the progress bar.
#[tauri::command]
pub fn media_seek(media: tauri::State<'_, Media>, id: String, ms: i64) {
    if let Ok(tx) = media.tx.lock() {
        let _ = tx.send(Msg::Seek(id, ms));
    }
}

#[tauri::command]
pub fn media_players(media: tauri::State<'_, Media>) -> Snapshot {
    media.snapshot.lock().map(|s| s.clone()).unwrap_or_default()
}

/// Starts watching. Tauri's main thread is single-threaded COM, where waiting on WinRT would freeze the
/// window, so everything happens on a thread of its own. If Windows' media controls are missing, as before
/// Windows 10 1809, the thread ends and the page never hears of music.
pub fn watch(app: &AppHandle) {
    let (tx, rx) = channel();
    app.manage(Media {
        tx: Mutex::new(tx.clone()),
        snapshot: Mutex::default(),
    });
    let app = app.clone();
    std::thread::spawn(move || run(&app, &tx, &rx));
}

/// Whether two lists of players draw the same: a position that only moved on with time isn't news.
fn same(old: &[Player], new: &[Player]) -> bool {
    old.len() == new.len() && old.iter().zip(new).all(|(a, b)| same_player(a, b))
}

fn same_player(old: &Player, new: &Player) -> bool {
    let elapsed = if old.playing {
        (new.updated_ms - old.updated_ms) as f64 * old.rate
    } else {
        0.0
    };
    let jump = new.position_ms as f64 - (old.position_ms as f64 + elapsed);
    jump.abs() < 1_000.0
        && Player {
            position_ms: old.position_ms,
            updated_ms: old.updated_ms,
            ..new.clone()
        } == *old
}

/// The id for a new session of `app`: the app's own, or the first free numbered one when it already has a
/// session. Ids already given never change, so a page never sees one player's id move to another.
fn free_id<'a>(app: &str, taken: impl Iterator<Item = &'a str> + Clone) -> String {
    let free = |id: &str| !taken.clone().any(|t| t == id);
    if free(app) {
        return app.to_string();
    }
    (2..)
        .map(|n| format!("{app}#{n}"))
        .find(|id| free(id))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn run(_: &AppHandle, _: &Sender<Msg>, _: &Receiver<Msg>) {}

#[cfg(windows)]
fn run(app: &AppHandle, tx: &Sender<Msg>, rx: &Receiver<Msg>) {
    win::run(app, tx, rx);
}

#[cfg(windows)]
mod win {
    use std::collections::{HashMap, HashSet};
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
    use std::time::{Duration, Instant};

    use base64::{Engine, engine::general_purpose::STANDARD};
    use serde_json::json;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::core::{HSTRING, IUnknown, Interface, RuntimeType};

    use super::{Action, Media, Msg, Player, free_id, same};

    /// A song change fires the title, then the artwork, then the timeline: one wait gathers them into one message.
    const BURST: Duration = Duration::from_millis(150);
    /// Some players hand over the old artwork, or none, with a new title: it is read again after these delays.
    const LATE_ART: [Duration; 2] = [Duration::from_millis(600), Duration::from_millis(900)];
    const MAX_ART: u32 = 4 << 20;
    /// 1601 to 1970, in the 100 ns ticks of Windows' clock.
    const UNIX_EPOCH: i64 = 116_444_736_000_000_000;

    struct Watched {
        id: String,
        session: Session,
        title: String,
        artist: String,
        tokens: [i64; 3],
    }

    impl Watched {
        fn new(id: String, session: Session, tx: &Sender<Msg>) -> windows::core::Result<Self> {
            let mut w = Self {
                tokens: [0; 3],
                title: String::new(),
                artist: String::new(),
                id,
                session,
            };
            let media = w.id.clone();
            w.tokens[0] = w
                .session
                .MediaPropertiesChanged(&ping(tx, move || Msg::Media(media.clone())))?;
            w.tokens[1] = w.session.PlaybackInfoChanged(&ping(tx, || Msg::Playback))?;
            w.tokens[2] = w
                .session
                .TimelinePropertiesChanged(&ping(tx, || Msg::Playback))?;
            Ok(w)
        }
    }

    impl Drop for Watched {
        fn drop(&mut self) {
            let [media, playback, timeline] = self.tokens;
            let _ = self.session.RemoveMediaPropertiesChanged(media);
            let _ = self.session.RemovePlaybackInfoChanged(playback);
            let _ = self.session.RemoveTimelinePropertiesChanged(timeline);
        }
    }

    /// Whether two handles are one session. COM's identity rule: the same object always answers with the same
    /// IUnknown. Comparing the handles themselves isn't enough, and swapped two players' ids.
    fn same_session(a: &Session, b: &Session) -> bool {
        match (a.cast::<IUnknown>(), b.cast::<IUnknown>()) {
            (Ok(a), Ok(b)) => a.as_raw() == b.as_raw(),
            _ => false,
        }
    }

    /// Handlers run on a Windows thread pool: they only post a message, never call back into WinRT.
    fn ping<S: RuntimeType + 'static, A: RuntimeType + 'static>(
        tx: &Sender<Msg>,
        msg: impl Fn() -> Msg + Send + 'static,
    ) -> TypedEventHandler<S, A> {
        let tx = tx.clone();
        TypedEventHandler::new(move |_, _| {
            let _ = tx.send(msg());
            Ok(())
        })
    }

    // shortcut: a player that hangs inside one of Windows' calls holds this thread until it answers, and music
    // updates wait with it; the rest of Sumi doesn't. Add timeouts if a player is ever seen doing it.
    pub(super) fn run(app: &AppHandle, tx: &Sender<Msg>, rx: &Receiver<Msg>) {
        let Ok(manager) = SessionManager::RequestAsync().and_then(|op| op.join()) else {
            return;
        };
        // The manager lives as long as the loop, and with it the handler.
        if manager
            .SessionsChanged(&ping(tx, || Msg::Sessions))
            .is_err()
        {
            return;
        }
        let mut watched: Vec<Watched> = Vec::new();
        let mut players: Vec<Player> = Vec::new();
        let mut artwork: HashMap<String, String> = HashMap::new();
        // Artwork to read again: when, for which player, and how many reads are left.
        let mut late: Vec<(Instant, String, usize)> = Vec::new();
        let mut next = Some(Msg::Sessions);
        loop {
            let mut sessions = false;
            let mut changed: HashSet<String> = HashSet::new();
            while let Some(msg) = next.take() {
                match msg {
                    Msg::Sessions => sessions = true,
                    Msg::Media(id) => {
                        changed.insert(id);
                    }
                    Msg::Playback => {}
                    Msg::Control(id, action) => {
                        if let Some(w) = watched.iter().find(|w| w.id == id) {
                            control(&w.session, action);
                        }
                    }
                    Msg::Seek(id, ms) => {
                        if let Some(w) = watched.iter().find(|w| w.id == id) {
                            let _ = w.session.TryChangePlaybackPositionAsync(ms.max(0) * 10_000);
                        }
                    }
                }
                next = rx.recv_timeout(BURST).ok();
            }
            let now = Instant::now();
            let mut due: HashMap<String, usize> = HashMap::new();
            late.retain(|(at, id, left)| {
                if *at > now {
                    return true;
                }
                due.insert(id.clone(), *left);
                changed.insert(id.clone());
                false
            });

            if sessions {
                // Sessions still there keep their id and handlers; the ones that went are dropped, which
                // removes their handlers. A restarted app gets a new session, and so a fresh watch.
                let list: Vec<Session> = manager
                    .GetSessions()
                    .map(|s| s.into_iter().collect())
                    .unwrap_or_default();
                let mut kept: Vec<Watched> = Vec::new();
                let mut fresh: Vec<Session> = Vec::new();
                for session in list {
                    match watched
                        .iter()
                        .position(|w| same_session(&w.session, &session))
                    {
                        Some(i) => kept.push(watched.swap_remove(i)),
                        None => fresh.push(session),
                    }
                }
                watched = kept;
                for session in fresh {
                    let app = session
                        .SourceAppUserModelId()
                        .map(|h| h.to_string())
                        .unwrap_or_default();
                    let id = free_id(&app, watched.iter().map(|w| w.id.as_str()));
                    if let Ok(w) = Watched::new(id, session, tx) {
                        watched.push(w);
                    }
                }
                // Some players, Spotify among them, fill in their song as the list changes, without an event
                // of their own: every player is read again.
                changed.extend(watched.iter().map(|w| w.id.clone()));
                // The artwork of a player that went is kept: if it comes back with none, that is news to send.
                late.retain(|(_, id, _)| watched.iter().any(|w| &w.id == id));
            }

            for w in watched.iter_mut().filter(|w| changed.contains(&w.id)) {
                let props = w
                    .session
                    .TryGetMediaPropertiesAsync()
                    .and_then(|op| op.join())
                    .ok();
                let text = |h: Option<windows::core::Result<HSTRING>>| {
                    h.and_then(Result::ok)
                        .map(|h| h.to_string())
                        .unwrap_or_default()
                };
                let title = text(props.as_ref().map(Properties::Title));
                let new_song = title != w.title;
                w.artist = text(props.as_ref().map(Properties::Artist));
                w.title = title;
                let fresh = props.as_ref().and_then(read_artwork);
                if fresh.as_ref() != artwork.get(&w.id) {
                    match &fresh {
                        Some(url) => artwork.insert(w.id.clone(), url.clone()),
                        None => artwork.remove(&w.id),
                    };
                    let _ = app.emit("media://artwork", json!({ "id": w.id, "url": fresh }));
                    // An empty read may only mean the picture isn't ready yet: it is read again below.
                    if fresh.is_some() {
                        continue;
                    }
                }
                // Same artwork as the last song: read again a little later, twice at most.
                let left = if new_song {
                    LATE_ART.len()
                } else {
                    due.get(&w.id).copied().unwrap_or(0)
                };
                if let Some(delay) = LATE_ART
                    .len()
                    .checked_sub(left)
                    .and_then(|i| LATE_ART.get(i))
                {
                    late.push((now + *delay, w.id.clone(), left - 1));
                }
            }

            let fresh: Vec<Player> = watched.iter().filter_map(state).collect();
            if !same(&players, &fresh) {
                let _ = app.emit("media://players", &fresh);
                players = fresh;
            }
            if let Ok(mut snapshot) = app.state::<Media>().snapshot.lock() {
                snapshot.players.clone_from(&players);
                snapshot.artwork.clone_from(&artwork);
            }

            let wait = late.iter().map(|(at, _, _)| *at).min();
            next = match wait {
                Some(at) => match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                    Ok(msg) => Some(msg),
                    Err(RecvTimeoutError::Timeout) => Some(Msg::Playback),
                    Err(RecvTimeoutError::Disconnected) => return,
                },
                None => match rx.recv() {
                    Ok(msg) => Some(msg),
                    Err(_) => return,
                },
            };
        }
    }

    fn state(w: &Watched) -> Option<Player> {
        let info = w.session.GetPlaybackInfo().ok()?;
        let can = info.Controls().ok()?;
        let line = w.session.GetTimelineProperties().ok()?;
        let ms = |ticks: i64| ticks / 10_000;
        Some(Player {
            id: w.id.clone(),
            title: w.title.clone(),
            artist: w.artist.clone(),
            playing: info.PlaybackStatus().ok()? == Status::Playing,
            can_play_pause: can.IsPlayEnabled().unwrap_or(false)
                || can.IsPauseEnabled().unwrap_or(false),
            can_next: can.IsNextEnabled().unwrap_or(false),
            can_previous: can.IsPreviousEnabled().unwrap_or(false),
            can_seek: can.IsPlaybackPositionEnabled().unwrap_or(false),
            end_ms: ms(line.EndTime().ok()?.Duration),
            position_ms: ms(line.Position().ok()?.Duration),
            updated_ms: ms(line.LastUpdatedTime().ok()?.UniversalTime - UNIX_EPOCH),
            rate: info.PlaybackRate().and_then(|r| r.Value()).unwrap_or(1.0),
        })
    }

    /// The artwork as a data: URL, so it reaches the page without a file and the page's CSP already allows it.
    fn read_artwork(p: &Properties) -> Option<String> {
        let stream = p.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = u32::try_from(stream.Size().ok()?)
            .ok()
            .filter(|n| (1..=MAX_ART).contains(n))?;
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let mut bytes = vec![0; reader.LoadAsync(size).ok()?.join().ok()? as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!(
            "data:{};base64,{}",
            kind(&bytes),
            STANDARD.encode(&bytes)
        ))
    }

    /// Read from the bytes: some players label every image as JPEG.
    fn kind(bytes: &[u8]) -> &'static str {
        match bytes {
            [0x89, b'P', b'N', b'G', ..] => "image/png",
            [
                b'R',
                b'I',
                b'F',
                b'F',
                _,
                _,
                _,
                _,
                b'W',
                b'E',
                b'B',
                b'P',
                ..,
            ] => "image/webp",
            [b'G', b'I', b'F', ..] => "image/gif",
            [b'B', b'M', ..] => "image/bmp",
            _ => "image/jpeg",
        }
    }

    fn control(s: &Session, action: Action) {
        let _ = match action {
            Action::Play => s.TryPlayAsync(),
            Action::Pause => s.TryPauseAsync(),
            Action::Next => s.TrySkipNextAsync(),
            Action::Previous => s.TrySkipPreviousAsync(),
        };
    }

    #[cfg(test)]
    mod tests {
        use super::kind;

        #[test]
        fn the_image_type_comes_from_the_bytes() {
            assert_eq!(kind(&[0x89, b'P', b'N', b'G', 0, 0]), "image/png");
            assert_eq!(kind(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
            assert_eq!(kind(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(position_ms: i64, updated_ms: i64, playing: bool) -> Player {
        Player {
            id: "spotify".into(),
            title: "t".into(),
            artist: String::new(),
            playing,
            can_play_pause: true,
            can_next: true,
            can_previous: true,
            can_seek: true,
            end_ms: 200_000,
            position_ms,
            updated_ms,
            rate: 1.0,
        }
    }

    #[test]
    fn a_position_restated_on_time_is_not_news() {
        assert!(same(
            &[player(10_000, 0, true)],
            &[player(15_000, 5_000, true)]
        ));
    }

    #[test]
    fn a_seek_is_news() {
        assert!(!same(
            &[player(10_000, 0, true)],
            &[player(60_000, 5_000, true)]
        ));
    }

    #[test]
    fn a_paused_position_does_not_move() {
        assert!(!same(
            &[player(10_000, 0, false)],
            &[player(15_000, 5_000, false)]
        ));
        assert!(same(
            &[player(10_000, 0, false)],
            &[player(10_000, 5_000, false)]
        ));
    }

    #[test]
    fn pausing_or_a_new_player_is_news() {
        assert!(!same(
            &[player(10_000, 0, true)],
            &[player(10_000, 0, false)]
        ));
        assert!(!same(&[player(10_000, 0, true)], &[]));
    }

    #[test]
    fn a_second_session_of_one_app_gets_the_first_free_id() {
        assert_eq!(free_id("a", ["b"].into_iter()), "a");
        assert_eq!(free_id("a", ["a", "b"].into_iter()), "a#2");
        // The first session ended: its id is free again, and the second keeps `a#2`.
        assert_eq!(free_id("a", ["a#2"].into_iter()), "a");
        assert_eq!(free_id("a", ["a", "a#2"].into_iter()), "a#3");
    }
}

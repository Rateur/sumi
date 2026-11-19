//! The timers' chime. The page owns the timers and keeps them in memory only: nothing here reads or writes a file.
//! Rust plays the chime the page asks for, and nothing runs here between two calls.

use std::sync::OnceLock;

const RATE: u32 = 22_050;

/// A short, soft chime: E6 then C6, two sines that start fast and fade, as a WAV file in memory. Made here rather than
/// shipped, so there is no sound file and no licence to track.
pub fn chime() -> Vec<u8> {
    const LENGTH: f32 = 0.9;
    // Hz, and when each note starts, in s.
    const NOTES: [(f32, f32); 2] = [(1318.5, 0.0), (1046.5, 0.16)];
    let count = (RATE as f32 * LENGTH) as usize;
    let samples: Vec<i16> = (0..count)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            let tone: f32 = NOTES
                .iter()
                .filter(|(_, at)| t >= *at)
                .map(|(hz, at)| {
                    let u = t - at;
                    // A 6 ms attack keeps the start from clicking; the fade sounds like a struck bell.
                    let envelope = (u / 0.006).min(1.0) * (-u / 0.2).exp();
                    let phase = std::f32::consts::TAU * hz * u;
                    envelope * (phase.sin() + 0.2 * (2.0 * phase).sin() * (-u / 0.06).exp())
                })
                .sum();
            // The last 40 ms fade to silence, so the end doesn't click either.
            let tail = ((LENGTH - t) / 0.04).clamp(0.0, 1.0);
            (tone * tail * 0.2 * f32::from(i16::MAX)) as i16
        })
        .collect();
    wav(&samples)
}

/// 16-bit mono PCM in a RIFF header.
fn wav(samples: &[i16]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    // PCM, one channel.
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    // Bytes per frame, bits per sample.
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    samples
        .iter()
        .for_each(|s| out.extend_from_slice(&s.to_le_bytes()));
    out
}

/// Made once, and kept for as long as Sumi runs: Windows reads it while it plays.
static CHIME: OnceLock<Vec<u8>> = OnceLock::new();

/// Plays the chime once, at the volume Windows gives Sumi, and returns at once.
#[tauri::command]
pub fn timer_chime() {
    play(CHIME.get_or_init(chime));
}

#[cfg(windows)]
fn play(wav: &'static [u8]) {
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    // SAFETY: with SND_MEMORY the first argument is a whole WAV file in memory rather than a name. It is static, so it
    // outlives the playback SND_ASYNC leaves running; SND_NODEFAULT keeps Windows from beeping if it can't play it.
    unsafe {
        PlaySoundW(
            wav.as_ptr().cast(),
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        )
    };
}

#[cfg(not(windows))]
fn play(_: &'static [u8]) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_a_soft_wav_that_starts_and_ends_in_silence() {
        let wav = chime();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(&wav[36..40], b"data");
        let data = u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize;
        assert_eq!(wav.len(), 44 + data);
        let samples: Vec<i16> = wav[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))
            .collect();
        // Under a second, and well under full scale.
        assert!(samples.len() < RATE as usize);
        let peak = samples.iter().map(|s| s.unsigned_abs()).max().unwrap();
        assert!(peak > 1000 && peak < i16::MAX as u16 / 2, "peak {peak}");
        assert_eq!(samples[0], 0);
        assert!(samples.last().unwrap().unsigned_abs() < 50);
    }
}

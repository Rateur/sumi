//! The screen capture. `Win+Alt+C`, or « capture » in the command bar, freezes the screen: one BitBlt copies every
//! monitor into RAM, and a window per monitor shows that copy as it was, with no veil, so clicks reach no app. An ink
//! loupe, drawn here, follows the cursor over the frozen pixels. A click copies the colour under it as HEX; a box
//! copies the QR code it holds, or its text through Windows' own OCR. The copy goes on the clipboard, and into the
//! history while that is on. The island stays out of the frame and out of screen captures while the capture lasts.
//! The frame never leaves RAM and is freed as the capture ends. Nothing here runs before the shortcut.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::{bar, clipboard};

// The loupe, in CSS px, scaled by the monitor under the cursor. Mirrored in docs/design.md.
/// The disc's outer radius, and its ink rim.
const RADIUS: f64 = 55.0;
const RIM: f64 = 5.5;
/// 9 × 9 pixels of the frame, 11 px each, with a faint grid of 1 px at 22 %.
const CELLS: usize = 9;
const CELL: f64 = 11.0;
const GRID: f64 = 0.22;
/// The disc's shadow, as CSS `drop-shadow(0 4px 10px rgb(0 0 0 / 0.35))`: a blur of 10 px is a Gaussian of σ 5.
const SHADOW: (f64, f64, f64) = (4.0, 5.0, 0.35);
/// The bitmap the loupe is drawn on: the disc stretched and overshooting, and its shadow.
const MARGIN: f64 = RADIUS * 1.08 + SHADOW.0 + 3.0 * SHADOW.1;
/// Springs as `src/lib/motion.ts` sets them: the disc follows the hotspot on [0.14, 0], grows from the pixel as the
/// bubble's drop (`SPLIT.r`) and goes back into it on `MERGE`.
const FOLLOW: (f64, f64) = (0.14, 0.0);
const GROW: (f64, f64) = (0.4, 0.25);
const MERGE: (f64, f64) = (0.36, 0.0);
/// With reduced motion, the loupe fades in and out in this many ms instead.
const REDUCED: f64 = 120.0;
/// The frozen frame fades out over `FADE` ms, `AFTER` ms after a result; the box outline at once.
const FADE: f64 = 160.0;
const AFTER: f64 = 60.0;
/// The box: a 1.5 px white line at 95 % under 1.5 px black dashes, 5 on and 4 off, round corners of 3 px, marching at
/// 14 px a second.
const LINE: f64 = 1.5;
const DASH: (f64, f64) = (5.0, 4.0);
const CORNER: f64 = 3.0;
const MARCH: f64 = 14.0;
/// How far a QR code may reach past the box and still be whole in it.
const TOLERANCE: f64 = 4.0;

/// How a capture ended. Mirrored as `Captured` in src/lib/capture.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Captured {
    /// A colour, copied as HEX.
    Colour { hex: String },
    /// A box's text, copied, and how many words it holds.
    Text { words: usize },
    /// A QR code holding a link, copied, and the link's site.
    Link { host: String },
    /// A QR code holding anything else, copied.
    Code,
    /// A box with no text in it. Nothing was copied.
    Empty,
    /// Windows has no OCR language. Nothing was copied.
    Unreadable,
    /// Esc, or the island lost the focus. Nothing was copied.
    Cancelled,
    /// The screen couldn't be read, or the clipboard written.
    Failed,
}

/// A key the island hears during a capture and hands over: it has the focus, the frozen frame never does. Mirrored as
/// `CaptureKey` in src/lib/capture.ts.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Key {
    Escape,
    Left,
    Right,
    Up,
    Down,
    Shift,
}

#[derive(Default)]
pub struct Capture {
    /// The first frame window while the capture takes input, which hears the page's keys; 0 otherwise.
    window: AtomicUsize,
    /// From the press until the last window is gone: a second press meanwhile is ignored.
    running: AtomicBool,
}

/// Freezes the screen, and answers once the capture has a result: on the click, once the box is read, or on Esc.
/// `reduced` is the page's reduced motion.
#[tauri::command]
pub async fn capture_start(window: WebviewWindow, reduced: bool) -> Captured {
    let state = window.state::<Capture>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Captured::Cancelled;
    }
    // The island hears the keys: the frozen frame never takes the focus, so it never covers the island.
    bar::take(&window);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        os::run(&window, reduced, tx);
        window
            .state::<Capture>()
            .running
            .store(false, Ordering::SeqCst);
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Captured::Failed))
        .await
        .unwrap_or(Captured::Failed)
}

/// A key pressed or let go on the island while the capture takes input.
#[tauri::command]
pub fn capture_key(state: State<'_, Capture>, key: Key, down: bool) {
    os::key(state.window.load(Ordering::SeqCst), key, down);
}

/// Puts a box's result on the clipboard and in the history: a QR code's content, or else its text.
fn recognise(app: &AppHandle, text: &Crop, wide: &Crop) -> Captured {
    let copy = |content: String, captured: Captured| {
        if clipboard::keep(app, content) {
            captured
        } else {
            Captured::Failed
        }
    };
    if let Some(content) = qr(wide) {
        return match host(&content) {
            Some(host) => copy(content, Captured::Link { host }),
            None => copy(content, Captured::Code),
        };
    }
    match os::read(text) {
        Read::Text(lines, n) if n > 0 => copy(lines, Captured::Text { words: n }),
        Read::Text(..) => Captured::Empty,
        Read::Unreadable => Captured::Unreadable,
        Read::Failed => Captured::Failed,
    }
}

/// What Windows' OCR found: the lines and how many words they hold, or why it read nothing.
enum Read {
    Text(String, usize),
    Unreadable,
    Failed,
}

/// A QR code in `crop` and its content. The box is taken a little wider, so a code drawn up to its edges counts.
fn qr(crop: &Crop) -> Option<String> {
    let mut image = rqrr::PreparedImage::prepare_from_greyscale(crop.width, crop.height, |x, y| {
        luma(crop.pixels[y * crop.width + x])
    });
    image
        .detect_grids()
        .into_iter()
        .find_map(|grid| grid.decode().ok().map(|(_, content)| content))
}

/// A pixel's lightness for the QR reader, by Rec. 601.
fn luma(pixel: u32) -> u8 {
    let [b, g, r, _] = pixel.to_le_bytes();
    ((299 * u32::from(r) + 587 * u32::from(g) + 114 * u32::from(b)) / 1000) as u8
}

/// The site of a link, as the island shows it: `example.com` for `https://www.example.com/a?b`.
fn host(text: &str) -> Option<String> {
    let lower = text.trim().to_ascii_lowercase();
    let rest = ["https://", "http://"]
        .iter()
        .find_map(|scheme| lower.strip_prefix(scheme))?;
    let site = rest.split(['/', '?', '#']).next()?;
    let site = site.strip_prefix("www.").unwrap_or(site);
    (!site.is_empty() && !text.trim().contains(char::is_whitespace)).then(|| site.to_string())
}

/// How many words the OCR read: those with a letter or a digit, so a lone dash or bullet doesn't count.
fn words<'a>(read: impl IntoIterator<Item = &'a str>) -> usize {
    read.into_iter()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .count()
}

/// A spring as `src/lib/spring.ts` sets one, in closed form: duration in seconds and bounce, times in ms.
#[derive(Clone, Copy, Debug)]
struct Spring {
    value: f64,
    velocity: f64,
    target: f64,
    resting: bool,
    x0: f64,
    v0: f64,
    t0: f64,
    omega: f64,
    zeta: f64,
}

impl Spring {
    fn new(value: f64) -> Self {
        Self {
            value,
            velocity: 0.0,
            target: value,
            resting: true,
            x0: value,
            v0: 0.0,
            t0: 0.0,
            omega: std::f64::consts::PI,
            zeta: 1.0,
        }
    }

    fn to(&mut self, target: f64, (duration, bounce): (f64, f64), now: f64) {
        self.restart(now);
        self.target = target;
        self.omega = std::f64::consts::TAU / duration;
        self.zeta = 1.0 - bounce;
    }

    fn jump(&mut self, value: f64) {
        *self = Self::new(value);
    }

    /// Samples the spring at `now`, and snaps it to its target once settled.
    fn update(&mut self, now: f64) {
        if self.resting {
            return;
        }
        let (x, v) = self.at(now);
        if (x - self.target).abs() < 0.1 && v.abs() < 2.0 {
            self.jump(self.target);
            return;
        }
        self.value = x;
        self.velocity = v;
    }

    fn restart(&mut self, now: f64) {
        (self.x0, self.v0) = self.at(now);
        self.t0 = now;
        self.resting = false;
    }

    fn at(&self, now: f64) -> (f64, f64) {
        let t = (now - self.t0).max(0.0) / 1000.0;
        let (w, z, a, v0) = (self.omega, self.zeta, self.x0 - self.target, self.v0);
        if z < 1.0 {
            let wd = w * (1.0 - z * z).sqrt();
            let b = (v0 + z * w * a) / wd;
            let (e, c, s) = ((-z * w * t).exp(), (wd * t).cos(), (wd * t).sin());
            return (
                self.target + e * (a * c + b * s),
                e * ((b * wd - z * w * a) * c - (a * wd + z * w * b) * s),
            );
        }
        let b = v0 + w * a;
        let e = (-w * t).exp();
        (self.target + e * (a + b * t), e * (b - w * (a + b * t)))
    }
}

/// An opacity going from `from` to `to` over `ms` from `start`, on `EXIT`'s curve, or straight with reduced motion.
#[derive(Clone, Copy, Debug)]
struct Fade {
    from: f64,
    to: f64,
    start: f64,
    ms: f64,
    straight: bool,
}

impl Fade {
    fn at(&self, now: f64) -> f64 {
        if self.done(now) {
            return self.to;
        }
        if now <= self.start {
            return self.from;
        }
        let p = (now - self.start) / self.ms;
        let p = if self.straight {
            p
        } else {
            bezier((0.4, 0.0, 1.0, 1.0), p)
        };
        self.from + (self.to - self.from) * p
    }

    fn done(&self, now: f64) -> bool {
        now >= self.start + self.ms
    }
}

/// A CSS `cubic-bezier()` at `x`, as `bezier` in src/lib/motion.ts.
fn bezier((x1, y1, x2, y2): (f64, f64, f64, f64), x: f64) -> f64 {
    let at = |p1: f64, p2: f64, t: f64| {
        3.0 * p1 * t * (1.0 - t).powi(2) + 3.0 * p2 * (1.0 - t) * t * t + t.powi(3)
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..24 {
        let t = (lo + hi) / 2.0;
        if at(x1, x2, t) < x {
            lo = t;
        } else {
            hi = t;
        }
    }
    at(y1, y2, (lo + hi) / 2.0)
}

/// The rim's stretch along its motion, as `squash` in src/lib/motion.ts: 4e-5 per CSS px/s, 4 % at most.
fn squash(speed: f64) -> f64 {
    (speed * 4e-5).clamp(-0.04, 0.04)
}

/// The frame's pixels, rows of BGRA as GDI gives them.
struct Pixels<'a> {
    data: &'a [u32],
    width: usize,
    height: usize,
}

impl Pixels<'_> {
    /// The pixel at (x, y), or the nearest edge's past the frame. The frame is never empty.
    fn at(&self, x: i64, y: i64) -> u32 {
        let x = x.clamp(0, self.width as i64 - 1) as usize;
        let y = y.clamp(0, self.height as i64 - 1) as usize;
        self.data[y * self.width + x]
    }

    /// The 9 × 9 pixels centred on (x, y), by rows.
    fn around(&self, x: i64, y: i64) -> [[u32; CELLS]; CELLS] {
        let half = (CELLS / 2) as i64;
        std::array::from_fn(|j| {
            std::array::from_fn(|i| self.at(x + i as i64 - half, y + j as i64 - half))
        })
    }

    /// The pixels in `[left, top, right, bottom)`, in the frame's coordinates, with an opaque alpha: GDI leaves it
    /// at 0, and the OCR reads Bgra8.
    fn crop(&self, [left, top, right, bottom]: [i64; 4]) -> Crop {
        let (width, height) = (
            (right - left).max(0) as usize,
            (bottom - top).max(0) as usize,
        );
        let mut pixels = Vec::with_capacity(width * height);
        for y in top..bottom {
            pixels.extend((left..right).map(|x| self.at(x, y) | 0xFF00_0000));
        }
        Crop {
            pixels,
            width,
            height,
        }
    }
}

/// A part of the frame, copied out of it for the QR reader and the OCR, so the frame itself can go at once.
struct Crop {
    pixels: Vec<u32>,
    width: usize,
    height: usize,
}

impl Crop {
    /// Scaled by `by` to the nearest pixel: a small box read twice as large gives the OCR letters it knows.
    fn scaled(&self, by: f64) -> Crop {
        let width = ((self.width as f64 * by).round() as usize).max(1);
        let height = ((self.height as f64 * by).round() as usize).max(1);
        let mut pixels = Vec::with_capacity(width * height);
        for y in 0..height {
            let from = ((y as f64 / by) as usize).min(self.height - 1) * self.width;
            pixels.extend(
                (0..width)
                    .map(|x| self.pixels[from + ((x as f64 / by) as usize).min(self.width - 1)]),
            );
        }
        Crop {
            pixels,
            width,
            height,
        }
    }
}

/// How much to scale a box for the OCR, which reads `limit` px a side at most: twice when that still fits, which
/// helps the small letters of a screen, and down to fit otherwise.
fn fit(width: usize, height: usize, limit: usize) -> f64 {
    let side = width.max(height).max(1) as f64;
    let limit = limit as f64;
    if 2.0 * side <= limit {
        2.0
    } else {
        (limit / side).min(1.0)
    }
}

/// `rect` grown by `by` on every side and kept within `bounds`, all as `[left, top, right, bottom]`.
fn grown([left, top, right, bottom]: [i64; 4], by: i64, bounds: [i64; 4]) -> [i64; 4] {
    [
        (left - by).max(bounds[0]),
        (top - by).max(bounds[1]),
        (right + by).min(bounds[2]),
        (bottom + by).min(bounds[3]),
    ]
}

/// The box from the press to the cursor, both pixels in.
fn spanned((ax, ay): (i32, i32), (px, py): (i32, i32)) -> [i64; 4] {
    [
        i64::from(ax.min(px)),
        i64::from(ay.min(py)),
        i64::from(ax.max(px)) + 1,
        i64::from(ay.max(py)) + 1,
    ]
}

/// The cell the loupe picks: the centre, or for a text's colour the one farthest from the commonest colour around,
/// which is the background. On a dark app the text is light, so the darkest pixel would be its background. A nearer
/// cell wins a tie. Returns (column, row).
fn picked(cells: &[[u32; CELLS]; CELLS], text: bool) -> (usize, usize) {
    let half = CELLS / 2;
    if !text {
        return (half, half);
    }
    let rgb = |pixel: u32| pixel & 0x00FF_FFFF;
    // The commonest colour, the first seen among equals.
    let mut counts: Vec<(u32, usize)> = Vec::new();
    for &pixel in cells.iter().flatten() {
        match counts.iter_mut().find(|(colour, _)| *colour == rgb(pixel)) {
            Some((_, n)) => *n += 1,
            None => counts.push((rgb(pixel), 1)),
        }
    }
    let back = counts
        .iter()
        .fold(
            (0, 0),
            |best, &(colour, n)| if n > best.1 { (colour, n) } else { best },
        )
        .0
        .to_le_bytes();
    let mut best = (-1.0, (half, half));
    for (j, row) in cells.iter().enumerate() {
        for (i, &pixel) in row.iter().enumerate() {
            let far: f64 = pixel.to_le_bytes()[..3]
                .iter()
                .zip(&back)
                .map(|(&a, &b)| (f64::from(a) - f64::from(b)).powi(2))
                .sum();
            let (di, dj) = (i as f64 - half as f64, j as f64 - half as f64);
            let score = far - (di * di + dj * dj) * 0.01;
            if score > best.0 {
                best = (score, (i, j));
            }
        }
    }
    best.1
}

/// `#RRGGBB` for a BGRA pixel.
fn hex(pixel: u32) -> String {
    format!("#{:06X}", pixel & 0x00FF_FFFF)
}

/// The loupe as it is drawn, in physical px on a bitmap of its own.
struct Lens {
    /// The disc's centre on the bitmap.
    centre: (f64, f64),
    /// Physical px per CSS px, on the monitor under the cursor.
    scale: f64,
    /// The disc's outer radius in CSS px: up to `RADIUS` as it grows out of the pixel, and back to 0.
    radius: f64,
    /// The rim's stretch along `angle`, the motion's direction in radians.
    stretch: f64,
    angle: f64,
    cells: [[u32; CELLS]; CELLS],
    /// The picked cell, ringed: (column, row).
    picked: (usize, usize),
}

/// How much of a pixel `[x, x + 1)` the span `[from, to)` covers along one axis.
fn span(x: f64, from: f64, to: f64) -> f64 {
    ((x + 1.0).min(to) - x.max(from)).max(0.0)
}

/// `erf`, to within 1.5e-7 (Abramowitz and Stegun 7.1.26): enough for a shadow's edge.
fn erf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.327_591_1 * x.abs());
    let y = 1.0
        - (((((1.061_405_429 * t - 1.453_152_027) * t) + 1.421_413_741) * t - 0.284_496_736) * t
            + 0.254_829_592)
            * t
            * (-x * x).exp();
    y.copysign(x)
}

/// Mixes `over` into the BGR channels of `under` by `alpha`.
fn mix(under: [f64; 3], over: [f64; 3], alpha: f64) -> [f64; 3] {
    std::array::from_fn(|i| under[i] + (over[i] - under[i]) * alpha)
}

impl Lens {
    /// Draws the loupe on `out`, a `side` × `side` bitmap of premultiplied BGRA: the shadow, the ink rim stretched
    /// along the motion, then the pixels in a disc that never stretches, their grid, and the picked one ringed white
    /// over black.
    fn draw(&self, side: usize, out: &mut [u32]) {
        let s = self.scale;
        if self.radius <= 0.0 {
            return out.fill(0);
        }
        let grow = self.radius / RADIUS;
        let (rx, ry) = (
            self.radius * s * (1.0 + self.stretch),
            self.radius * s / (1.0 + self.stretch),
        );
        let (sin, cos) = self.angle.sin_cos();
        // Distance to the rim's edge, in physical px, outside positive. Its stretch is 4 % at most, so the radial
        // distance in the ellipse's own frame is close enough.
        let rim = |x: f64, y: f64| {
            let (u, v) = (x * cos + y * sin, -x * sin + y * cos);
            ((u / rx).hypot(v / ry) - 1.0) * (rx + ry) / 2.0
        };
        let lens = (RADIUS - RIM) * s * grow;
        // A CSS px of the lens at its full size, in physical px.
        let unit = s * grow;
        let at = |css: f64| (css - (RADIUS - RIM)) * unit;
        let (ci, cj) = (self.picked.0 as f64 * CELL, self.picked.1 as f64 * CELL);
        // The ring's path runs 1 px outside the cell; black 3 px wide, white 1.5 px over it.
        let ring = |x: f64, y: f64, width: f64| {
            let band = |grow: f64| {
                span(x, at(ci - 1.0 - grow), at(ci + CELL + 1.0 + grow))
                    * span(y, at(cj - 1.0 - grow), at(cj + CELL + 1.0 + grow))
            };
            band(width / 2.0) - band(-width / 2.0)
        };
        let grid = |x: f64| {
            (1..CELLS)
                .map(|k| at(k as f64 * CELL))
                .map(|line| span(x, line - unit / 2.0, line + unit / 2.0))
                .fold(0.0, f64::max)
        };
        for (n, pixel) in out.iter_mut().enumerate().take(side * side) {
            let (x, y) = (
                (n % side) as f64 - self.centre.0,
                (n / side) as f64 - self.centre.1,
            );
            let (cx, cy) = (x + 0.5, y + 0.5);
            let shadow = SHADOW.2
                * 0.5
                * (1.0
                    - erf(rim(cx, cy - SHADOW.0 * s) / (SHADOW.1 * s * std::f64::consts::SQRT_2)));
            let ink = (0.5 - rim(cx, cy)).clamp(0.0, 1.0);
            let disc = (0.5 - (cx.hypot(cy) - lens)).clamp(0.0, 1.0);
            let mut alpha = ink + shadow * (1.0 - ink);
            let mut colour = [0.0; 3];
            if disc > 0.0 && unit > 0.0 {
                let cell = |v: f64| {
                    ((v / unit + RADIUS - RIM) / CELL)
                        .floor()
                        .clamp(0.0, (CELLS - 1) as f64) as usize
                };
                let [b, g, r, _] = self.cells[cell(cy)][cell(cx)].to_le_bytes();
                let mut c = [f64::from(b), f64::from(g), f64::from(r)];
                let lines = 1.0 - (1.0 - grid(x)) * (1.0 - grid(y));
                c = mix(c, [128.0; 3], GRID * lines);
                c = mix(c, [0.0; 3], ring(x, y, 3.0 * unit).clamp(0.0, 1.0));
                c = mix(c, [255.0; 3], ring(x, y, 1.5 * unit).clamp(0.0, 1.0));
                colour = c.map(|v| v * disc);
                alpha = disc + alpha * (1.0 - disc);
            }
            let [b, g, r] = colour.map(|v| v.round().clamp(0.0, 255.0) as u8);
            *pixel = u32::from_le_bytes([b, g, r, (alpha * 255.0).round().clamp(0.0, 255.0) as u8]);
        }
    }
}

/// The box's outline, in physical px of the virtual screen.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Outline {
    /// `[left, top, right, bottom]`, the path's corners.
    rect: [f64; 4],
    scale: f64,
    /// How far the dashes have marched along the path, in physical px.
    march: f64,
    alpha: f64,
}

impl Outline {
    /// The corner's radius, never more than half a side.
    fn corner(&self) -> f64 {
        let [left, top, right, bottom] = self.rect;
        (CORNER * self.scale)
            .min((right - left) / 2.0)
            .min((bottom - top) / 2.0)
    }

    /// The distance from (x, y) to the path, inside negative.
    fn distance(&self, x: f64, y: f64) -> f64 {
        let [left, top, right, bottom] = self.rect;
        let r = self.corner();
        let (hx, hy) = ((right - left) / 2.0 - r, (bottom - top) / 2.0 - r);
        let (qx, qy) = (
            (x - (left + right) / 2.0).abs() - hx,
            (y - (top + bottom) / 2.0).abs() - hy,
        );
        qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
    }

    /// Where the point nearest (x, y) is along the path, from the top left going clockwise, as SVG draws a `rect`.
    fn along(&self, x: f64, y: f64) -> f64 {
        let [left, top, right, bottom] = self.rect;
        let r = self.corner();
        let (x0, x1, y0, y1) = (left + r, right - r, top + r, bottom - r);
        let (w, h, arc) = (x1 - x0, y1 - y0, std::f64::consts::FRAC_PI_2 * r);
        let (dx, dy) = (x - x.clamp(x0, x1), y - y.clamp(y0, y1));
        let side = match (dx == 0.0, dy == 0.0) {
            // Within the corners' centres: the nearest side.
            (true, true) => {
                let near = [y - top, right - x, bottom - y, x - left];
                (0..4).fold(0, |best, i| if near[i] < near[best] { i } else { best })
            }
            (true, false) => {
                if dy < 0.0 {
                    0
                } else {
                    2
                }
            }
            (false, true) => {
                if dx > 0.0 {
                    1
                } else {
                    3
                }
            }
            (false, false) => {
                // A corner: how far round its arc, clockwise.
                let turn = |a: f64, b: f64| a.atan2(b) * r;
                return match (dx > 0.0, dy > 0.0) {
                    (true, false) => w + turn(dx, -dy),
                    (true, true) => w + arc + h + turn(dy, dx),
                    (false, true) => 2.0 * w + 2.0 * arc + h + turn(-dx, dy),
                    (false, false) => 2.0 * w + 3.0 * arc + 2.0 * h + turn(-dy, -dx),
                };
            }
        };
        match side {
            0 => x.clamp(x0, x1) - x0,
            1 => w + arc + y.clamp(y0, y1) - y0,
            2 => w + 2.0 * arc + h + x1 - x.clamp(x0, x1),
            _ => 2.0 * w + 3.0 * arc + h + y1 - y.clamp(y0, y1),
        }
    }

    /// How much of the pixel at (x, y) the white line covers, and the black dashes over it.
    fn cover(&self, x: f64, y: f64) -> (f64, f64) {
        let (cx, cy) = (x + 0.5, y + 0.5);
        let line = (LINE * self.scale / 2.0 + 0.5 - self.distance(cx, cy).abs()).clamp(0.0, 1.0);
        if line == 0.0 {
            return (0.0, 0.0);
        }
        let period = (DASH.0 + DASH.1) * self.scale;
        let dash = (self.along(cx, cy) - self.march).rem_euclid(period) < DASH.0 * self.scale;
        (line, if dash { line } else { 0.0 })
    }

    /// The four bands the outline is drawn in, as `[left, top, right, bottom]` in whole pixels: the top and bottom
    /// ones whole, the sides between them, so no pixel is in two.
    fn bands(&self) -> [[i64; 4]; 4] {
        let e = LINE * self.scale / 2.0 + 2.0;
        let [left, top, right, bottom] = self.rect;
        let (l, t, r, b) = (
            (left - e).floor() as i64,
            (top - e).floor() as i64,
            (right + e).ceil() as i64,
            (bottom + e).ceil() as i64,
        );
        let (ti, bi) = ((top + e).ceil() as i64, (bottom - e).floor() as i64);
        let (li, ri) = ((left + e).ceil() as i64, (right - e).floor() as i64);
        [
            [l, t, r, ti.min(b)],
            [l, bi.max(ti.min(b)), r, b],
            [l, ti.min(b), li.min(r), bi.max(ti.min(b))],
            [ri.max(li.min(r)), ti.min(b), r, bi.max(ti.min(b))],
        ]
    }
}

#[cfg(windows)]
mod os {
    use std::cell::{Cell, RefCell};
    use std::sync::atomic::Ordering;
    use std::sync::mpsc::Sender;
    use std::time::{Duration, Instant};

    use tauri::{Emitter, Manager, WebviewWindow};
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
    use windows_sys::Win32::Graphics::Dwm::DwmFlush;
    use windows_sys::Win32::Graphics::Gdi::{
        AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, BeginPaint,
        BitBlt, CAPTUREBLT, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, EndPaint, EnumDisplayMonitors, GdiFlush, GetDC, GetMonitorInfoW, HBITMAP,
        HDC, HGDIOBJ, HMONITOR, InvalidateRect, MONITORINFO, PAINTSTRUCT, ReleaseDC, SRCCOPY,
        SelectObject, UpdateWindow,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::HiDpi::{
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForMonitor, MDT_EFFECTIVE_DPI,
        SetThreadDpiAwarenessContext,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
        GetMessageW, HCURSOR, HWND_TOPMOST, IDC_ARROW, IDC_CROSS, LWA_ALPHA, LoadCursorW,
        MA_NOACTIVATE, MSG, PM_REMOVE, PeekMessageW, PostMessageW, RegisterClassW, SW_HIDE,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetCursor, SetCursorPos,
        SetLayeredWindowAttributes, SetWindowDisplayAffinity, SetWindowPos, ShowWindow, ULW_ALPHA,
        UpdateLayeredWindow, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WM_APP, WM_DISPLAYCHANGE,
        WM_DPICHANGED, WM_ERASEBKGND, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE,
        WM_PAINT, WM_SETCURSOR, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    };

    use super::{
        AFTER, CELLS, Capture, Captured, Crop, FADE, FOLLOW, Fade, GROW, Key, Lens, MARCH, MARGIN,
        MERGE, Outline, Pixels, RADIUS, REDUCED, Read, Spring, TOLERANCE, grown, hex, picked,
        spanned, squash,
    };
    use crate::{bar, clipboard, island};

    /// Posted to the first frame window by `capture_key`: `wparam` the key, `lparam` 1 when pressed.
    const KEY: u32 = WM_APP;
    const KEYS: [Key; 6] = [
        Key::Escape,
        Key::Left,
        Key::Right,
        Key::Up,
        Key::Down,
        Key::Shift,
    ];

    /// What the windows' procedure heard, for the loop to act on outside it.
    #[derive(Clone, Copy)]
    enum Heard {
        Move,
        Down,
        Up,
        Key(Key, bool),
        /// A monitor came, went or changed: the frame no longer matches the screens.
        Gone,
    }

    /// What the frame windows paint, read in their procedure on the capture's thread.
    struct Shown {
        frame: HDC,
        /// The frame's top left on the virtual screen.
        origin: (i32, i32),
        /// Each frame window and its monitor's top left.
        windows: Vec<(HWND, i32, i32)>,
        outline: Option<Outline>,
    }

    thread_local! {
        static SHOWN: RefCell<Option<Shown>> = const { RefCell::new(None) };
        static HEARD: RefCell<Vec<Heard>> = const { RefCell::new(Vec::new()) };
        /// The cursor over the frame: none while the loupe is the cursor.
        static POINTER: Cell<usize> = const { Cell::new(0) };
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    /// Hands a key to the capture's thread, if one takes input.
    pub fn key(window: usize, key: Key, down: bool) {
        let Some(code) = KEYS.iter().position(|&k| k == key) else {
            return;
        };
        if window != 0 {
            unsafe { PostMessageW(window as HWND, KEY, code, isize::from(down)) };
        }
    }

    /// A monitor in physical px, and its scale.
    struct Screen {
        rect: RECT,
        scale: f64,
    }

    fn screens() -> Vec<Screen> {
        unsafe extern "system" fn each(
            monitor: HMONITOR,
            _: HDC,
            _: *mut RECT,
            found: LPARAM,
        ) -> windows_sys::core::BOOL {
            // SAFETY: `found` is the Vec that `screens` passes below, alive and not otherwise borrowed during the call.
            let found = unsafe { &mut *(found as *mut Vec<Screen>) };
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let (mut dpi, mut unused) = (96, 96);
            unsafe {
                if GetMonitorInfoW(monitor, &mut info) != 0 {
                    GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut unused);
                    found.push(Screen {
                        rect: info.rcMonitor,
                        scale: f64::from(dpi.max(96)) / 96.0,
                    });
                }
            }
            1
        }
        let mut found: Vec<Screen> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                Some(each),
                (&raw mut found) as LPARAM,
            )
        };
        found
    }

    /// A 32-bit top-down DIB selected into a memory DC: its pixels can be read and written, and GDI can blit it.
    struct Dib {
        dc: HDC,
        bitmap: HBITMAP,
        old: HGDIOBJ,
        bits: *mut u32,
        width: usize,
        height: usize,
    }

    impl Dib {
        fn new(width: usize, height: usize) -> Option<Dib> {
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: i32::try_from(width).ok()?,
                    biHeight: -i32::try_from(height).ok()?,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            // SAFETY: `info` describes a plain 32-bit DIB; Windows allocates its bits and writes their address.
            unsafe {
                let dc = CreateCompatibleDC(std::ptr::null_mut());
                if dc.is_null() {
                    return None;
                }
                let bitmap = CreateDIBSection(
                    dc,
                    &info,
                    DIB_RGB_COLORS,
                    &mut bits,
                    std::ptr::null_mut(),
                    0,
                );
                if bitmap.is_null() || bits.is_null() {
                    DeleteDC(dc);
                    return None;
                }
                let old = SelectObject(dc, bitmap);
                Some(Dib {
                    dc,
                    bitmap,
                    old,
                    bits: bits.cast(),
                    width,
                    height,
                })
            }
        }

        fn pixels(&self) -> &[u32] {
            // SAFETY: the section holds width × height 32-bit pixels for as long as `self`, and GDI is flushed before
            // they are read.
            unsafe { std::slice::from_raw_parts(self.bits, self.width * self.height) }
        }

        fn pixels_mut(&mut self) -> &mut [u32] {
            // SAFETY: as `pixels`, and `&mut self` keeps this the only view.
            unsafe { std::slice::from_raw_parts_mut(self.bits, self.width * self.height) }
        }
    }

    impl Drop for Dib {
        fn drop(&mut self) {
            unsafe {
                SelectObject(self.dc, self.old);
                DeleteObject(self.bitmap);
                DeleteDC(self.dc);
            }
        }
    }

    /// The screen as it was at the press, every monitor, into RAM.
    fn grab(left: i32, top: i32, width: usize, height: usize) -> Option<Dib> {
        let frame = Dib::new(width, height)?;
        unsafe {
            let screen = GetDC(std::ptr::null_mut());
            // CAPTUREBLT takes layered windows too: menus, tooltips.
            let copied = BitBlt(
                frame.dc,
                0,
                0,
                width as i32,
                height as i32,
                screen,
                left,
                top,
                SRCCOPY | CAPTUREBLT,
            ) != 0;
            ReleaseDC(std::ptr::null_mut(), screen);
            GdiFlush();
            copied.then_some(frame)
        }
    }

    fn hide(window: HWND, hidden: bool) {
        let affinity = if hidden {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        unsafe { SetWindowDisplayAffinity(window, affinity) };
    }

    fn cursor() -> (i32, i32) {
        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) };
        (point.x, point.y)
    }

    fn heard(heard: Heard) {
        HEARD.with_borrow_mut(|all| all.push(heard));
    }

    unsafe extern "system" fn procedure(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_MOUSEMOVE => heard(Heard::Move),
            WM_LBUTTONDOWN => {
                heard(Heard::Down);
                unsafe { SetCapture(hwnd) };
            }
            WM_LBUTTONUP => {
                heard(Heard::Up);
                unsafe { ReleaseCapture() };
            }
            KEY => {
                if let Some(&key) = KEYS.get(wparam) {
                    heard(Heard::Key(key, lparam != 0));
                }
            }
            WM_DISPLAYCHANGE => heard(Heard::Gone),
            WM_SETCURSOR => unsafe {
                SetCursor(POINTER.get() as HCURSOR);
                return 1;
            },
            WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
            // The frames never move, and the loupe sizes itself.
            WM_DPICHANGED => {}
            WM_ERASEBKGND => return 1,
            WM_PAINT => paint(hwnd),
            _ => return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
        0
    }

    /// Paints the frozen frame, and the box's outline over it where it passes.
    fn paint(hwnd: HWND) {
        let mut ps = PAINTSTRUCT::default();
        let dc = unsafe { BeginPaint(hwnd, &mut ps) };
        SHOWN.with(|shown| {
            if let Ok(shown) = shown.try_borrow()
                && let Some(shown) = shown.as_ref()
            {
                shown.paint(hwnd, dc, ps.rcPaint);
            }
        });
        unsafe { EndPaint(hwnd, &ps) };
    }

    impl Shown {
        fn paint(&self, hwnd: HWND, dc: HDC, area: RECT) {
            let Some(&(_, left, top)) = self.windows.iter().find(|w| w.0 == hwnd) else {
                return;
            };
            let (width, height) = (area.right - area.left, area.bottom - area.top);
            let (vx, vy) = (area.left + left, area.top + top);
            let (fx, fy) = (vx - self.origin.0, vy - self.origin.1);
            let blit = |from: HDC, x: i32, y: i32| unsafe {
                BitBlt(dc, area.left, area.top, width, height, from, x, y, SRCCOPY);
            };
            let painted = [
                i64::from(vx),
                i64::from(vy),
                i64::from(vx + width),
                i64::from(vy + height),
            ];
            let crossing = |band: &[i64; 4]| {
                band[0] < painted[2]
                    && painted[0] < band[2]
                    && band[1] < painted[3]
                    && painted[1] < band[3]
            };
            let outline = self
                .outline
                .filter(|o| o.alpha > 0.0 && o.bands().iter().any(crossing));
            let back = outline.and_then(|_| Dib::new(width as usize, height as usize));
            let (Some(outline), Some(mut back)) = (outline, back) else {
                return blit(self.frame, fx, fy);
            };
            unsafe {
                BitBlt(back.dc, 0, 0, width, height, self.frame, fx, fy, SRCCOPY);
                GdiFlush();
            }
            let row = width as usize;
            let pixels = back.pixels_mut();
            for band in outline.bands() {
                let [l, t, r, b] = [
                    band[0].max(painted[0]),
                    band[1].max(painted[1]),
                    band[2].min(painted[2]),
                    band[3].min(painted[3]),
                ];
                for y in t..b {
                    for x in l..r {
                        let (white, black) = outline.cover(x as f64, y as f64);
                        if white == 0.0 {
                            continue;
                        }
                        let n = (y - painted[1]) as usize * row + (x - painted[0]) as usize;
                        let [pb, pg, pr, _] = pixels[n].to_le_bytes();
                        let mut c = [f64::from(pb), f64::from(pg), f64::from(pr)];
                        c = super::mix(c, [255.0; 3], white * 0.95 * outline.alpha);
                        c = super::mix(c, [0.0; 3], black * outline.alpha);
                        let [b, g, r] = c.map(|v| v.round() as u8);
                        pixels[n] = u32::from_le_bytes([b, g, r, 255]);
                    }
                }
            }
            blit(back.dc, 0, 0);
        }
    }

    /// The loupe's window and how it moves: its centre follows the hotspot in physical px, its radius in CSS px.
    struct Loupe {
        window: HWND,
        x: Spring,
        y: Spring,
        radius: Spring,
        /// With reduced motion, its opacity instead of its growth.
        alpha: Fade,
        bitmap: Option<Dib>,
        shown: bool,
    }

    #[derive(Clone, Copy)]
    enum Mode {
        Pick,
        Box,
        Over,
    }

    /// One capture, on its own thread from the press until its windows are gone.
    struct Session {
        island: WebviewWindow,
        own: HWND,
        reduced: bool,
        tx: Option<Sender<Captured>>,
        start: Instant,
        frame: Dib,
        origin: (i32, i32),
        screens: Vec<Screen>,
        windows: Vec<HWND>,
        loupe: Loupe,
        mode: Mode,
        hotspot: (i32, i32),
        press: Option<(i32, i32)>,
        text: bool,
        hex: String,
        /// The frame's fade as the capture ends, and the outline's.
        fading: Option<Fade>,
        unboxing: Option<Fade>,
        /// When the box started marching.
        boxed: f64,
        /// The loupe needs drawing again: the hotspot or Shift changed.
        dirty: bool,
    }

    /// Freezes the screen and runs the capture until its windows are gone. The result goes on `tx` as soon as it is
    /// known, while the frame still fades out.
    pub fn run(island: &WebviewWindow, reduced: bool, tx: Sender<Captured>) {
        let Ok(own) = island.hwnd().map(|hwnd| hwnd.0 as HWND) else {
            let _ = tx.send(Captured::Failed);
            return;
        };
        // Physical px everywhere, whatever each monitor's scale.
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        // Out of the frame: it shows over it, and a bar folding as the capture starts would show around it.
        hide(own, true);
        unsafe { DwmFlush() };
        let Some(mut session) = Session::open(island, own, reduced, tx.clone()) else {
            hide(own, false);
            bar::give_back(island);
            let _ = tx.send(Captured::Failed);
            return;
        };
        drop(tx);
        let mut msg = MSG::default();
        let mut last = Instant::now();
        let mut moving = true;
        loop {
            // At rest the thread sleeps until Windows has something for it.
            if !moving && unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) } > 0 {
                unsafe { DispatchMessageW(&msg) };
            }
            while unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
                unsafe { DispatchMessageW(&msg) };
            }
            for heard in HEARD.with_borrow_mut(std::mem::take) {
                session.hear(heard);
            }
            moving = session.tick();
            if !moving && matches!(session.mode, Mode::Over) {
                break;
            }
            if moving {
                pace(&mut last);
            }
        }
        session.close();
    }

    /// Waits for the next frame on screen. A DWM with nothing to show answers at once: the wait is kept to 8 ms then.
    fn pace(last: &mut Instant) {
        unsafe { DwmFlush() };
        let spent = last.elapsed();
        if spent < Duration::from_millis(2) {
            std::thread::sleep(Duration::from_millis(8) - spent);
        }
        *last = Instant::now();
    }

    impl Session {
        fn open(
            island: &WebviewWindow,
            own: HWND,
            reduced: bool,
            tx: Sender<Captured>,
        ) -> Option<Session> {
            let screens = screens();
            let union = screens.iter().map(|s| s.rect).reduce(|a, b| RECT {
                left: a.left.min(b.left),
                top: a.top.min(b.top),
                right: a.right.max(b.right),
                bottom: a.bottom.max(b.bottom),
            })?;
            let (width, height) = (
                usize::try_from(union.right - union.left)
                    .ok()
                    .filter(|&w| w > 0)?,
                usize::try_from(union.bottom - union.top)
                    .ok()
                    .filter(|&h| h > 0)?,
            );
            let frame = grab(union.left, union.top, width, height)?;
            let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
            let class = wide("SumiCapture");
            // SAFETY: `class` outlives the call, and the procedure is a plain function. Registering twice fails
            // harmlessly: the class is the same.
            unsafe {
                RegisterClassW(&WNDCLASSW {
                    lpfnWndProc: Some(procedure),
                    hInstance: instance,
                    lpszClassName: class.as_ptr(),
                    ..Default::default()
                })
            };
            let make = |ex: u32, rect: RECT| unsafe {
                CreateWindowExW(
                    ex | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
                    class.as_ptr(),
                    std::ptr::null(),
                    WS_POPUP,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                )
            };
            let hotspot = cursor();
            let loupe = make(WS_EX_TRANSPARENT, RECT::default());
            if loupe.is_null() {
                return None;
            }
            hide(loupe, true);
            POINTER.set(0);
            SHOWN.set(Some(Shown {
                frame: frame.dc,
                origin: (union.left, union.top),
                windows: Vec::new(),
                outline: None,
            }));
            // Shown transparent and painted, then opaque: no flash, and nothing in between.
            let mut windows = Vec::new();
            for screen in &screens {
                let window = make(0, screen.rect);
                if window.is_null() {
                    continue;
                }
                windows.push(window);
                SHOWN.with_borrow_mut(|shown| {
                    if let Some(shown) = shown {
                        shown
                            .windows
                            .push((window, screen.rect.left, screen.rect.top));
                    }
                });
                unsafe {
                    SetLayeredWindowAttributes(window, 0, 0, LWA_ALPHA);
                    hide(window, true);
                    SetWindowPos(
                        window,
                        HWND_TOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                    UpdateWindow(window);
                }
            }
            let now = 0.0;
            let mut session = Session {
                island: island.clone(),
                own,
                reduced,
                tx: Some(tx),
                start: Instant::now(),
                frame,
                origin: (union.left, union.top),
                screens,
                windows,
                loupe: Loupe {
                    window: loupe,
                    x: Spring::new(f64::from(hotspot.0)),
                    y: Spring::new(f64::from(hotspot.1)),
                    radius: Spring::new(if reduced { RADIUS } else { 0.0 }),
                    alpha: Fade {
                        from: 0.0,
                        to: 1.0,
                        start: now,
                        ms: if reduced { REDUCED } else { 0.0 },
                        straight: true,
                    },
                    bitmap: None,
                    shown: false,
                },
                mode: Mode::Pick,
                hotspot,
                press: None,
                text: false,
                hex: String::new(),
                fading: None,
                unboxing: None,
                boxed: 0.0,
                dirty: true,
            };
            if session.windows.is_empty() {
                session.close();
                return None;
            }
            if !reduced {
                session.loupe.radius.to(RADIUS, GROW, now);
            }
            // The island over the frame, then the loupe under it. The island keeps the focus it took.
            unsafe {
                SetWindowPos(
                    own,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                SetWindowPos(
                    loupe,
                    own,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                for &window in &session.windows {
                    SetLayeredWindowAttributes(window, 0, 255, LWA_ALPHA);
                }
            }
            island
                .state::<Capture>()
                .window
                .store(session.windows[0] as usize, Ordering::SeqCst);
            session.sample();
            // A move to the same place hides the cursor at once: the loupe is the cursor.
            unsafe { SetCursorPos(hotspot.0, hotspot.1) };
            Some(session)
        }

        fn now(&self) -> f64 {
            self.start.elapsed().as_secs_f64() * 1000.0
        }

        /// The scale of the monitor at `point`, or the first one's.
        fn scale(&self, (x, y): (i32, i32)) -> f64 {
            self.screens
                .iter()
                .find(|s| {
                    x >= s.rect.left && x < s.rect.right && y >= s.rect.top && y < s.rect.bottom
                })
                .or(self.screens.first())
                .map_or(1.0, |s| s.scale)
        }

        fn pixels(&self) -> Pixels<'_> {
            Pixels {
                data: self.frame.pixels(),
                width: self.frame.width,
                height: self.frame.height,
            }
        }

        /// The 9 × 9 cells under the hotspot and the picked one.
        fn cells(&self) -> ([[u32; CELLS]; CELLS], (usize, usize)) {
            let (x, y) = (
                self.hotspot.0 - self.origin.0,
                self.hotspot.1 - self.origin.1,
            );
            let cells = self.pixels().around(i64::from(x), i64::from(y));
            let at = picked(&cells, self.text);
            (cells, at)
        }

        /// Reads the colour under the loupe, and tells the island when it changes.
        fn sample(&mut self) {
            let (cells, (i, j)) = self.cells();
            let next = hex(cells[j][i]);
            if next != self.hex {
                let _ = self.island.emit("capture://pixel", &next);
                self.hex = next;
            }
            self.dirty = true;
        }

        fn hear(&mut self, heard: Heard) {
            match (heard, self.mode) {
                (_, Mode::Over) => {}
                (Heard::Key(Key::Escape, true) | Heard::Gone, _) => self.cancel(),
                (Heard::Key(Key::Shift, down), Mode::Pick) => {
                    self.text = down;
                    self.sample();
                }
                (Heard::Key(key @ (Key::Left | Key::Right | Key::Up | Key::Down), true), _) => {
                    let (dx, dy) = match key {
                        Key::Left => (-1, 0),
                        Key::Right => (1, 0),
                        Key::Up => (0, -1),
                        _ => (0, 1),
                    };
                    let (x, y) = cursor();
                    // The move comes back as a WM_MOUSEMOVE.
                    unsafe { SetCursorPos(x + dx, y + dy) };
                }
                (Heard::Move | Heard::Down, Mode::Pick) => {
                    let point = cursor();
                    let (cx, cy) = island::drag();
                    match self.press {
                        Some((ax, ay))
                            if (point.0 - ax).abs() > cx || (point.1 - ay).abs() > cy =>
                        {
                            self.boxing(point)
                        }
                        _ => self.point(point),
                    }
                    if matches!(heard, Heard::Down) {
                        self.press = Some(point);
                    }
                }
                (Heard::Up, Mode::Pick) if self.press.is_some() => self.pick(),
                (Heard::Move, Mode::Box) => self.stretch(cursor()),
                (Heard::Up, Mode::Box) => self.read(),
                _ => {}
            }
        }

        /// The cursor moved: the disc follows it, and what it shows is always the hotspot's pixels.
        fn point(&mut self, point: (i32, i32)) {
            self.hotspot = point;
            let now = self.now();
            let (x, y) = (f64::from(point.0), f64::from(point.1));
            if self.reduced {
                self.loupe.x.jump(x);
                self.loupe.y.jump(y);
            } else {
                self.loupe.x.to(x, FOLLOW, now);
                self.loupe.y.to(y, FOLLOW, now);
            }
            self.sample();
        }

        /// Takes the loupe back into the pixel, or fades it.
        fn loupe_out(&mut self) {
            let now = self.now();
            if self.reduced {
                let from = self.loupe.alpha.at(now);
                self.loupe.alpha = Fade {
                    from,
                    to: 0.0,
                    start: now,
                    ms: REDUCED,
                    straight: true,
                };
            } else {
                self.loupe.radius.to(0.0, MERGE, now);
            }
            self.dirty = true;
        }

        /// A press that moved past Windows' drag rectangle: the loupe goes, the cursor is a crosshair, and the box
        /// marches.
        fn boxing(&mut self, point: (i32, i32)) {
            self.mode = Mode::Box;
            self.boxed = self.now();
            self.loupe_out();
            let cross = unsafe { LoadCursorW(std::ptr::null_mut(), IDC_CROSS) };
            POINTER.set(cross as usize);
            unsafe { SetCursor(cross) };
            let _ = self.island.emit("capture://box", ());
            self.stretch(point);
        }

        fn outline(&self) -> Option<Outline> {
            SHOWN.with_borrow(|shown| shown.as_ref().and_then(|s| s.outline))
        }

        /// Draws the box from the press to `point`.
        fn stretch(&mut self, point: (i32, i32)) {
            self.hotspot = point;
            let Some(press) = self.press else {
                return;
            };
            let rect = spanned(press, point).map(|v| v as f64);
            let previous = self.outline();
            let outline = Outline {
                rect,
                scale: self.scale(press),
                march: previous.map_or(0.0, |o| o.march),
                alpha: previous.map_or(1.0, |o| o.alpha),
            };
            self.set_outline(Some(outline));
        }

        /// Sets the outline, and repaints where it was and where it is.
        fn set_outline(&self, outline: Option<Outline>) {
            let (previous, windows) = SHOWN.with_borrow_mut(|shown| {
                shown.as_mut().map_or((None, Vec::new()), |s| {
                    (
                        std::mem::replace(&mut s.outline, outline),
                        s.windows.clone(),
                    )
                })
            });
            for o in [previous, outline].into_iter().flatten() {
                for band in o.bands() {
                    for &(window, left, top) in &windows {
                        let (left, top) = (i64::from(left), i64::from(top));
                        let rect = RECT {
                            left: (band[0] - left) as i32,
                            top: (band[1] - top) as i32,
                            right: (band[2] - left) as i32,
                            bottom: (band[3] - top) as i32,
                        };
                        unsafe { InvalidateRect(window, &rect, 0) };
                    }
                }
            }
        }

        /// The input is over: the island comes back to screen captures and the window it came from gets the focus
        /// back, and the frozen frame fades out `after` ms from now.
        fn release(&mut self, after: f64) {
            self.mode = Mode::Over;
            self.island
                .state::<Capture>()
                .window
                .store(0, Ordering::SeqCst);
            hide(self.own, false);
            bar::give_back(&self.island);
            let arrow = unsafe { LoadCursorW(std::ptr::null_mut(), IDC_ARROW) };
            POINTER.set(arrow as usize);
            unsafe { SetCursor(arrow) };
            let now = self.now();
            self.fading = Some(Fade {
                from: 1.0,
                to: 0.0,
                start: now + after,
                ms: FADE,
                straight: false,
            });
            if self.outline().is_some() {
                self.unboxing = Some(Fade {
                    from: 1.0,
                    to: 0.0,
                    start: now,
                    ms: FADE,
                    straight: false,
                });
            }
        }

        fn send(&mut self, captured: Captured) {
            if let Some(tx) = self.tx.take() {
                let _ = tx.send(captured);
            }
        }

        /// A click: the colour under the loupe, as HEX.
        fn pick(&mut self) {
            let hex = self.hex.clone();
            let captured = if clipboard::keep(self.island.app_handle(), hex.clone()) {
                Captured::Colour { hex }
            } else {
                Captured::Failed
            };
            self.loupe_out();
            self.release(AFTER);
            self.send(captured);
        }

        /// The box let go: its pixels are copied out and read on a thread of their own, as the frame fades.
        fn read(&mut self) {
            let Some(outline) = self.outline() else {
                return self.cancel();
            };
            let (ox, oy) = (i64::from(self.origin.0), i64::from(self.origin.1));
            let [l, t, r, b] = outline.rect.map(|v| v as i64);
            let rect = [l - ox, t - oy, r - ox, b - oy];
            let bounds = [0, 0, self.frame.width as i64, self.frame.height as i64];
            let by = (TOLERANCE * outline.scale).round() as i64;
            let (text, wide) = (
                self.pixels().crop(grown(rect, 0, bounds)),
                self.pixels().crop(grown(rect, by, bounds)),
            );
            self.release(AFTER);
            let app = self.island.app_handle().clone();
            if let Some(tx) = self.tx.take() {
                std::thread::spawn(move || {
                    let captured = if text.width == 0 || text.height == 0 {
                        Captured::Empty
                    } else {
                        super::recognise(&app, &text, &wide)
                    };
                    let _ = tx.send(captured);
                });
            }
        }

        fn cancel(&mut self) {
            if !matches!(self.mode, Mode::Box) {
                self.loupe_out();
            }
            self.release(0.0);
            self.send(Captured::Cancelled);
        }

        /// One frame: springs, the loupe, the box, the fades. Returns whether anything still moves.
        fn tick(&mut self) -> bool {
            let now = self.now();
            let loupe = &mut self.loupe;
            for spring in [&mut loupe.x, &mut loupe.y, &mut loupe.radius] {
                spring.update(now);
            }
            let springing = !(loupe.x.resting && loupe.y.resting && loupe.radius.resting);
            let fading = !loupe.alpha.done(now);
            if springing || fading || self.dirty {
                self.draw_loupe(now);
                self.dirty = false;
            }
            let mut moving = springing || fading;
            if let Some(o) = self.outline() {
                let march = if matches!(self.mode, Mode::Box) && !self.reduced {
                    moving = true;
                    (now - self.boxed) / 1000.0 * MARCH * o.scale
                } else {
                    o.march
                };
                let alpha = self.unboxing.map_or(o.alpha, |fade| fade.at(now));
                if march != o.march || alpha != o.alpha {
                    self.set_outline(Some(Outline { march, alpha, ..o }));
                }
                moving |= self.unboxing.is_some_and(|fade| !fade.done(now));
            }
            if let Some(fade) = self.fading {
                let alpha = (fade.at(now) * 255.0).round() as u8;
                for &window in &self.windows {
                    unsafe { SetLayeredWindowAttributes(window, 0, alpha, LWA_ALPHA) };
                }
                moving |= !fade.done(now);
            }
            moving
        }

        /// Draws the loupe where its springs are, on the monitor under the hotspot.
        fn draw_loupe(&mut self, now: f64) {
            let scale = self.scale(self.hotspot);
            let alpha = self.loupe.alpha.at(now);
            let radius = self.loupe.radius.value.max(0.0);
            if radius < 0.5 || alpha < 0.01 {
                if self.loupe.shown {
                    unsafe { ShowWindow(self.loupe.window, SW_HIDE) };
                    self.loupe.shown = false;
                }
                return;
            }
            let side = (2.0 * MARGIN * scale).ceil() as usize + 2;
            if self.loupe.bitmap.as_ref().is_none_or(|b| b.width != side) {
                self.loupe.bitmap = Dib::new(side, side);
            }
            let (cells, picked) = self.cells();
            let (cx, cy) = (self.loupe.x.value, self.loupe.y.value);
            let (vx, vy) = (self.loupe.x.velocity, self.loupe.y.velocity);
            let (left, top) = (
                (cx - side as f64 / 2.0).floor(),
                (cy - side as f64 / 2.0).floor(),
            );
            let lens = Lens {
                centre: (cx - left, cy - top),
                scale,
                radius,
                stretch: if self.reduced {
                    0.0
                } else {
                    squash(vx.hypot(vy) / scale)
                },
                angle: vy.atan2(vx),
                cells,
                picked,
            };
            let Some(bitmap) = self.loupe.bitmap.as_mut() else {
                return;
            };
            lens.draw(side, bitmap.pixels_mut());
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: (alpha * 255.0).round() as u8,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            let size = SIZE {
                cx: side as i32,
                cy: side as i32,
            };
            unsafe {
                UpdateLayeredWindow(
                    self.loupe.window,
                    std::ptr::null_mut(),
                    &POINT {
                        x: left as i32,
                        y: top as i32,
                    },
                    &size,
                    bitmap.dc,
                    &POINT::default(),
                    0,
                    &blend,
                    ULW_ALPHA,
                );
                // Right under the island, as it was put at the start: shown, it would otherwise go on top.
                if !self.loupe.shown {
                    SetWindowPos(
                        self.loupe.window,
                        self.own,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                    self.loupe.shown = true;
                }
            }
        }

        /// The windows go, then the frame: nothing of the screen is left.
        fn close(self) {
            SHOWN.set(None);
            HEARD.with_borrow_mut(Vec::clear);
            unsafe {
                for &window in &self.windows {
                    DestroyWindow(window);
                }
                DestroyWindow(self.loupe.window);
            }
            self.island
                .state::<Capture>()
                .window
                .store(0, Ordering::SeqCst);
        }
    }

    /// Reads a box's text with Windows' OCR, in the first of the user's languages it knows.
    pub fn read(crop: &Crop) -> Read {
        let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() else {
            return Read::Unreadable;
        };
        let limit = OcrEngine::MaxImageDimension().map_or(2600, |m| m as usize);
        let crop = crop.scaled(super::fit(crop.width, crop.height, limit));
        let bytes: Vec<u8> = crop.pixels.iter().flat_map(|p| p.to_le_bytes()).collect();
        let lines = (|| {
            let writer = DataWriter::new()?;
            writer.WriteBytes(&bytes)?;
            let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
                &writer.DetachBuffer()?,
                BitmapPixelFormat::Bgra8,
                crop.width as i32,
                crop.height as i32,
            )?;
            let result = engine.RecognizeAsync(&bitmap)?.join()?;
            let mut lines = Vec::new();
            let mut words = Vec::new();
            for line in result.Lines()? {
                lines.push(line.Text()?.to_string_lossy());
                for word in line.Words()? {
                    words.push(word.Text()?.to_string_lossy());
                }
            }
            windows_core::Result::Ok((lines, words))
        })();
        match lines {
            Ok((lines, words)) => Read::Text(
                lines.join("\r\n"),
                super::words(words.iter().map(String::as_str)),
            ),
            Err(_) => Read::Failed,
        }
    }
}

#[cfg(not(windows))]
mod os {
    use std::sync::mpsc::Sender;

    use tauri::WebviewWindow;

    use super::{Captured, Crop, Key, Read};

    pub fn run(_: &WebviewWindow, _: bool, tx: Sender<Captured>) {
        let _ = tx.send(Captured::Failed);
    }
    pub fn key(_: usize, _: Key, _: bool) {}
    pub fn read(_: &Crop) -> Read {
        Read::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHITE: u32 = 0xFFFF_FFFF;
    const DARK: u32 = 0xFF20_2020;
    const TEXT: u32 = 0xFFF1_F1F1;

    fn cells(back: u32) -> [[u32; CELLS]; CELLS] {
        [[back; CELLS]; CELLS]
    }

    #[test]
    fn a_click_takes_the_pixel_under_the_hotspot() {
        let mut c = cells(WHITE);
        c[4][4] = 0xFF1E_90FF;
        assert_eq!(picked(&c, false), (4, 4));
        assert_eq!(hex(c[4][4]), "#1E90FF");
    }

    #[test]
    fn shift_takes_the_text_on_a_dark_app_where_the_darkest_would_be_the_background() {
        let mut c = cells(DARK);
        c[2][6] = TEXT;
        c[3][6] = TEXT;
        assert_eq!(picked(&c, true), (6, 3));
        assert_eq!(hex(TEXT), "#F1F1F1");
    }

    #[test]
    fn shift_takes_dark_text_on_a_light_app_too() {
        let mut c = cells(WHITE);
        c[5][1] = 0xFF11_1111;
        assert_eq!(picked(&c, true), (1, 5));
    }

    #[test]
    fn shift_prefers_the_nearer_of_two_equal_pixels_and_keeps_the_centre_on_a_flat_area() {
        let mut c = cells(WHITE);
        c[0][0] = 0xFF00_0000;
        c[3][3] = 0xFF00_0000;
        assert_eq!(picked(&c, true), (3, 3));
        assert_eq!(picked(&cells(WHITE), true), (4, 4));
    }

    #[test]
    fn the_loupe_reads_past_the_frame_from_its_edge() {
        let data: Vec<u32> = (0..12).collect();
        let pixels = Pixels {
            data: &data,
            width: 4,
            height: 3,
        };
        let around = pixels.around(0, 0);
        assert_eq!(around[0][0], 0);
        assert_eq!(around[4][4], 0);
        assert_eq!(around[4][5], 1);
        assert_eq!(around[8][8], 11);
        assert_eq!(
            pixels.crop([1, 1, 3, 3]).pixels,
            [5, 6, 9, 10].map(|p| p | 0xFF00_0000)
        );
    }

    #[test]
    fn the_loupe_draws_the_picked_pixel_in_its_ring_inside_an_ink_rim() {
        let mut c = cells(0xFF1E_90FF);
        c[4][4] = 0xFF00_FF00;
        let side = 200;
        let lens = Lens {
            centre: (100.0, 100.0),
            scale: 1.0,
            radius: RADIUS,
            stretch: 0.0,
            angle: 0.0,
            cells: c,
            picked: (4, 4),
        };
        let mut out = vec![0; side * side];
        lens.draw(side, &mut out);
        let at = |x: usize, y: usize| out[y * side + x].to_le_bytes();
        // The picked pixel, the white ring and the black one around it, the next cell, the rim, and nothing outside.
        assert_eq!(at(100, 100), [0, 255, 0, 255]);
        assert_eq!(at(100, 106), [255, 255, 255, 255]);
        assert!(at(100, 107)[..3].iter().all(|&c| c < 80) && at(100, 107)[3] == 255);
        assert_eq!(at(100, 115), [255, 144, 30, 255]);
        assert_eq!(at(100, 47), [0, 0, 0, 255]);
        assert_eq!(at(0, 0)[3], 0);
        // The shadow reaches below the disc, not above it as far.
        assert!(at(100, 165)[3] > at(100, 35)[3]);
    }

    #[test]
    fn a_disc_with_no_radius_draws_nothing() {
        let lens = Lens {
            centre: (10.0, 10.0),
            scale: 1.25,
            radius: 0.0,
            stretch: 0.0,
            angle: 0.0,
            cells: cells(WHITE),
            picked: (4, 4),
        };
        let mut out = vec![1; 400];
        lens.draw(20, &mut out);
        assert!(out.iter().all(|&p| p == 0));
    }

    fn outline(rect: [f64; 4]) -> Outline {
        Outline {
            rect,
            scale: 1.0,
            march: 0.0,
            alpha: 1.0,
        }
    }

    #[test]
    fn the_box_is_white_under_black_dashes_on_its_path_only() {
        let o = outline([10.0, 10.0, 110.0, 60.0]);
        // On the top edge: a dash from 0 to 5 px along the path, a gap from 5 to 9.
        assert_eq!(o.cover(14.0, 9.5), (1.0, 1.0));
        assert_eq!(o.cover(19.0, 9.5), (1.0, 0.0));
        assert_eq!(o.cover(60.0, 35.0), (0.0, 0.0));
        assert_eq!(o.cover(60.0, 20.0), (0.0, 0.0));
    }

    #[test]
    fn the_dashes_march_along_the_path() {
        let o = outline([10.0, 10.0, 110.0, 60.0]);
        let moved = Outline { march: 5.0, ..o };
        assert_eq!(moved.cover(14.0, 9.5).1, 0.0);
        assert_eq!(moved.cover(19.0, 9.5).1, 1.0);
    }

    #[test]
    fn the_path_runs_clockwise_from_the_top_left() {
        let o = outline([0.0, 0.0, 100.0, 50.0]);
        let r = o.corner();
        let arc = std::f64::consts::FRAC_PI_2 * r;
        let (w, h) = (100.0 - 2.0 * r, 50.0 - 2.0 * r);
        assert_eq!(o.along(r, 0.0), 0.0);
        assert!((o.along(100.0, r) - (w + arc)).abs() < 1e-9);
        assert!((o.along(100.0 - r, 50.0) - (w + 2.0 * arc + h)).abs() < 1e-9);
        assert!((o.along(0.0, 50.0 - r) - (2.0 * w + 3.0 * arc + h)).abs() < 1e-9);
        assert!(o.distance(50.0, 25.0) < 0.0 && o.distance(150.0, 25.0) > 0.0);
    }

    #[test]
    fn a_box_paints_four_bands_that_never_overlap() {
        let bands = outline([10.0, 10.0, 110.0, 60.0]).bands();
        let mut seen = std::collections::HashSet::new();
        for [l, t, r, b] in bands {
            for y in t..b {
                for x in l..r {
                    assert!(seen.insert((x, y)), "({x}, {y}) twice");
                }
            }
        }
        assert!(seen.contains(&(10, 10)) && seen.contains(&(110, 35)) && !seen.contains(&(60, 35)));
    }

    #[test]
    fn a_box_holds_both_pixels_and_a_qr_code_a_little_past_it() {
        assert_eq!(spanned((40, 30), (10, 50)), [10, 30, 41, 51]);
        assert_eq!(
            grown([10, 30, 41, 51], 4, [0, 0, 100, 100]),
            [6, 26, 45, 55]
        );
        assert_eq!(grown([1, 2, 99, 98], 4, [0, 0, 100, 100]), [0, 0, 100, 100]);
    }

    #[test]
    fn a_small_box_is_read_twice_as_large_and_a_huge_one_to_fit() {
        assert_eq!(fit(300, 40, 2600), 2.0);
        assert_eq!(fit(1300, 40, 2600), 2.0);
        assert_eq!(fit(2000, 40, 2600), 1.0);
        assert_eq!(fit(5200, 100, 2600), 0.5);
        let crop = Crop {
            pixels: vec![1, 2, 3, 4],
            width: 2,
            height: 2,
        };
        let twice = crop.scaled(2.0);
        assert_eq!((twice.width, twice.height), (4, 4));
        assert_eq!(twice.pixels[..4], [1, 1, 2, 2]);
        assert_eq!(twice.pixels[12..], [3, 3, 4, 4]);
    }

    #[test]
    fn counts_words_with_a_letter_or_a_digit() {
        assert_eq!(words(["La", "0.9", "—", "apporte", "•", "l’historique"]), 4);
        assert_eq!(words([]), 0);
    }

    /// The lab's QR code, version 2-M, holding `https://example.com`.
    const EXAMPLE: [&str; 25] = [
        "#######..#######..#######",
        "#.....#.#.###.###.#.....#",
        "#.###.#...##...##.#.###.#",
        "#.###.#....##.##..#.###.#",
        "#.###.#.#....###..#.###.#",
        "#.....#.....####..#.....#",
        "#######.#.#.#.#.#.#######",
        "...........####.#........",
        "#.#.#.#..##.#.###...#..#.",
        "#...#..##.#.#.....#.....#",
        "##....#...#..#.....##.###",
        "...##..##.#.#..###.....#.",
        ".#..#.#.#####...###..#.##",
        "..####.##.####..###..#..#",
        "#.###.####.##.#.#.##..###",
        ".#.#.#......#####...#..#.",
        "#..####....#..########...",
        "........##.#..###...##.##",
        "#######..##..#.##.#.##.##",
        "#.....#..#.#....#...##..#",
        "#.###.#.#...#...######..#",
        "#.###.#....###.#...####..",
        "#.###.#.#..##.#.#...#...#",
        "#.....#.....###.#.#.##.#.",
        "#######.#.##..######...##",
    ];

    /// `EXAMPLE` drawn at 4 px a module on white, with 2 modules of quiet zone, as a screen shows it.
    fn drawn() -> Crop {
        let side = (EXAMPLE.len() + 4) * 4;
        let pixels = (0..side * side)
            .map(|n| {
                let (i, j) = ((n % side) / 4, (n / side) / 4);
                let dark = (2..EXAMPLE.len() + 2).contains(&i)
                    && (2..EXAMPLE.len() + 2).contains(&j)
                    && EXAMPLE[j - 2].as_bytes()[i - 2] == b'#';
                if dark { 0xFF11_1111 } else { 0xFFFF_FFFF }
            })
            .collect();
        Crop {
            pixels,
            width: side,
            height: side,
        }
    }

    #[test]
    fn reads_a_whole_qr_code_and_not_a_cut_one() {
        let whole = drawn();
        assert_eq!(qr(&whole).as_deref(), Some("https://example.com"));
        let half = whole.width / 2;
        let cut = Crop {
            pixels: whole
                .pixels
                .chunks(whole.width)
                .flat_map(|row| row[..half].to_vec())
                .collect(),
            width: half,
            height: whole.height,
        };
        assert_eq!(qr(&cut), None);
    }

    #[test]
    fn names_a_link_by_its_site() {
        assert_eq!(host("https://example.com").as_deref(), Some("example.com"));
        assert_eq!(
            host("HTTP://www.Example.com/a?b#c").as_deref(),
            Some("example.com")
        );
        assert_eq!(host("WIFI:S:Maison;T:WPA;P:secret;;"), None);
        assert_eq!(host("https://"), None);
        assert_eq!(host("https://example.com and more"), None);
    }

    #[test]
    fn a_spring_settles_where_it_was_sent() {
        let mut s = Spring::new(0.0);
        s.to(RADIUS, GROW, 0.0);
        s.update(200.0);
        assert!(s.value > 40.0 && !s.resting);
        s.update(2000.0);
        assert!(s.resting && s.value == RADIUS);
    }

    #[test]
    fn a_fade_eases_out_as_exit_does() {
        let fade = Fade {
            from: 1.0,
            to: 0.0,
            start: 60.0,
            ms: FADE,
            straight: false,
        };
        assert_eq!(fade.at(0.0), 1.0);
        assert!(fade.at(140.0) > 0.5);
        assert_eq!(fade.at(220.0), 0.0);
        assert!(fade.done(220.0) && !fade.done(219.0));
    }
}

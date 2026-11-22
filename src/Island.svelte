<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { tick as flushed, untrack } from 'svelte'
  import { prefersReducedMotion } from 'svelte/motion'
  import { MediaQuery, SvelteMap } from 'svelte/reactivity'
  import { fade as dissolve } from 'svelte/transition'
  import { innerHeight, innerWidth } from 'svelte/reactivity/window'
  import { arrange, peeks, stillPicked, type Activity, type Arrangement, type Presence } from './lib/activities'
  import {
    formatBubbleTime,
    formatCountdown,
    formatLongDate,
    formatShortDate,
    formatTime,
    msUntilNextMinute,
  } from './lib/clock'
  import { tint } from './lib/color'
  import {
    CAPTURE,
    CLOSE,
    END_PEEK,
    ENTER,
    EXIT,
    FULLSCREEN,
    GOUTTE,
    INK,
    MERGE,
    OPEN,
    PRESS,
    SPLIT,
    SWIPE,
    TUCK,
    WELCOME,
    bezier,
    lean,
    motion,
    squash,
    type Axis,
  } from './lib/motion'
  import { label, light, quiet, tagged, type Privacy } from './lib/privacy'
  import {
    BUBBLE,
    GAP,
    TAG,
    TAG_GAP,
    TOP,
    cardSize,
    drip,
    layout,
    radius,
    resolveView,
    sizeOf,
    welcomeWidth,
    type Capture,
    type Rect,
    type TimerFit,
    type View,
    type Welcome,
  } from './lib/shapes'
  import {
    advancing,
    clockTime,
    nextChange,
    nobody,
    position,
    shown as showing,
    songs,
    update,
    type Artwork,
    type Player,
    type Players,
    type Snapshot,
  } from './lib/music'
  import { Spring } from './lib/spring'
  import {
    add,
    chimeSlot,
    endOf,
    ended,
    formatLeft,
    formatOvertime,
    fraction,
    isTimer,
    long,
    names,
    nextTick,
    overtime,
    pause,
    resume,
    start as startTimer,
    words,
    type Timer,
  } from './lib/timers'
  import { ASSISTANTS, choices, fold as folded, langOf, type Choice, type Lang } from './lib/intent'
  import {
    BOLT,
    COMPACT,
    POWER_PEEK,
    fresh,
    lands,
    items,
    lines,
    opens,
    readOut,
    panelSize,
    said as speak,
    waits,
    type Battery,
    type Device,
    type Item,
    type Low,
    type Peeked,
    type Power,
  } from './lib/power'
  import {
    DRAWINGS,
    FETCH,
    TIMEOUT,
    WEATHER_ERROR,
    WEATHER_PEEK,
    WEATHER_WORDS,
    chip,
    cityOf,
    consent,
    fahrenheit,
    forecast,
    forecastOf,
    geocoding,
    peek as forecastPeek,
    type City,
    type Kept,
    type Sky,
  } from './lib/weather'
  import { WORDS, announce, keysOf } from './lib/welcome'
  import {
    DRAINS,
    drag,
    kinds,
    marks,
    resist,
    scroll,
    swipe,
    tucksAfter,
    wakes,
    type Direction,
    type Notch,
    type Tucker,
  } from './lib/tuck'
  import { TRAY, badge, tip, type Tray } from './lib/tray'
  import {
    CLIPBOARD_WORDS,
    GLYPHS,
    arrived,
    folderOf,
    formOf,
    kindOf,
    linkParts,
    matching,
    rows as listRows,
    searchKey,
    swatchOf,
    type Action,
    type Landed,
  } from './lib/clipboard'
  import {
    CAPTURE_GLYPHS,
    CAPTURE_KEYS,
    CAPTURE_WORDS,
    result as copied,
    type CaptureKey,
    type Captured,
  } from './lib/capture'
  import ClipboardHistory from './ClipboardHistory.svelte'
  import CommandBar, { markOf, type Listed } from './CommandBar.svelte'
  import PrivacyCard, { paintIcon } from './PrivacyCard.svelte'
  import Batteries from './Batteries.svelte'
  import Ring, { BOLT_PATH, glyph as drawing } from './Ring.svelte'

  // The hover shape outlives the cursor this long, so a slip past its edge doesn't shrink it.
  const LEAVE = 300
  // Half of Windows' 4 px hover rectangle: a cursor that moves farther hasn't come to rest.
  const REST = 2
  // The bubble splits off from inside the island's round end and lands beside it.
  const TRAVEL = GAP + BUBBLE
  // Blur that joins the island and the bubble while they part. Their neck breaks at a gap of
  // about 1.35 σ: just before the bubble lands 8 px away, and not again on its bounce.
  const GOO = 5
  const entering = bezier(...ENTER.easing)
  const leaving = bezier(...EXIT.easing)

  const tauri = isTauri()
  const forced = new MediaQuery('forced-colors: active')
  let island: HTMLDivElement
  let content: HTMLElement | undefined
  let clock = $state<HTMLElement>()
  let art = $state<HTMLElement>()
  let eq = $state<HTMLElement>()
  let ring = $state<HTMLElement>()
  // Calls and timers. Timers come from the command bar and from disk; only the demo makes calls for now.
  let activities = $state<Activity[]>([])
  // Music comes from Rust; `prefer` is the activity picked with a click on the bubble.
  let music = $state<Activity[]>([])
  let prefer = $state<string>()
  let hovered = $state(false)
  let expanded = $state(false)
  let peeking = $state<string>()
  let hidden = $state(false)
  // Tucked into a line under the top edge, or on its way there or back (GOUTTE). `stowed`: its content is out.
  let tuck = $state<'shown' | 'tucking' | 'tucked' | 'returning'>('shown')
  let stowed = $state(false)
  let presence = $state<Presence>('shown')
  // Off the screen until the startup drop brings the island in.
  let revealed = $state(false)
  let now = $state(new Date())
  // Windows' default. Rust sends the user's own each time the cursor arrives.
  let hoverTime = 400
  // Who uses the microphone or the camera, from Rust. The tag beside the island opens into a card of its own, so
  // the island and its music never move: `onTag` is the cursor on the tag right away, `card` the card open once
  // the cursor rests there.
  let privacy = $state<Privacy>(quiet())
  let onTag = false
  let card = $state(false)
  let tagTimer: ReturnType<typeof setTimeout> | undefined
  // The command bar: its line, and the peek it folds into after Enter. Its shortcut, Start's apps and whether Claude's
  // app is installed come from Rust; the demo brings stand-ins.
  const lang: Lang = langOf(location.search, navigator.language)
  let barOpen = $state(false)
  let line = $state('')
  let launch = $state<ReturnType<typeof markOf> & { text: string; swatch?: string }>()
  let launchTimer: ReturnType<typeof setTimeout> | undefined
  // The time asked in the bar: the hover view shows it with the date, then the previous view comes back.
  let telling = $state(false)
  // A battery peek over whatever has the island, a low battery that waits for it, and the battery the bar read from
  // Rust as it opened.
  let power = $state<Power>()
  let powerTimer: ReturnType<typeof setTimeout> | undefined
  let pending = $state<Power>()
  let battery = $state<Battery>()
  // The batteries panel: open over the clock's, with a ring grown to its detail, and whether it holds the focus the
  // bar had. When each device last peeked as it connected, in memory only (fresh in power.ts).
  let panel = $state<'batteries'>()
  let grown = $state<string>()
  let focused = $state(false)
  const connects = new Map<string, Peeked>()
  // The weather, asked in the bar only. The yes and `here`, the city last found, are kept by Rust across restarts until
  // the tray's forget. `asking` is the bar's consent question, `sky` the peek.
  let consented = false
  let here = $state<City>()
  let asking = $state<Extract<Choice<Listed>, { kind: 'weather' }>>()
  let sky = $state<Sky>()
  let skyTimer: ReturnType<typeof setTimeout> | undefined
  // The clipboard history, opened in the bar: its items as Rust keeps them, newest first, the ones Rust found on this
  // PC as a file or a folder, and what filters them. `allowing` is the bar's consent question, and `refused` a no
  // this session, after which its chip says « Activer ». The demo's stand-ins: what Rust would keep, null before the
  // yes, what the clipboard holds now, and the paths it would find.
  let history = $state<string[]>()
  let paths = $state<ReadonlySet<string>>(new Set())
  let query = $state('')
  let allowing = $state(false)
  let refused = false
  let kept: string[] | null = null
  let holding = ''
  let found: string[] = []
  const searchable = $derived(history?.map((text) => searchKey(text, kindOf(text, paths), lang)) ?? [])
  const matches = $derived(history ? matching(history, searchable, query) : [])
  const listed = $derived(history ? listRows(matches.length, history.length, query, lang) : 0)
  // The screen capture: whether Rust takes input, the HEX under the loupe and whether Shift asks for the text's
  // colour. `captureView` is the island's view of it, measured from the hidden copies below, and `got` what was
  // copied, which shows for 3 s. `bead` is the colour the result's bead holds. The demo settles its stand-in through
  // `settleCapture`.
  let capturing = $state(false)
  let hex = $state('#000000')
  let textColour = $state(false)
  let captureView = $state<Capture>()
  let got = $state<NonNullable<ReturnType<typeof copied>>>()
  let gotTimer: ReturnType<typeof setTimeout> | undefined
  let bead: string | undefined
  let settleCapture: ((captured: Captured) => void) | undefined
  let pickRow = $state<HTMLElement>()
  let boxRow = $state<HTMLElement>()
  let doneRow = $state<HTMLElement>()
  let apps = $state<Listed[]>([])
  let claudeApp = $state(false)
  let shortcut = $state<string>()
  // The first-launch welcome: due ('waiting'), on the island, or over for this session. `welcome` is its view once
  // it greets, `blank` keeps the time out of the island it drops in, and `mark` is the logo that stands in for the
  // bead with reduced motion. `spoken` is what a screen reader hears.
  let launched = $state(false)
  let greeting = $state<'waiting' | 'playing' | 'over'>('over')
  let welcome = $state<Welcome>()
  let blank = $state(false)
  let mark = $state(false)
  let spoken = $state('')
  const keys = $derived(keysOf(shortcut, lang))
  // Icons asked for, by app id: `null` while Rust reads one, or when an app has none. Not reactive: one arriving
  // must not rerun the effect that asks for them.
  const icons: Record<string, Listed['icon']> = {}
  // A timer started from the bar swells the island as it lands.
  let swell = false

  // The last arrangement, so equals keep their place. Written from the derived as a plain variable: reading it
  // there doesn't make the derived depend on itself.
  let shown: Arrangement | undefined
  // While its panel is open, a timer keeps the island, even paused: the panel stays under the cursor.
  const arrangement = $derived.by(() => {
    const pin = expanded && isTimer(shown?.island) ? shown.island.id : undefined
    return (shown = arrange([...activities, ...music], shown, prefer, now.getTime(), pin))
  })
  const timers = $derived(activities.filter(isTimer))
  // Each timer's name: its label, or "Minuteur 2" among several without one.
  const named = $derived(names(timers, lang))
  const said = $derived(words(lang))
  // The timer on the island, and how it fits. Its name and digits are measured in the hidden copy below.
  const top = $derived(isTimer(arrangement.island) ? arrangement.island : undefined)
  let nameWidth = $state(0)
  let digitsWidth = $state(0)
  const topName = $derived(top && (named.get(top.id) ?? (ended(top, now.getTime()) ? said.done : undefined)))
  const topDigits = $derived(top && timerDigits(top))
  const fit = $derived.by((): TimerFit | undefined => {
    if (!top) return
    const t = now.getTime()
    // clientWidth rounds: a pixel more each keeps the name from an ellipsis over a fraction of a pixel.
    return { ended: ended(top, t), long: long(top, t), name: topName ? nameWidth + 1 : 0, digits: digitsWidth + 1 }
  })
  const view = $derived(
    resolveView({
      activity: arrangement.island,
      // No hover view while the welcome plays: a cursor on it holds the shortcut instead.
      hovered: hovered && greeting !== 'playing',
      expanded,
      peeking,
      bar: barOpen,
      rows: listed,
      capture: captureView,
      launch: !!launch,
      weather: !!sky,
      clock: telling,
      timer: fit,
      welcome,
      blank,
      power,
      batteries: panel && battery ? panelSize(items(battery, lang), grown) : undefined,
    }),
  )
  // While the bar and its answer hold the island, what had it waits in the bubble. The welcome keeps the island
  // the only black mass.
  const beside = $derived(
    tuck !== 'shown'
      ? undefined
      : barOpen || launch || telling || sky || captureView
        ? arrangement.island
        : launched && greeting !== 'playing'
          ? arrangement.bubble
          : undefined,
  )
  // The bar names timers as the island does, so 'stop minuteur 2' finds the second one. While it asks for the
  // weather's or the clipboard history's yes, its one chip is that yes.
  const options = $derived(
    !barOpen
      ? ([] as Choice<Listed>[])
      : allowing
        ? [{ kind: 'clipboard' as const, label: CLIPBOARD_WORDS[lang][refused ? 'again' : 'allow'] }]
        : asking
          ? [{ ...asking, label: WEATHER_WORDS[lang].allow }]
          : choices(line, {
              apps,
              lang,
              claudeApp,
              timers: timers.map((t) => ({ ...t, label: named.get(t.id) })),
              now: now.getTime(),
              battery,
              city: here?.name,
            }),
  )
  const size = $derived(sizeOf(view))
  // A timer's shape changes size without changing view, as an hour passes or its name shows.
  const key = $derived(
    ('activity' in view && view.activity
      ? `${view.name}:${view.activity.id}`
      : view.name === 'welcome'
        ? `welcome:${view.step}`
        : view.name) + `:${size.width}x${size.height}`,
  )
  const reduced = $derived(prefersReducedMotion.current)

  // What the island shows, piece by piece. A piece that stays from one view to the next moves instead of fading.
  const parts = $derived.by(() => {
    const name = revealed && !blank && !stowed ? view.name : undefined
    const activity = name && 'activity' in view ? view.activity : undefined
    return {
      date: name === 'hover' && !activity,
      time: ((name === 'idle' || name === 'hover') && !activity) || activity?.kind === 'call',
      panel: name === 'expanded' && !activity && !('batteries' in view),
      music: activity?.kind === 'music' ? activity : undefined,
      player: name === 'expanded' && activity?.kind === 'music' ? activity : undefined,
      track: name === 'peek' && activity?.kind === 'music' ? activity : undefined,
      call: activity?.kind === 'call' ? activity : undefined,
      timer: activity?.kind === 'timer' ? activity : undefined,
      bar: name === 'bar',
      launch: name === 'launch' ? launch : undefined,
      weather: name === 'weather' ? sky : undefined,
      welcome: name && view.name === 'welcome' ? view.step : undefined,
      capture: name && view.name === 'capture' ? view.step : undefined,
      power: name && view.name === 'power' ? view.power : undefined,
      batteries: name && 'batteries' in view ? battery : undefined,
    }
  })

  // A timer on screen needs the seconds, in step with its end. Off screen, a timer only wakes the page as it ends and
  // for each chime; a paused one never does. The clock alone wakes up once a minute.
  const onScreen = $derived(
    hidden || stowed
      ? ''
      : [arrangement.island, arrangement.bubble].flatMap((a) => (isTimer(a) ? [a.id] : [])).join(' '),
  )
  $effect(() => {
    void [timers, onScreen]
    const wait = () =>
      untrack(() => {
        const t = Date.now()
        const shownTimers = timers.filter((a) => onScreen.split(' ').includes(a.id))
        return Math.min(nextTick(timers, shownTimers, t) ?? Infinity, msUntilNextMinute(new Date(t)))
      })
    now = new Date()
    let timer = setTimeout(function tick() {
      now = new Date()
      timer = setTimeout(tick, wait())
    }, wait())
    return () => clearTimeout(timer)
  })

  // --- Shape springs ---

  // One spring per axis, so the width can lead and the height follow. `travel` slides the bubble out
  // of the island and `bubble` is its size; `tagShift`, `tagW` and `tagH` do the same for the privacy tag, which
  // also opens into a card; `drop` lifts everything off the screen in fullscreen, and at startup until the first
  // drop. `inkD` and `inkR` are the welcome's bead: its centre's distance under the pill, and its radius. `lift`
  // and `slide` move the island up or down and sideways as a swipe tucks it, and `lineW`, `lineB` and `lineX` are the
  // line's ink: its width, its bottom edge from the top of the screen, and its centre's offset.
  const start = untrack(() => size)
  const width = new Spring(start.width)
  const height = new Spring(start.height)
  const drop = new Spring(-(TOP + start.height + 24))
  const travel = new Spring(0)
  const bubble = new Spring(0)
  const tagShift = new Spring(0)
  const tagW = new Spring(0)
  const tagH = new Spring(0)
  const inkD = new Spring(0)
  const inkR = new Spring(0)
  const lift = new Spring(0)
  const slide = new Spring(0)
  const taper = new Spring(0)
  const lineW = new Spring(0)
  const lineB = new Spring(GOUTTE.away)
  const lineX = new Spring(0)
  const springs = [
    width, height, drop, travel, bubble, tagShift, tagW, tagH, inkD, inkR,
    lift, slide, taper, lineW, lineB, lineX,
  ]

  let goo = $state(false)
  let sigma = $state(0)
  let ramp: { from: number; to: number; start: number; end: number } | undefined
  let phase: 'none' | 'split' | 'shown' | 'merge' = 'none'
  let inkPhase: 'none' | 'split' | 'merge' = 'none'
  let delayed: ReturnType<typeof setTimeout> | undefined
  let reveal = 0
  // Where the open card's left edge stays while it is open.
  let anchor: number | undefined
  // The tuck: whether the island's drop is drawn, its beats, the checks that wait on a shape, and three opacities
  // that fade: the island and the line, which crossfade with reduced motion, and the line's lighter row.
  type Fade = { from: number; to: number; start: number; end: number }
  const still = (value: number): Fade => ({ from: value, to: value, start: 0, end: 0 })
  const level = ({ from, to, start, end }: Fade, t: number) =>
    t >= end ? to : from + (to - from) * Math.max(0, (t - start) / (end - start))
  let pill = true
  let opened = false
  let steps: ReturnType<typeof setTimeout>[] = []
  let checks: { when: () => boolean; then: (t: number) => void }[] = []
  let fades = { pill: still(1), line: still(1), shine: still(0) }
  let geometry = $state.raw(shape())
  let raf = 0

  /** Where everything is drawn: the shapes stretch with their speed, the content and its clip don't. */
  function shape(t = performance.now()) {
    const s = reduced ? 0 : squash(width.velocity)
    const [w, h] = [width.value * (1 + s), height.value / (1 + s)]
    const viewport = window.innerWidth
    const lifted = drop.value + lift.value
    const [fill, dot] = layout(viewport, { width: w, height: h }, bubble.value, {
      travel: travel.value,
      drop: lifted,
    })
    // A swipe moves the island sideways, and the bubble with it.
    fill.x += slide.value
    if (dot) dot.x += slide.value
    const clip = { width: Math.min(w, width.value), height: Math.min(h, height.value) }
    // The privacy tag sits beside whichever edge is farther right, level with the top row. While it is smaller than
    // a disc it grows from the disc's center; past that, from its top-left corner, into the card.
    const right = dot && dot.x + dot.width > fill.x + fill.width ? dot : fill
    const [tw, th] = [tagW.value, tagH.value]
    const inset = Math.max(0, (TAG - Math.max(tw, th)) / 2)
    const beside = right.x + right.width + TAG_GAP
    // Kept from the moment the card opens, so it stays under the cursor while the shapes beside it resize. Closed,
    // it springs back beside them from there. instant() comes last: it is defined after this first runs.
    if (!card && anchor !== undefined && anchor !== beside && !instant()) {
      tagShift.jump(tagShift.value + anchor - beside)
      drive(tagShift, 0, CLOSE.width, t)
    }
    anchor = card ? (anchor ?? beside) : undefined
    const flag =
      tw > 0.5
        ? {
            x: (anchor ?? beside) + tagShift.value + inset,
            y: TOP + drop.value + (BUBBLE - TAG) / 2 + inset,
            width: tw,
            height: th,
          }
        : undefined
    // The bead hangs from the middle of the pill's bottom edge, as the logo's drop does.
    const r = inkR.value
    const ink =
      r > 0.5 ? { x: viewport / 2 - r, y: fill.y + h + inkD.value - r, width: 2 * r, height: 2 * r } : undefined
    // A capture's colour fills the bead inside its rim, once the bead is out of the pill.
    const dr = r - CAPTURE.rim
    const tint =
      bead && dr > 0.5
        ? {
            x: viewport / 2 - dr,
            y: fill.y + h + inkD.value - dr,
            width: 2 * dr,
            height: 2 * dr,
            color: bead,
            alpha: Math.min(1, Math.max(0, (inkD.value - CAPTURE.out) / CAPTURE.over)),
          }
        : undefined
    // The tuck's line: its ink runs GOUTTE.above px over its bottom edge, out of the window, so the goo keeps a full
    // meniscus at the edge. Only its hit area takes the cursor, and nothing shows in fullscreen.
    const lw = lineW.value
    const line =
      tuck !== 'shown' && !hidden && lw > 0.5
        ? { x: (viewport - lw) / 2 + lineX.value, y: lineB.value - GOUTTE.above, width: lw, height: GOUTTE.above }
        : undefined
    const hit = { x: (viewport - TUCK.width) / 2, y: 0, width: TUCK.width, height: TUCK.hit }
    // The shadow leaves with the island: it fades with how much of it is still below the line.
    const below = (fill.y + h - TUCK.height) / (TOP + BUBBLE - TUCK.height)
    const shade = tuck === 'shown' ? 1 : pill ? Math.min(1, Math.max(0, below)) : 0
    return {
      fill,
      pill: pill ? level(fades.pill, t) : 0,
      dot,
      tag: flag,
      ink,
      tint,
      line,
      lineAlpha: level(fades.line, t),
      shine: level(fades.shine, t),
      shade,
      hit,
      // A panel leans less, so its bottom trails no more than the drawn-up drop's.
      lean: reduced ? 0 : lean(slide.velocity) * Math.min(1, GOUTTE.long / h),
      corners: taper.value > 0.01 ? drip(w, h, taper.value) : undefined,
      clip: { ...layout(viewport, clip, 0, { drop: lifted })[0], x: (viewport - clip.width) / 2 + slide.value },
    }
  }

  // Frames run only while something moves: at rest there is no loop, no IPC and no filter.
  function wake() {
    raf ||= requestAnimationFrame(frame)
  }

  // The page's own clock, as every spring starts on: in a frame, Chromium's rAF time can run seconds behind it.
  function frame() {
    raf = 0
    const t = performance.now()
    springs.forEach((s) => s.update(t))
    if (ramp) {
      const p = Math.min(1, Math.max(0, (t - ramp.start) / (ramp.end - ramp.start)))
      sigma = ramp.from + (ramp.to - ramp.from) * p
      if (p === 1) {
        ramp = undefined
        goo = sigma > 0
      }
    }
    // The goo lets go once the bubble is within half a pixel of its place: the last tenth would keep it on.
    const near = (s: Spring) => Math.abs(s.value - s.target) < 0.5 && Math.abs(s.velocity) < 20
    let ended = false
    if (phase === 'split' && near(travel) && near(bubble)) {
      phase = 'shown'
      ended = true
    } else if (phase === 'merge' && near(travel) && near(bubble)) {
      phase = 'none'
      bubble.jump(0)
      // Merged into a tuck, the goo is the tuck's.
      if (tuck !== 'tucking') {
        pulse(120, 0, t)
        ended = true
      }
    }
    if (inkPhase === 'merge' && inkD.value < -8) {
      inkPhase = 'none'
      bead = undefined
      inkD.jump(0)
      inkR.jump(0)
      ended = true
    }
    for (const check of checks.filter((c) => c.when())) {
      checks = checks.filter((c) => c !== check)
      check.then(t)
    }
    if (tagPhase === 'split' && near(tagShift) && near(tagW)) {
      tagPhase = 'shown'
      ended = true
    } else if (tagPhase === 'merge' && near(tagShift) && near(tagW)) {
      tagPhase = 'none'
      tagW.jump(0)
      tagH.jump(0)
      ended = true
    }
    // One goo for every drop: it lets go once none of them still moves, and the bead keeps its neck while it is out.
    const dropping = [phase, tagPhase, inkPhase].some((p) => p === 'split' || p === 'merge')
    if (ended && !dropping) fade(0, 120, t)
    if (!hidden && !revealed && drop.value >= reveal) revealed = true
    geometry = shape(t)
    const fading = Object.values(fades).some((f) => t < f.end)
    const moving = springs.some((s) => !s.resting) || !!ramp || !!delayed || steps.length > 0 || fading
    if (folding && !moving) folding = false
    // The end state is drawn once more, from its own numbers: the click area changes with it.
    if (!moving && phase === 'none' && (tuck === 'tucking' || tuck === 'returning')) {
      settle()
      geometry = shape(t)
    }
    ride()
    follow(moving)
    report(moving)
    if (moving) raf = requestAnimationFrame(frame)
  }
  wake()

  // A spring that may not bounce still overshoots when it already heads for its target faster than it
  // would on its own, so such a shrink starts from a standstill.
  function drive(spring: Spring, target: number, [duration, bounce]: Axis, t: number) {
    if (!bounce && (target - spring.value) * spring.velocity > 0) spring.jump(spring.value)
    spring.to(target, duration, bounce, t)
  }

  function reshape(from: View, to: View) {
    clearTimeout(delayed)
    delayed = undefined
    const swelled = swell
    swell = false
    // Tucked, the drop and the line have the shape: the return opens to the view of that moment.
    if (tuck === 'tucking' || tuck === 'tucked' || (tuck === 'returning' && !opened)) return
    const target = sizeOf(to)
    // Off the screen in fullscreen, the shape takes its new size at once: nobody would see it move.
    // Unlike the drops, it still springs in forced colors: an outline follows it fine.
    if (reduced || (hidden && drop.resting)) {
      const jump = () => {
        delayed = undefined
        width.jump(target.width)
        height.jump(target.height)
        wake()
      }
      // Reduced motion: the welcome's content, and the batteries' as a ring grows, fades out in the old shape before
      // the shape changes.
      if (reduced && gap) delayed = setTimeout(jump, gap)
      else jump()
      return
    }
    const { width: w, height: h, delay, pulse: arrives } = motion(from, to)
    const go = () => {
      delayed = undefined
      const t = performance.now()
      drive(width, target.width, w, t)
      drive(height, target.height, h, t)
      if (arrives || swelled) pulse(0, 150, t)
      wake()
    }
    if (delay) delayed = setTimeout(go, delay)
    else go()
    wake()
  }

  /** Swells the shape for a moment without changing its size. */
  function pulse(dw: number, dh: number, t = performance.now()) {
    if (reduced || tuck !== 'shown') return
    if (dw) {
      width.to(width.target, 0.44, 0, t)
      width.kick(dw, t)
    }
    if (dh) {
      height.to(height.target, 0.3, 0, t)
      height.kick(dh, t)
    }
    wake()
  }

  function alert() {
    pulse(160, 150)
  }

  /** Swells the bubble for a moment, once it has split off. */
  function nudge(t = performance.now()) {
    if (reduced || phase !== 'shown') return
    bubble.to(BUBBLE, 0.44, 0, t)
    bubble.kick(110, t)
    wake()
  }

  function fade(to: number, ms: number, t = performance.now()) {
    goo = true
    ramp = { from: sigma, to, start: t, end: t + ms }
    wake()
  }

  // --- Bubble ---

  // A drop lands at once without motion, in forced colors, where the goo can't show, and off the screen.
  const instant = () => reduced || forced.current || (hidden && drop.resting)

  // The bubble splits off like a drop, joined to the island by a neck until they part.
  // split and merge mirror emerge and retract below: change them together.
  $effect(() => {
    const has = !!beside
    untrack(() => (has ? split() : merge()))
  })

  function split() {
    if (phase === 'split' || phase === 'shown') return
    if (instant()) {
      // What the cut merge's landing would have done.
      if (phase === 'merge' && tuck !== 'tucking') fade(0, 120)
      travel.jump(0)
      bubble.jump(BUBBLE)
      phase = 'shown'
      return wake()
    }
    const t = performance.now()
    if (phase === 'none') {
      travel.jump(-TRAVEL)
      bubble.jump(20)
    }
    phase = 'split'
    ramp = undefined
    goo = true
    // The bead's goo is wider: it may be out.
    sigma = Math.max(sigma, GOO)
    travel.to(0, 0.5, 0.3, t)
    bubble.to(BUBBLE, 0.4, 0.25, t)
    wake()
  }

  function merge() {
    if (phase === 'none' || phase === 'merge') return
    if (instant()) {
      if (phase === 'split') fade(0, 120)
      bubble.jump(0)
      phase = 'none'
      return wake()
    }
    const t = performance.now()
    phase = 'merge'
    if (tuck !== 'tucking') fade(GOO, 80, t)
    drive(travel, -TRAVEL, [0.36, 0], t)
    drive(bubble, 20, [0.36, 0], t)
  }

  // --- Privacy tag ---

  // The privacy tag splits off whatever is rightmost like a drop, as the bubble does, and sinks back into it.
  // emerge and retract mirror split and merge above: change them together.
  let tagPhase: 'none' | 'split' | 'shown' | 'merge' = 'none'
  $effect(() => {
    // Beside the island only: tucked, the tag brings it back and splits off once it is there.
    const has = tagged(privacy) && tuck === 'shown'
    untrack(() => (has ? emerge() : retract()))
  })

  function emerge() {
    if (tagPhase === 'split' || tagPhase === 'shown') return
    const w = Math.max(TAG, tagContent)
    if (instant()) {
      if (tagPhase === 'merge') fade(0, 120)
      tagShift.jump(0)
      tagW.jump(w)
      tagH.jump(TAG)
      tagPhase = 'shown'
      return wake()
    }
    const t = performance.now()
    if (tagPhase === 'none') {
      tagShift.jump(-(TAG_GAP + TAG))
      tagW.jump(12)
      tagH.jump(12)
    }
    tagPhase = 'split'
    ramp = undefined
    goo = true
    sigma = Math.max(sigma, GOO)
    tagShift.to(0, 0.5, 0.3, t)
    tagW.to(w, 0.4, 0.25, t)
    tagH.to(TAG, 0.4, 0.25, t)
    wake()
  }

  let retracting: ReturnType<typeof setTimeout> | undefined
  function retract() {
    if (tagPhase === 'none' || tagPhase === 'merge') return
    if (card || tagH.value > TAG + 0.5) {
      closeCard()
      clearTimeout(retracting)
      retracting = setTimeout(() => tagged(privacy) || retract(), 320)
      return
    }
    if (instant()) {
      if (tagPhase === 'split') fade(0, 120)
      tagW.jump(0)
      tagH.jump(0)
      tagPhase = 'none'
      return wake()
    }
    const t = performance.now()
    tagPhase = 'merge'
    fade(GOO, 80, t)
    drive(tagShift, -(TAG_GAP + TAG), [0.36, 0], t)
    drive(tagW, 12, [0.36, 0], t)
    drive(tagH, 12, [0.36, 0], t)
  }

  // --- Content transitions ---

  // Pieces that stay from one view to the next move from their old box to their new one, in step
  // with the shape, so a change of mind halfway costs nothing.
  let before = new Map<Element, DOMRect>()
  let box: DOMRect | undefined
  let grows = true
  // Reduced motion: how long new content waits for the old one to fade out, during the welcome and in the batteries.
  let gap = 0
  // Out of the welcome, the new content waits for the shape as it starts to close, and keeps to its middle.
  let folding = false
  let lag = 0
  let last = untrack(() => view)
  let flips: { node: HTMLElement; dx: number; dy: number; scale: number }[] = []
  let basis = { w0: 0, w1: 0, h0: 0, h1: 0 }

  $effect.pre(() => {
    void [key, revealed, stowed]
    untrack(() => {
      if (!content) return
      const [a, b] = [sizeOf(last), size]
      // Into the tuck's drop, the content leaves shrinking.
      grows = revealed && !stowed && b.width * b.height >= a.width * a.height
      const batteries = 'batteries' in last && 'batteries' in view
      gap = reduced && (last.name === 'welcome' || view.name === 'welcome' || batteries) ? 120 : 0
      folding = !reduced && last.name === 'welcome' && view.name !== 'welcome'
      lag = folding ? motion(last, view).delay : 0
      box = content.getBoundingClientRect()
      before = new Map([...content.children].map((node) => [node, node.getBoundingClientRect()]))
    })
  })

  $effect(() => {
    void key
    untrack(() => {
      const from = last
      last = view
      if (from === view) return
      flip()
      reshape(from, view)
      ride()
    })
  })

  // The content box is laid out at its final height from the top: folding, it rides the shape's middle.
  function ride() {
    if (content) content.style.translate = folding ? `-50% ${(height.value - size.height) / 2}px` : ''
  }

  function flip() {
    if (reduced) return
    // A piece on its way out is inert and has already left the layout.
    const nodes = [clock, art, eq, ring].filter(
      (node): node is HTMLElement => !!node && !node.inert && before.has(node),
    )
    for (const node of nodes) node.style.transform = ''
    flips = nodes.map((node) => {
      const [a, b] = [before.get(node)!, node.getBoundingClientRect()]
      node.style.transformOrigin = '0 0'
      return { node, dx: a.left - b.left, dy: a.top - b.top, scale: a.width / b.width }
    })
    basis = { w0: width.value, w1: size.width, h0: height.value, h1: size.height }
    follow(true)
  }

  function follow(moving: boolean) {
    const { w0, w1, h0, h1 } = basis
    const p = !moving
      ? 1
      : Math.abs(w1 - w0) >= 1
        ? (width.value - w0) / (w1 - w0)
        : Math.abs(h1 - h0) >= 1
          ? (height.value - h0) / (h1 - h0)
          : 1
    for (const { node, dx, dy, scale } of flips) {
      const u = 1 - p
      node.style.transform = u ? `translate(${dx * u}px, ${dy * u}px) scale(${1 + (scale - 1) * u})` : ''
    }
    if (!moving) flips = []
  }

  // Content comes in from a blur a beat after the shape starts, and leaves faster than it came.
  function enter(node: HTMLElement, { step = 0 } = {}) {
    if (reduced) return { delay: gap, duration: 120, css: (t: number) => `opacity:${t}` }
    if (content?.contains(node)) {
      // Scaled from the island's center, or from its top for the panel, the peek and the list, which pours down out
      // of the bar.
      const [r, c] = [node.getBoundingClientRect(), content.getBoundingClientRect()]
      const fromTop = view.name === 'expanded' || view.name === 'peek' || (view.name === 'bar' && !!view.rows)
      const top = fromTop ? c.top : c.top + c.height / 2
      node.style.transformOrigin = `${c.left + c.width / 2 - r.left}px ${top - r.top}px`
    }
    return {
      delay: ENTER.delay + ENTER.stagger * step + lag,
      duration: ENTER.duration,
      easing: entering,
      css: (t: number, u: number) =>
        `opacity:${t};filter:blur(${ENTER.blur * u}px);scale:${ENTER.scale + (1 - ENTER.scale) * t}`,
    }
  }

  const PIN = ['position', 'left', 'top', 'width', 'height', 'box-sizing', 'margin']
  function exit(node: HTMLElement, { shrinks = !grows } = {}) {
    let unpin = () => {}
    if (content?.contains(node)) {
      // Out of the layout, where it was drawn, so the pieces that stay can move at once.
      const r = before.get(node) ?? node.getBoundingClientRect()
      const c = box ?? content.getBoundingClientRect()
      flips = flips.filter((f) => f.node !== node)
      const was = PIN.map((k) => node.style.getPropertyValue(k))
      Object.assign(node.style, {
        position: 'absolute',
        left: `calc(50% + ${r.left - c.left - c.width / 2}px)`,
        // Folding, the box rides the shape's middle: the old row starts where it was drawn.
        top: `${r.top - c.top - (folding ? (c.height - size.height) / 2 : 0)}px`,
        width: `${node.offsetWidth}px`,
        // Its size as drawn: a piece styled for the panel, such as the artwork, would take the closed view's.
        height: `${node.offsetHeight}px`,
        boxSizing: 'border-box',
        margin: '0',
        transform: '',
      })
      const pinned = PIN.map((k) => node.style.getPropertyValue(k))
      // Its own styles come back, but not over one set since.
      unpin = () =>
        PIN.forEach((k, i) => node.style.getPropertyValue(k) === pinned[i] && node.style.setProperty(k, was[i]))
    }
    // Called back before it is gone, Svelte keeps the element and ticks it at 1, no longer inert: it rejoins the
    // layout. While it leaves it is inert, and the tick does nothing.
    // shortcut: Svelte keeps this config for the element's next exit, which then fades in place, unpinned, upgrade if
    // those 100 ms ever show.
    const tick = () => node.inert || unpin()
    if (reduced) return { duration: 120, css: (t: number) => `opacity:${t}`, tick }
    // No blur on the way out: too quick to see, and a growing blur stalls the GPU for several frames.
    const to = shrinks ? 1 - EXIT.scale : 1 + EXIT.scale
    return {
      duration: EXIT.duration,
      easing: leaving,
      css: (t: number, u: number) => `opacity:${t};scale:${1 + (to - 1) * u}`,
      tick,
    }
  }

  // Only the digits that change roll over: the old one rises out, the new one rises in.
  function roll(node: Element, _: unknown, { direction }: { direction: 'in' | 'out' | 'both' }) {
    if (reduced) return {}
    const into = direction === 'in'
    const [duration, easing, y] = into ? [200, entering, 6] : [120, leaving, -6]
    return {
      duration,
      easing,
      css: (t: number, u: number) => `opacity:${t};translate:0 ${y * u}px` + (into ? `;filter:blur(${3 * u}px)` : ''),
    }
  }

  // --- Clicks, cursor, fullscreen and peeks ---

  // The Rust side lets clicks through everywhere except over these rounded rectangles, padded by a pixel.
  let sent: (Rect & { radius: number })[] = []
  function report(moving: boolean) {
    if (!tauri) return
    // Tucking, nothing takes the cursor; tucked, only the line's hit area. While the capture takes input, its frozen
    // frame has every click.
    const rects =
      (hidden && drop.resting) || tuck === 'tucking' || tuck === 'tucked' || capturing
        ? []
        : [geometry.fill, geometry.dot, geometry.tag].filter((r) => r !== undefined)
    const padded = rects.map(({ x, y, width, height }) => ({
      x: x - 1,
      y: y - 1,
      width: width + 2,
      height: height + 2,
      radius: radius(height) + 1,
    }))
    if (tuck === 'tucked' && !hidden) padded.push({ ...geometry.hit, radius: 0 })
    const sides = ['x', 'y', 'width', 'height'] as const
    const changed =
      padded.length !== sent.length ||
      padded.some((r, i) => sides.some((side) => Math.abs(r[side] - sent[i][side]) >= 0.5))
    if (!changed && moving) return
    sent = padded
    invoke('set_island_rects', { rects: padded })
  }

  // Gives under the finger at once. The panel opens on release and carries the press's speed.
  // The weather's peek opens nothing, so it never gives: only its credit takes a click.
  let pressed = false
  function press(down: boolean) {
    if (reduced || expanded || barOpen || captureView || greeting === 'playing' || (down && sky)) return
    if (pressed === down) return
    pressed = down
    const [k, [duration, bounce]] = down ? [PRESS.scale, PRESS.down] : [1, PRESS.up]
    const t = performance.now()
    width.to(size.width * k, duration, bounce, t)
    height.to(size.height * k, duration, bounce, t)
    wake()
  }

  function open() {
    if (hidden || tuck === 'tucking' || tuck === 'tucked') return
    pressed = false
    // A finished timer never opens: a click on it is its OK. A battery peek opens the batteries.
    if (top && ended(top, Date.now())) return dismiss(top.id)
    if (power) return openBatteries(false)
    panel = undefined
    expanded = true
  }

  // In fullscreen the content leaves, then the island slides up off the screen, shadow included.
  // Coming back, the content waits until the island is 60 % of the way down.
  function fullscreen(on: boolean) {
    if (on === hidden) return
    hidden = on
    revealed = !on && reduced
    if (on) {
      // It comes back compact: no panel, no hover, no press, no peek.
      clearTimeout(hoverTimer)
      closeCard()
      clearTimeout(peekTimer)
      press(false)
      // Rust forgets where the cursor was: no word of it leaving the island or the tag will come.
      pointer = false
      onTag = false
      rest = undefined
      expanded = false
      hovered = false
      peeking = undefined
      power = undefined
      sky = undefined
      closeBar()
      if (capturing) captureKey('escape', true)
    }
    const t = performance.now()
    const off = -(TOP + height.target + 24)
    if (reduced) drop.jump(on ? off : 0)
    else if (on) drop.to(off, ...FULLSCREEN.hide, t + FULLSCREEN.delay)
    else {
      reveal = drop.value * 0.4
      drop.to(0, ...FULLSCREEN.show, t)
    }
    wake()
  }

  // A new song while the island is compact swells it for a moment. A new song in the bubble swells the bubble.
  const newSong = (next?: Activity, prev?: Activity) =>
    next?.kind === 'music' && prev?.kind === 'music' && next.id === prev.id && next.title !== prev.title
  let song: Activity | undefined
  let aside: Activity | undefined
  $effect(() => {
    const [playing, beside] = [arrangement.island, arrangement.bubble]
    untrack(() => {
      // While Windows says you're busy, the song changes in place.
      if (newSong(playing, song) && view.name === 'compact' && peeks(playing, presence)) alert()
      if (newSong(beside, aside) && peeks(beside, presence)) nudge()
      ;[song, aside] = [playing, beside]
    })
  })

  // The cursor crosses the island on its way to tabs: it grows only once the cursor rests on it.
  // point and move share their rest logic with pointTag and moveTag below: change them together.
  let hoverTimer: ReturnType<typeof setTimeout>
  let pointer = $state(false)
  let rest: { x: number; y: number } | undefined
  function point(inside: boolean) {
    pointer = inside
    rest = undefined
    // A cursor on it keeps it out after a battery peek.
    if (inside) retuck = undefined
    clearTimeout(hoverTimer)
    if (tuck === 'tucking' || tuck === 'tucked') {
      // On the line a rest brings the island back, once a cursor the tuck left there has gone.
      if (tuck === 'tucked' && !inside) armed = true
      else if (tuck === 'tucked' && armed) hoverTimer = setTimeout(untuck, hoverTime)
      return
    }
    if (!inside) press(false)
    // Rust hears the bubble and the tag as the island, but a rest on them grows nothing. While it holds the cursor,
    // the page's :hover is current.
    const onIsland = () => inside && !onTag && !document.querySelector('.island.bubble:hover')
    if (inside !== hovered) hoverTimer = setTimeout(() => (hovered = onIsland()), inside ? hoverTime : LEAVE)
    if (!inside && held) {
      held = false
      beats.push(setTimeout(fold, LEAVE))
    }
  }

  // A cursor still moving on the island starts the wait over from where it is.
  function move({ clientX: x, clientY: y }: PointerEvent) {
    if (!pointer || hovered) return
    if (rest && Math.abs(x - rest.x) <= REST && Math.abs(y - rest.y) <= REST) return
    if (rest) point(true)
    rest = { x, y }
  }

  // Once the window lets the cursor through, the DOM stops hearing about it: Rust watches instead.
  $effect(() => {
    if (!tauri) return
    const stops = [
      listen<number | null>('island://pointer', ({ payload }) => {
        if (payload !== null) hoverTime = payload
        point(payload !== null)
        // Once the window lets the cursor through, the tag never hears it leave.
        if (payload === null) pointTag(false)
      }),
      listen<boolean>('island://dismiss', ({ payload: escape }) => {
        // Esc on a grown ring goes back to the row, and Rust watches for the next one.
        if (escape && grown && expanded) {
          grown = undefined
          invoke('set_island_expanded', { expanded: true }).catch(console.error)
          return
        }
        elsewhere()
        expanded = false
        closeCard()
        closeBar()
      }),
      listen<Presence>('island://presence', ({ payload }) => {
        presenceHeard = true
        presence = payload
        fullscreen(payload === 'hidden')
        // The welcome stops while you're busy or in fullscreen, and plays again once the island is back.
        if (payload !== 'shown' && greeting === 'playing') end(true)
      }),
      listen('bar://toggle', () => toggleBar()),
      listen('clipboard://toggle', toggleHistory),
      listen('capture://toggle', toggleCapture),
      listen<string>('capture://pixel', ({ payload }) => pixel(payload)),
      listen('capture://box', boxed),
      listen('island://tuck', toggleTuck),
      listen('island://elsewhere', elsewhere),
      // A window moved or resized: the island makes room for Snap layouts, and comes back unless it was tucked.
      listen<boolean>('island://moving', ({ payload }) => (payload ? tuckIn('move') : tucker === 'move' && untuck())),
      listen<number>('power://plugged', ({ payload }) => notice({ kind: 'plugged', percent: payload })),
      listen<Low>('power://low', ({ payload }) => notice({ kind: 'low', ...payload })),
      listen<Device>('power://device', ({ payload }) => notice({ kind: 'device', device: payload }, connects)),
      listen<Battery>('power://battery', ({ payload }) => (battery = payload)),
      listen<Device>('power://device-low', ({ payload }) => notice({ kind: 'deviceLow', device: payload })),
      listen<Device>('power://device-gone', ({ payload }) => notice({ kind: 'deviceGone', device: payload }, connects)),
      // The tray's forget: the next weather asks for the yes again, and a bare « météo » for a city.
      listen('weather://forget', () => {
        consented = false
        here = undefined
      }),
    ]
    return () => stops.forEach((stop) => stop.then((unlisten) => unlisten()))
  })

  $effect(() => {
    // Esc and a click elsewhere close the tag's card too.
    if (tauri) invoke('set_island_expanded', { expanded: expanded || card || barOpen })
  })

  let peekTimer: ReturnType<typeof setTimeout>
  function peek(id: string, ms = 3000) {
    // The activity has already changed in place: only the peek is skipped.
    if (!peeks(activities.find((a) => a.id === id), presence)) return
    peeking = id
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => (peeking = undefined), ms)
  }

  // --- Timers ---

  // The digits a timer shows: the time left, or since its end.
  function timerDigits(t: Timer) {
    const at = now.getTime()
    return ended(t, at) ? formatOvertime(overtime(t, at)) : formatLeft(t, at)
  }

  // Timers whose end the island already showed, and the last chime each one rang. Not reactive, as with the icons:
  // a change must not rerun the effect that makes it.
  const announced: Record<string, true> = {}
  const rung: Record<string, number> = {}

  // At its end a timer chimes every 10 s for a minute, even in fullscreen. Then, as soon as the island shows, it
  // takes the island from all but a call, swells it and peeks for 6 s before it folds into the done pill. Run
  // before the content is measured, so the shape heads straight for the peek.
  $effect.pre(() => {
    const at = now.getTime()
    const [list, first, second, away] = [timers, arrangement.island, arrangement.bubble, hidden]
    untrack(() => {
      // A timer gone without a word from here, such as one the demo took away, leaves nothing behind.
      for (const id of [...Object.keys(rung), ...Object.keys(announced)]) {
        if (!list.some((t) => t.id === id)) forget(id)
      }
      let chime = false
      for (const t of list) {
        const slot = chimeSlot(t, at)
        if (slot === undefined || rung[t.id] === slot) continue
        rung[t.id] = slot
        chime = true
      }
      // The browser demo stays silent.
      if (chime && tauri) invoke('timer_chime').catch(console.error)
      if (away) return
      for (const t of list) {
        if (!ended(t, at) || announced[t.id]) continue
        announced[t.id] = true
        // A timer that ends folds the welcome to it, even one already on the island as it began.
        if (greeting === 'playing') end()
        if (t.id === first?.id) {
          expanded = false
          alert()
          peek(t.id, END_PEEK)
        } else if (t.id === second?.id) nudge()
      }
    })
  })

  function forget(id: string) {
    delete announced[id]
    delete rung[id]
    if (peeking === id) peeking = undefined
  }

  // Changes one timer. One that ended and gets more time starts over under a new id.
  function edit(id: string, change: (timer: Timer) => Timer | undefined) {
    activities = activities.flatMap((a) => {
      if (a.id !== id || !isTimer(a)) return [a]
      const next = change(a)
      if (next?.id !== id) forget(id)
      return next ? [next] : []
    })
  }

  // OK, a click on the done pill, × in the panel or 'stop' in the bar.
  const dismiss = (id: string) => edit(id, () => undefined)

  // +1 min on a finished timer: a new minute under the same name, which lands with a swell.
  function again(id: string) {
    swell = true
    edit(id, (t) => add(t, 60_000, Date.now()))
  }

  function togglePause(t: Timer) {
    const at = Date.now()
    edit(t.id, (a) => (a.left === undefined ? pause(a, at) : resume(a, at)))
  }

  // --- Startup and first-launch welcome ---

  // Every start drops the island in from above the screen, as it comes back after fullscreen, on the first frame
  // after the fonts are ready. The first start after install also says hello, once (welcome_pending).
  let presenceHeard = false
  let saved = false
  let held = false
  let first: string | undefined
  let beats: ReturnType<typeof setTimeout>[] = []
  let greet: HTMLElement | undefined
  let row = $state<HTMLElement>()

  const ask = <T>(command: string, fallback: T) =>
    tauri ? invoke<T>(command).catch(() => fallback) : Promise.resolve(fallback)
  Promise.all([
    ask<Presence>('island_presence', 'shown'),
    ask('welcome_pending', false),
    ask<string | null>('bar_shortcut', null),
    document.fonts.ready,
  ]).then(([state, pending, registered]) => {
    // Set a frame ahead, so the hidden shortcut row is in the page when play() measures it. The demo brings its own.
    if (tauri) shortcut = registered ?? undefined
    requestAnimationFrame(() => {
      // An event that came in the meantime is newer.
      if (!presenceHeard) presence = state
      greeting = pending ? 'waiting' : 'over'
      launched = true
      // Hidden at launch, the island comes in with the return drop once the fullscreen app ends.
      if (presence === 'hidden') hidden = true
      if (hidden) return
      if (pending && presence === 'shown') play(true)
      else arrive()
    })
  })

  function arrive() {
    if (reduced) {
      // Nothing travels: the island fades in where it is.
      drop.jump(0)
      revealed = true
      document.body.animate({ opacity: [0, 1] }, 200)
    } else {
      reveal = drop.value * 0.4
      drop.to(0, ...FULLSCREEN.show, performance.now())
    }
    wake()
  }

  // The welcome plays only while the island is shown and nothing else holds it, and waits until then.
  $effect(() => {
    if (!launched || greeting !== 'waiting' || presence !== 'shown' || hidden || barOpen || expanded || card) return
    // Tucked, the island comes back first, and plays once it is there.
    if (tuck !== 'shown') return untrack(untuck)
    // Coming back from fullscreen, the return drop is its drop.
    untrack(() => play(!drop.resting))
  })

  // A hidden copy's width, as laid out.
  const wide = (node?: HTMLElement) => Math.ceil(node?.getBoundingClientRect().width ?? 0)

  // Drop, bead, greeting, shortcut, then the fold to whatever the island would show (WELCOME). Played later than
  // the start, the island is already in place: it starts at the bead.
  function play(dropping: boolean) {
    // Measured on the hidden copies before anything moves: a layout mid-animation drops frames.
    const [hello, shown] = [welcomeWidth('hello', wide(greet)), keys && welcomeWidth('keys', wide(row))]
    greeting = 'playing'
    first = arrangement.island?.id
    const t0 = performance.now() - (dropping ? 0 : WELCOME.ink)
    const at = (ms: number, then: () => void) => beats.push(setTimeout(then, t0 + ms - performance.now()))
    if (dropping) {
      blank = true
      // Still above the screen: a song heard before now must not swing the empty island it drops as.
      const idle = sizeOf({ name: 'idle' })
      width.jump(idle.width)
      height.jump(idle.height)
      mark = reduced
      arrive()
    }
    if (!instant()) at(WELCOME.ink, ink)
    at(WELCOME.hello, () => {
      absorb()
      blank = mark = false
      welcome = { name: 'welcome', step: 'hello', width: hello }
      spoken = announce(shortcut, lang)
    })
    if (shown) {
      at(WELCOME.keys, () => (welcome = { name: 'welcome', step: 'keys', width: shown }))
      // Seen once the shortcut has shown for a second.
      at(WELCOME.keys + 1000, save)
      at(WELCOME.fold, fold)
    } else
      at(WELCOME.bare, () => {
        save()
        fold()
      })
  }

  // A cursor resting on the island holds the shortcut: the fold waits until 300 ms after it leaves (point).
  function fold() {
    if (pointer) held = true
    else end()
  }

  // A click on the island folds at once, from wherever the shape is, and counts as seen.
  function skip() {
    save()
    end()
  }

  /** Folds to whatever the island would show. `again`: it plays again once the island is shown, unless seen. */
  function end(again = false) {
    beats.forEach(clearTimeout)
    beats = []
    held = false
    absorb()
    blank = mark = false
    welcome = undefined
    greeting = again && !saved ? 'waiting' : 'over'
    if (spoken) setTimeout(() => (spoken = ''), 1500)
  }

  function save() {
    if (saved) return
    saved = true
    if (tauri) invoke('welcome_done').catch(console.error)
  }

  // A call, a timer or a song that starts ends the welcome and takes the island. A song already playing may reach
  // the page while the island drops in: that one is what the welcome folds to.
  $effect(() => {
    const next = arrangement.island
    untrack(() => {
      if (greeting !== 'playing' || next?.id === first) return
      if (!welcome && next?.kind === 'music') first = next.id
      else end()
    })
  })

  // The bead splits off the pill's bottom from inside, as the bubble splits off its end, with the same springs and
  // a wider goo, since its gap is wider. ink and absorb mirror split and merge above: change them together.
  function ink() {
    const t = performance.now()
    inkPhase = 'split'
    ramp = undefined
    goo = true
    sigma = INK.goo
    inkD.jump(-8)
    inkR.jump(8)
    inkD.to(INK.d, 0.5, 0.3, t)
    inkR.to(INK.r, 0.4, 0.25, t)
    wake()
  }

  // Drawn back up into the pill, which lets it go once its centre is 8 px inside (frame).
  function absorb() {
    if (inkPhase !== 'split') return
    const t = performance.now()
    inkPhase = 'merge'
    drive(inkD, -14, [0.36, 0], t)
    drive(inkR, 6, [0.36, 0], t)
    wake()
  }

  // The demo plays it again, from the drop.
  function replay() {
    if (hidden) return
    end()
    saved = false
    drop.jump(-(TOP + height.target + 24))
    revealed = false
    play(true)
  }

  // --- Music ---

  // Every player Windows can see. A paused one stays a minute, and one that vanishes for a moment is held.
  let players: Players = nobody()
  let latest: Player[] = []
  let heard = false
  let change: ReturnType<typeof setTimeout> | undefined
  const artwork = new SvelteMap<string, { url: string; color?: string }>()

  function refresh() {
    const t = Date.now()
    players = update(players, latest, t)
    music = songs(showing(players, t), artwork)
    prefer = stillPicked(prefer, [...activities, ...music])
    // The player's own word after a seek takes over from the place the bar was dropped at.
    const answer = scrub && !scrub.held && latest.find((p) => p.id === scrub!.id)
    if (answer && (answer.positionMs !== scrub!.from.positionMs || answer.updatedMs !== scrub!.from.updatedMs)) {
      scrub = undefined
    }
    clearTimeout(change)
    const next = nextChange(players, t)
    change = next === undefined ? undefined : setTimeout(refresh, next - t)
  }

  // Until the new artwork's colour is known, the last one stays: no flash of grey between songs.
  async function paint(id: string, url: string | null) {
    if (!url) {
      artwork.delete(id)
      return refresh()
    }
    artwork.set(id, { url, color: artwork.get(id)?.color })
    refresh()
    const color = await tint(url)
    if (artwork.get(id)?.url !== url) return
    artwork.set(id, { url, color })
    refresh()
  }

  $effect(() => {
    if (!tauri) return
    const stops = [
      listen<Player[]>('media://players', ({ payload }) => {
        heard = true
        latest = payload
        refresh()
      }),
      listen<Artwork>('media://artwork', ({ payload }) => paint(payload.id, payload.url)),
    ]
    // What Rust sent before these listeners existed.
    invoke<Snapshot>('media_players')
      .then((snapshot) => {
        if (!heard) latest = snapshot.players
        Object.entries(snapshot.artwork).forEach(([id, url]) => artwork.has(id) || paint(id, url))
        refresh()
      })
      .catch(console.error)
    return () => {
      stops.forEach((stop) => stop.then((unlisten) => unlisten()))
      clearTimeout(change)
    }
  })

  function control(action: 'play' | 'pause' | 'next' | 'previous') {
    const id = parts.player?.id
    if (tauri && id) invoke('media_control', { id, action })
  }

  // --- Privacy state, tag size and card ---

  $effect(() => {
    if (!tauri) return
    let privacyHeard = false
    const stop = listen<Privacy>('privacy://state', ({ payload }) => {
      privacyHeard = true
      privacy = payload
    })
    // What Rust found before this listener existed.
    invoke<Privacy>('privacy_state')
      .then((state) => privacyHeard || (privacy = state))
      .catch(console.error)
    return () => {
      stop.then((unlisten) => unlisten())
    }
  })

  // Who uses the microphone or the camera, as the tag's button names it and a screen reader hears it change.
  const inUse = $derived(
    label(privacy) && `${label(privacy)}: ${light(privacy) === 'camera' ? 'camera' : 'microphone'} in use`,
  )

  // The tag fits what it holds: a disc around the dot and the crossed microphone, or the card. The card opens as
  // the island does, width first, and closes height first, without a bounce.
  let tagContent = $state(0)
  const tagSize = $derived(card ? cardSize(privacy.apps.length) : { width: Math.max(TAG, tagContent), height: TAG })
  $effect(() => {
    const { width: w, height: h } = tagSize
    untrack(() => {
      if (tagPhase !== 'split' && tagPhase !== 'shown') return
      if (w === tagW.target && h === tagH.target) return
      if (instant()) {
        tagW.jump(w)
        tagH.jump(h)
        return wake()
      }
      const t = performance.now()
      if (h > tagH.target) {
        drive(tagW, w, OPEN.width, t)
        drive(tagH, h, OPEN.height, t)
      } else if (h < tagH.target) {
        drive(tagW, w, CLOSE.width, t)
        drive(tagH, h, CLOSE.height, t)
      } else drive(tagW, w, w > tagW.value ? [0.4, 0.3] : [0.3, 0], t)
      wake()
    })
  })

  // The card opens once the cursor rests on the tag, and closes a beat after it leaves, as the island's hover does.
  // pointTag and moveTag share their rest logic with point and move above: change them together.
  let tagRest: { x: number; y: number } | undefined
  // Closed by Esc or a click while the cursor is on the tag, the card stays shut until the cursor leaves it.
  let shut = false
  function pointTag(inside: boolean) {
    onTag = inside
    shut = false
    tagRest = undefined
    clearTimeout(tagTimer)
    tagTimer = setTimeout(() => (card = inside && tagged(privacy)), inside ? hoverTime : LEAVE)
  }

  function moveTag({ clientX: x, clientY: y }: PointerEvent) {
    if (!onTag || card || shut) return
    if (tagRest && Math.abs(x - tagRest.x) <= REST && Math.abs(y - tagRest.y) <= REST) return
    if (tagRest) pointTag(true)
    tagRest = { x, y }
  }

  function closeCard() {
    shut = onTag
    clearTimeout(tagTimer)
    card = false
  }

  // --- Tuck ---

  // Who tucked it, the activities' marks at the last look (wakes), and the gestures: a scroll summed over a moment,
  // and a pull down from the line. A cursor the tuck left on the line must leave it once before a rest there counts.
  let tucker: Tucker = 'you'
  let seen: string[] = []
  let notches: Notch[] = []
  let pull: number | undefined
  let armed = true
  // A press on the island, while it is held: where it began, and whether it has gone past a click's square.
  let grip: { x: number; y: number; far: boolean } | undefined
  // A swipe's press doesn't also click the island or its panel as it is released.
  let swiped = false

  const away = () => tuck === 'tucking' || tuck === 'tucked'
  const toggleTuck = () => {
    retuck = undefined
    return away() ? untuck() : tuckIn('you')
  }

  /** Tucks the island into its line, drawn in from `way`, after a push that way for a wheel swipe. Never beside the
   * privacy tag, which always brings it back. */
  function tuckIn(by: Tucker, way: Direction = 'up', push = false) {
    if (away() || tagged(privacy)) return
    // The welcome holds the island, unless you tuck it: then it counts as seen.
    if (greeting === 'playing') {
      if (by !== 'you') return
      skip()
    }
    tucker = by
    // From the open panel, its ink drains up into the edge instead.
    const panel = expanded
    expanded = false
    closeBar()
    press(false)
    clearTimeout(hoverTimer)
    hovered = false
    seen = marks([...activities, ...music], Date.now())
    const t = performance.now()
    const back = tuck === 'returning'
    stop()
    tuck = 'tucking'
    stowed = true
    if (instant()) return dimTuck(t)
    if (push) {
      const spring = way === 'left' || way === 'right' ? slide : lift
      spring.to(spring.target, ...PRESS.up, t)
      spring.kick(way === 'left' || way === 'up' ? -SWIPE.push : SWIPE.push, t)
    }
    // A bubble merges back into the island as it closes, in the tuck's goo.
    drawUp(t, back, way, panel)
    wake()
  }

  /** Brings the island back from its line, to whatever it would show now. */
  function untuck() {
    if (!away()) return
    const t = performance.now()
    const mid = tuck === 'tucking' && pill
    stop()
    clearTimeout(hoverTimer)
    notches = []
    pull = undefined
    // The browser never hears the cursor leave a line that is gone.
    if (!tauri) pointer = false
    tuck = 'returning'
    dim('shine', 0, 60, t)
    if (instant()) return dimBack(t)
    if (mid) return reverse(t)
    dropBack(t)
  }

  // The edge's ink comes down while the island closes into a drop, the drop is drawn up through a neck, and the ink
  // spreads along the edge. The welcome bead's goo: its neck holds across the 8 px under the edge. Swiped sideways,
  // the island slides that way first, so the neck forms off-centre and the drop is drawn up on a curve; swiped down,
  // it first stretches down like a rubber band, then snaps up into the same neck. From an open panel, the panel drains
  // up through that neck instead (DRAINS).
  function drawUp(t0: number, back = false, way: Direction = 'up', panel = false) {
    const x = way === 'left' ? -SWIPE.side : way === 'right' ? SWIPE.side : 0
    pill = true
    if (!back) {
      lineW.jump(GOUTTE.ink)
      lineB.jump(GOUTTE.away)
      lineX.jump(x)
    }
    fade(INK.goo, 80, t0)
    drive(lineB, TUCK.height, MERGE, t0)
    // Its own speed is kept: a drag or a push already heads that way.
    if (x) slide.to(x, ...MERGE, t0)
    if (way === 'down') {
      drive(width, width.value - SWIPE.stretch, FULLSCREEN.hide, t0)
      drive(height, height.value + SWIPE.stretch, FULLSCREEN.hide, t0)
      t0 += SWIPE.snap
    }
    if (panel) {
      const driven = { width, height, lift, taper, lineW, lineX }
      for (const { at, part, to, axis } of DRAINS) step(t0, at, (t) => drive(driven[part], to, axis, t))
    } else {
      step(t0, GOUTTE.close, (t) => {
        drive(width, BUBBLE, FULLSCREEN.hide, t)
        drive(height, BUBBLE, FULLSCREEN.hide, t)
      })
      // Drawn up, the drop thins and stretches, its top first. The width keeps its speed: it already heads that way.
      step(t0, GOUTTE.draw, (t) => {
        width.to(GOUTTE.thin, ...MERGE, t)
        drive(height, GOUTTE.long, MERGE, t)
        drive(lift, -(TOP + GOUTTE.rise), MERGE, t)
      })
      // The ink spreads along the edge into the centred line.
      step(t0, GOUTTE.spread, (t) => {
        drive(lineW, TUCK.width, CLOSE.width, t)
        drive(lineX, 0, CLOSE.width, t)
      })
    }
    check(
      () => TOP + drop.value + lift.value + height.value < lineB.value - 2,
      (t) => {
        pill = false
        fade(0, 120, t)
      },
    )
    check(
      () => !pill && lineB.value > TUCK.height - 0.5 && lineW.value > TUCK.width - 4,
      (t) => dim('shine', 1, 120, t),
    )
  }

  // The line beads a drop, as the welcome's bead leaves the island, mirrored: it falls and opens into the island.
  // The bubble's goo, at once: the neck breaks just before the drop lands 8 px under the edge.
  function dropBack(t0: number) {
    const r = GOUTTE.bead
    ramp = undefined
    goo = true
    sigma = GOO
    pill = true
    // Its centre 8 px inside the line's bottom, as the welcome's bead starts 8 px inside the pill.
    width.jump(2 * r)
    height.jump(2 * r)
    taper.jump(0)
    lift.jump(TUCK.height - 2 * r - TOP)
    drive(lineW, GOUTTE.gather, MERGE, t0)
    drive(lift, 0, SPLIT.d, t0)
    drive(width, BUBBLE, SPLIT.r, t0)
    drive(height, size.height, SPLIT.r, t0)
    step(t0, GOUTTE.release, (t) => drive(lineB, GOUTTE.away, MERGE, t))
    step(t0, GOUTTE.open, (t) => {
      opened = true
      drive(width, size.width, OPEN.width, t)
      if (height.target !== size.height) drive(height, size.height, OPEN.height, t)
      stowed = false
    })
    check(
      () => lineB.value < -6 && TOP + lift.value > 5,
      (t) => fade(0, 120, t),
    )
  }

  // Called back mid-tuck, every spring heads back from where it is.
  function reverse(t: number) {
    opened = true
    drive(width, size.width, OPEN.width, t)
    drive(height, size.height, OPEN.height, t)
    drive(lift, 0, FULLSCREEN.show, t)
    drive(slide, 0, FULLSCREEN.show, t)
    drive(taper, 0, OPEN.width, t)
    drive(lineB, GOUTTE.away, MERGE, t)
    if (sigma > 0) fade(0, 120, t)
    stowed = false
  }

  // Reduced motion, and a contrast theme where the goo can't show: the island and the line crossfade where they are.
  function dimTuck(t: number) {
    pill = true
    lineW.jump(TUCK.width)
    lineB.jump(TUCK.height)
    fades.line = still(0)
    dim('pill', 0, 120, t)
    dim('line', 1, 120, t)
    dim('shine', 1, 120, t)
  }

  function dimBack(t: number) {
    pill = true
    opened = true
    width.jump(size.width)
    height.jump(size.height)
    lift.jump(0)
    slide.jump(0)
    fades.pill = still(0)
    dim('pill', 1, 120, t)
    dim('line', 0, 120, t)
    stowed = false
  }

  /** At rest, the line or the island is drawn from its own numbers, whichever way it got there. */
  function settle() {
    const tucked = tuck === 'tucking'
    checks = []
    ramp = undefined
    sigma = 0
    goo = false
    fades = { pill: still(1), line: still(1), shine: still(tucked ? 1 : 0) }
    slide.jump(0)
    taper.jump(0)
    lineX.jump(0)
    if (tucked) {
      pill = false
      lineW.jump(TUCK.width)
      lineB.jump(TUCK.height)
      tuck = 'tucked'
    } else {
      lineW.jump(0)
      lineB.jump(GOUTTE.away)
      lift.jump(0)
      tuck = 'shown'
    }
  }

  // A beat at `ms` after `t0`, whose springs start on time even when the timeout runs late.
  function step(t0: number, ms: number, then: (t: number) => void) {
    const id = setTimeout(
      () => {
        steps = steps.filter((s) => s !== id)
        then(t0 + ms)
        wake()
      },
      t0 + ms - performance.now(),
    )
    steps.push(id)
  }

  // A beat that waits on a shape rather than a time: it runs on the first frame where `when` holds.
  function check(when: () => boolean, then: (t: number) => void) {
    checks.push({ when, then })
  }

  function stop() {
    steps.forEach(clearTimeout)
    steps = []
    checks = []
  }

  function dim(name: keyof typeof fades, to: number, ms: number, t = performance.now()) {
    fades[name] = { from: level(fades[name], t), to, start: t, end: t + ms }
    wake()
  }

  // A wheel or touchpad swipe on the island, once the hover dwell has passed, tucks it from that side; down on the line
  // brings it back.
  function wheelIsland(event: WheelEvent) {
    if (tuck !== 'shown' || !hovered || barOpen || card) return
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    notches = scroll(notches, event.timeStamp, event.deltaX, event.deltaY, lines)
    const way = swipe(notches)
    if (!way) return
    notches = []
    armed = event.clientY >= TUCK.hit
    tuckIn('you', way, true)
  }

  function wheelLine(event: WheelEvent) {
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    notches = scroll(notches, event.timeStamp, event.deltaX, event.deltaY, lines)
    if (swipe(notches) === 'down') untuck()
  }

  // A press on the island or its panel that moves is a swipe: past a click's square the island follows the pointer,
  // less and less, and released out there it tucks from that side. Back inside, or beside the privacy tag, it springs
  // back. A press on the progress bar seeks instead.
  function gripStart(event: PointerEvent) {
    swiped = false
    if (event.button !== 0 || tuck !== 'shown' || barOpen || card) return
    if ((event.target as Element).closest('.scrub')) return
    grip = { x: event.clientX, y: event.clientY, far: false }
  }

  function gripMove({ clientX, clientY }: PointerEvent) {
    if (!grip) return
    const [dx, dy] = [clientX - grip.x, clientY - grip.y]
    if (!grip.far && drag(dx, dy)) {
      grip.far = swiped = true
      press(false)
    }
    if (!grip.far || reduced) return
    const t = performance.now()
    slide.to(resist(dx), ...PRESS.down, t)
    lift.to(resist(dy), ...PRESS.down, t)
    wake()
  }

  function gripEnd({ clientX, clientY }: PointerEvent) {
    if (!grip) return
    const way = drag(clientX - grip.x, clientY - grip.y)
    const far = grip.far
    grip = undefined
    if (way && tuck === 'shown' && !tagged(privacy)) return tuckIn('you', way)
    if (!far) return
    const t = performance.now()
    drive(slide, 0, PRESS.up, t)
    drive(lift, 0, PRESS.up, t)
    wake()
  }

  // While tucked, what's new and stays brings the island back (wakes), and so does the privacy tag. Nothing is
  // looked at in fullscreen: what came then is new once the island shows.
  $effect(() => {
    const [list, at, tag, off] = [[...activities, ...music], now.getTime(), tagged(privacy), hidden]
    untrack(() => {
      if (!away() || off) return
      if (tag || wakes(seen, list, presence, at)) untuck()
      else seen = marks(list, at)
    })
  })

  // What shows tucks itself at rest when every kind of it tucks (AUTO in tuck.ts): never under the cursor, with
  // something open, or in fullscreen. The site's examples keep their island.
  const atRest = $derived(
    (tauri || import.meta.env.DEV) && launched && tuck === 'shown' && !hidden && !pointer && !expanded && !card,
  )
  const showsNow = $derived(
    kinds(
      {
        island: arrangement.island,
        bubble: beside,
        tagged: tagged(privacy),
        bar: barOpen || !!launch || telling,
        capture: !!captureView,
        welcome: greeting === 'playing',
        peeking,
        peek: !!power || !!sky,
      },
      now.getTime(),
    ),
  )
  const resting = $derived(atRest ? tucksAfter(showsNow, false) : undefined)
  let waiting: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const wait = resting
    if (wait === undefined) return
    waiting = setTimeout(() => tuckIn('auto'), wait)
    return () => clearTimeout(waiting)
  })

  // A click elsewhere while it waits, or the one that closed its panel: what tucks itself goes sooner. Read once the
  // panel's closing has reached the wait above.
  function elsewhere() {
    flushed().then(() => {
      const wait = atRest ? tucksAfter(showsNow, true) : undefined
      if (wait === undefined) return
      clearTimeout(waiting)
      waiting = setTimeout(() => tuckIn('auto'), wait)
    })
  }

  // Rust says when a click lands elsewhere only while the island waits to tuck itself.
  $effect(() => {
    const waiting = resting !== undefined
    if (tauri) invoke('set_island_waiting', { waiting }).catch(console.error)
  })

  // The tray icon shows what the island has, and its menu's item what a click on it will do, in the island's
  // language. Each part is derived on its own, so Rust hears from it only when one of them changes.
  const trayBadge = $derived(badge(privacy, music))
  const trayTip = $derived(tip(privacy, music, keys, lang))
  const trayTuck = $derived(TRAY[lang][away() ? 'back' : 'tuck'])
  $effect(() => {
    const { pause, clear, forget, quit } = TRAY[lang]
    const tray: Tray = { badge: trayBadge, tip: trayTip, tuck: trayTuck, pause, clear, forget, quit }
    if (tauri) invoke('set_tray', { tray }).catch(console.error)
  })

  // --- Command bar ---

  // It opens from whatever the island shows, and gives that view back on Esc or when its answer is done.
  function toggleBar() {
    retuck = undefined
    if (barOpen) return closeBar()
    if (hidden || capturing) return
    if (greeting === 'playing') end()
    // A capture's result gives way to the bar at once, its bead back into the island.
    if (captureView) {
      clearTimeout(gotTimer)
      absorb()
      captureView = undefined
      spoken = ''
    }
    expanded = false
    hovered = false
    closeCard()
    clearTimeout(launchTimer)
    launch = undefined
    telling = false
    power = undefined
    sky = undefined
    asked++
    barOpen = true
    // From the line, the island comes back as the bar.
    untuck()
    if (!tauri) return
    // The list is read at startup, so this only copies it; Rust reads it again in the background when it's old.
    invoke('bar_focus', { open: true })
    invoke<{ name: string; id: string }[]>('apps_list')
      .then((list) => (apps = list.map((app) => ({ ...app, color: MONOGRAM, icon: icons[app.id] }))))
      .catch(console.error)
    invoke<boolean>('has_claude')
      .then((known) => (claudeApp = known))
      .catch(console.error)
    invoke<Battery>('battery')
      .then((read) => (battery = read))
      .catch(console.error)
  }

  // Nothing typed outlives the bar. Focus goes back to the window it came from, except when an app or a site is
  // opening: that one takes it.
  function closeBar(giveBack = true) {
    if (barOpen && tauri && giveBack) invoke('bar_focus', { open: false })
    barOpen = false
    line = ''
    if (asking || allowing || history) spoken = ''
    asking = undefined
    // Closed while it asked: a no, so the next ask says « Activer ».
    if (allowing) refused = true
    allowing = false
    history = undefined
    query = ''
  }

  // The monogram of an app whose icon hasn't come yet, as in the privacy card.
  const MONOGRAM = 'rgb(255 255 255 / 0.16)'

  // The app on the chip gets its icon from Rust, once. The monogram keeps its place until it arrives.
  $effect(() => {
    const top = options[0]
    const id = top?.kind === 'app' ? top.app.id : undefined
    if (!tauri || !id || id in icons) return
    icons[id] = null
    invoke<Listed['icon']>('app_icon', { id })
      .then((icon) => {
        icons[id] = icon
        if (icon) apps = apps.map((app) => (app.id === id ? { ...app, icon } : app))
      })
      .catch(console.error)
  })

  // The peek after Enter: what opens, or that it couldn't.
  function show(next: typeof launch, ms: number) {
    launch = next
    clearTimeout(launchTimer)
    launchTimer = setTimeout(() => (launch = undefined), ms)
  }

  // Enter: the bar folds into its answer. A timer becomes the island's timer; the time shows in the hover view for
  // 2.5 s; an app or a question shows what opens for 1.2 s, then the previous view comes back. If nothing opens, the peek says so for 2 s. The demo opens
  // nothing.
  function run(choice: Choice<Listed>) {
    if (!barOpen || (choice.kind === 'battery' && !opens(battery))) return
    if (choice.kind === 'weather') return weather(choice)
    if (choice.kind === 'clipboard') return allowing ? allow() : read().then(shows)
    // The bar folds into the capture's pill, and keeps the focus for its keys.
    if (choice.kind === 'capture') return startCapture()
    // An app or a site takes the focus; the batteries panel keeps it for the arrows.
    closeBar(choice.kind !== 'app' && choice.kind !== 'ask' && choice.kind !== 'battery')
    const t = Date.now()
    if (choice.kind === 'timer') {
      swell = true
      activities = [...activities, startTimer(choice.ms, t, choice.name)]
    } else if (choice.kind === 'add') edit(choice.id, (a) => add(a, choice.ms, t))
    else if (choice.kind === 'pause') edit(choice.id, (a) => pause(a, t))
    else if (choice.kind === 'resume') edit(choice.id, (a) => resume(a, t))
    else if (choice.kind === 'stop') dismiss(choice.id)
    else if (choice.kind === 'battery') openBatteries(true)
    else if (choice.kind === 'clock') {
      telling = true
      clearTimeout(launchTimer)
      launchTimer = setTimeout(() => (telling = false), 2500)
    } else if (choice.kind === 'app' || choice.kind === 'ask') {
      const mark = markOf(choice)
      show({ text: choice.kind === 'app' ? choice.app.name : choice.peek, ...mark }, 1200)
      if (!tauri) return
      const name = choice.kind === 'app' ? choice.app.name : ASSISTANTS[choice.to].name
      const opened =
        choice.kind === 'app'
          ? invoke<boolean>('app_launch', { id: choice.app.id })
          : invoke<boolean>('assistant_open', { target: choice.to, query: choice.question })
      opened
        .catch(() => false)
        .then((ok) => {
          if (ok || barOpen) return
          // Rust gives focus back too, but not if the call itself failed.
          invoke('bar_focus', { open: false }).catch(console.error)
          show({ text: lang === 'fr' ? `Impossible d'ouvrir ${name}` : `Couldn't open ${name}`, ...mark }, 2000)
        })
    }
  }

  // --- Weather ---

  // Each ask, so an answer that comes after a newer ask, or after the bar opened again, is dropped.
  let asked = 0
  // The page asks Open-Meteo itself: both hosts answer with `Access-Control-Allow-Origin: *`. The demo swaps in
  // recorded answers, so it never touches the network.
  let lookup = (url: string): Promise<unknown> =>
    fetch(url, { ...FETCH, signal: AbortSignal.timeout(TIMEOUT) }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
    )

  // The yes and the city kept from an earlier start. A yes or a city of this start, given meanwhile, is newer.
  if (tauri)
    invoke<Kept>('weather_kept')
      .then((kept) => {
        consented ||= kept.allowed
        here ??= kept.city ?? undefined
      })
      .catch(console.error)

  // Enter on the weather. Without a city typed or kept, it does nothing: the chip asks for one. Without a yes, Enter
  // sends nothing: the field says what Open-Meteo will get and the chip becomes the yes. Esc is no, closes the bar and
  // keeps nothing.
  function weather(choice: Extract<Choice<Listed>, { kind: 'weather' }>) {
    const city = choice.city ?? here?.name
    if (!city) return
    if (!consented && !asking) {
      asking = { ...choice, city }
      line = consent(city, lang).join('')
      spoken = line
      return
    }
    if (!consented) {
      consented = true
      if (tauri) invoke('weather_allow', { city: here ?? null }).catch(console.error)
    }
    closeBar()
    forecastFor(city, choice.day)
  }

  // The bar folds into the city while Open-Meteo answers, then into the peek, or into what went wrong.
  // shortcut: no forecast cache, add one if people spam Enter
  async function forecastFor(city: string, day: 0 | 1) {
    const mine = ++asked
    const words = WEATHER_WORDS[lang]
    const fail = (text: string) => mine === asked && show({ glyph: 'cloud', text }, WEATHER_ERROR)
    show({ glyph: 'cloud', text: chip(city, day, lang) }, 2 * TIMEOUT)
    try {
      // The kept city keeps its place: only its forecast is asked again.
      const known = here && folded(here.name) === folded(city) ? here : undefined
      const found = known ?? cityOf(await lookup(geocoding(city, lang)))
      if (mine !== asked) return
      if (!found) return fail(words.unknown)
      if (!known) {
        here = found
        if (tauri) invoke('weather_city', { city: found }).catch(console.error)
      }
      const answer = forecastOf(await lookup(forecast(found, fahrenheit(navigator.language))))
      if (mine !== asked) return
      if (!answer) return fail(words.offline)
      clearTimeout(launchTimer)
      launch = undefined
      const next = forecastPeek(found.name, day, answer, lang)
      sky = next
      spoken = next.lines.join('. ')
      clearTimeout(skyTimer)
      skyTimer = setTimeout(() => {
        sky = undefined
        spoken = ''
      }, WEATHER_PEEK)
    } catch {
      fail(words.offline)
    }
  }

  // The peek's credit opens Open-Meteo's site, from a link fixed in Rust. The demo opens nothing.
  function credit() {
    if (tauri) invoke('open_meteo').catch(console.error)
  }

  // --- Clipboard history ---

  // What Rust keeps, newest first, or null before the yes.
  const read = (): Promise<string[] | null> =>
    tauri ? invoke<string[] | null>('clipboard_history').catch(() => null) : Promise.resolve(kept)

  // Win+Alt+V opens the bar on the list, or on its yes; pressed again, it closes. A press while Rust answers counts
  // once.
  let reading = false
  async function toggleHistory() {
    if (barOpen && (history || allowing)) return closeBar()
    if (hidden || reading || capturing) return
    reading = true
    const items = await read()
    reading = false
    if (!barOpen) toggleBar()
    shows(items)
  }

  // The list, or its yes, as for the weather: the field becomes the sentence and the chip the yes. Enter is yes, Esc
  // is no. A bar closed while Rust answered stays closed.
  function shows(items: string[] | null) {
    if (!barOpen) return
    const words = CLIPBOARD_WORDS[lang]
    line = ''
    query = ''
    asking = undefined
    spoken = ''
    if (items) {
      history = items
      spoken = arrived(items.length, lang)
      look()
      return
    }
    allowing = true
    line = words.consent.join('')
    spoken = `${line} ${words.keys}`
  }

  // The yes: Rust keeps it across restarts, and the list opens on what the clipboard holds now.
  async function allow() {
    const items = tauri
      ? await invoke<string[]>('clipboard_allow').catch(() => null)
      : (kept = holding ? [holding, ...(kept ?? []).filter((t) => t !== holding)] : (kept ?? []))
    if (!barOpen || !allowing) return
    allowing = false
    spoken = ''
    if (!items) return closeBar()
    line = ''
    history = items
    spoken = arrived(items.length, lang)
    look()
  }

  // Which items name a file or a folder on this PC: Rust looks, and their rows turn into paths as it answers.
  function look() {
    if (!tauri) return void (paths = new Set(found))
    invoke<string[]>('clipboard_paths')
      .then((names) => {
        if (history) paths = new Set(names)
      })
      .catch(console.error)
  }

  // What fills the peek's mark: a colour's swatch, or the type's glyph.
  type Mark = { swatch?: string; drawing?: string }

  // Enter on an item: the bar folds into the launch peek as Rust pastes it where you were, or a form of it, or opens
  // what Tab picked. The peek shows the type's mark and says what happened, never what was pasted. A bar closed
  // during the chip's press runs nothing.
  function act(text: string, action: Action, plain: boolean) {
    if (!history) return
    const words = CLIPBOARD_WORDS[lang]
    const kind = kindOf(text, paths)
    const mark = kind === 'colour' ? { swatch: swatchOf(text) } : { drawing: GLYPHS[kind] }
    if (action === 'open' || action === 'folder' || action === 'write') {
      const said = action === 'open' ? linkParts(text).domain : action === 'folder' ? folderOf(text) : words.wrote
      return openItem(text, mark, said)
    }
    // A colour and code paste as plain text, whatever Shift says.
    plain ||= kind === 'colour' || action === 'plain'
    const said = action === 'clean' ? words.pastedClean : plain && kind !== 'colour' ? words.pastedPlain : words.pasted
    paste(text, formOf(text, action), plain, mark, said)
  }

  function paste(text: string, form: string | undefined, plain: boolean, mark: Mark, said: string) {
    const words = CLIPBOARD_WORDS[lang]
    // Rust gives the focus back itself, then pastes.
    closeBar(false)
    show({ ...mark, text: said }, 1200)
    if (!tauri) {
      kept = [text, ...(kept ?? []).filter((t) => t !== text)]
      holding = form ?? text
      return
    }
    invoke<Landed>('clipboard_paste', { text, plain, form: form ?? null })
      .catch((): Landed => {
        // Rust gives focus back too, but not if the call itself failed.
        invoke('bar_focus', { open: false }).catch(console.error)
        return 'failed'
      })
      .then((landed) => {
        if (landed === 'pasted') return
        show({ ...mark, text: landed === 'copied' ? words.copied : words.failed }, 2000)
      })
  }

  // Tab's open: what opens takes the focus, as an app from the bar does. Rust reads the item again and opens only a
  // link, an address or a folder; the peek says so if nothing opened.
  function openItem(text: string, mark: Mark, said: string) {
    closeBar(false)
    show({ ...mark, text: said }, 1200)
    if (!tauri) return
    invoke<boolean>('clipboard_open', { text })
      .catch(() => false)
      .then((opened) => {
        if (opened || barOpen) return
        invoke('bar_focus', { open: false }).catch(console.error)
        show({ ...mark, text: CLIPBOARD_WORDS[lang].unopened }, 2000)
      })
  }

  // The list never shows in a screenshot or a shared screen. The island comes back to them once the list has left,
  // unless a capture started over it: that one keeps the island out until it ends, and Rust brings it back then.
  let unhide: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    if (!tauri || !history) return
    clearTimeout(unhide)
    invoke('clipboard_hide', { hidden: true }).catch(console.error)
    return () => {
      unhide = setTimeout(() => {
        if (!capturing) invoke('clipboard_hide', { hidden: false }).catch(console.error)
      }, EXIT.duration)
    }
  })

  // --- Screen capture ---

  // Win+Alt+C, and Win+Alt+C again or Esc to cancel.
  function toggleCapture() {
    if (capturing) return captureKey('escape', true)
    if (!hidden) startCapture()
  }

  // Rust freezes the screen and the island becomes its pill, from whatever it showed or from the bar, on the peek's
  // springs or the bar's fold. The island holds the focus for Esc, the arrows and Shift, which it hands to Rust.
  async function startCapture() {
    retuck = undefined
    if (greeting === 'playing') end()
    // The bar's focus is the capture's now: neither gives it back.
    if (barOpen) closeBar(false)
    focused = false
    expanded = false
    hovered = false
    closeCard()
    clearTimeout(launchTimer)
    launch = undefined
    telling = false
    power = undefined
    sky = undefined
    clearTimeout(gotTimer)
    absorb()
    capturing = true
    taken = false
    hex = '#000000'
    textColour = false
    captureView = { name: 'capture', step: 'pick', width: wide(pickRow) }
    spoken = CAPTURE_WORDS[lang].start
    untuck()
    const captured = tauri
      ? await invoke<Captured>('capture_start', { reduced }).catch((): Captured => ({ kind: 'failed' }))
      : await new Promise<Captured>((done) => (settleCapture = done))
    settleCapture = undefined
    capturing = false
    land(captured)
  }

  // The colour under the loupe. Rust takes the keys from its first one on: a Shift held before then is handed over
  // again, so the colour it picks is the one the pill names.
  let taken = false
  function pixel(next: string) {
    if (!taken && textColour) captureKey('shift', true)
    taken = true
    hex = next
  }

  // The press became a box: the pill says what letting go does.
  function boxed() {
    if (capturing && captureView) captureView = { name: 'capture', step: 'box', width: wide(boxRow) }
  }

  // The result holds 3 s, then the island goes back to what it showed, the bead back into it. Esc goes back at once.
  async function land(captured: Captured) {
    const next = copied(captured, lang)
    if (!next) {
      captureView = undefined
      spoken = ''
      return
    }
    got = next
    await flushed()
    captureView = { name: 'capture', step: 'done', width: wide(doneRow) }
    spoken = next.spoken
    if (next.bead !== false && !instant()) {
      bead = next.bead ?? undefined
      ink()
    }
    gotTimer = setTimeout(() => {
      absorb()
      captureView = undefined
      spoken = ''
    }, CAPTURE.hold)
  }

  function steer(event: KeyboardEvent, down: boolean) {
    const key = CAPTURE_KEYS[event.key]
    if (!key || (key === 'shift' && event.repeat)) return
    event.preventDefault()
    if (key === 'shift') textColour = down
    captureKey(key, down)
  }

  function captureKey(key: CaptureKey, down: boolean) {
    if (tauri) invoke('capture_key', { key, down }).catch(console.error)
    else if (key === 'escape' && down) settleCapture?.({ kind: 'cancelled' })
  }

  // --- Battery ---

  // A battery peek shows over whatever has the island for a moment (POWER_PEEK in power.ts), never over a call, a
  // timer's end peek, the bar, an open panel or the welcome. A low battery waits for those, for fullscreen and while
  // Windows says you're busy, and brings the island back from its line; plugging in and a device connecting are
  // dropped then.
  const free = $derived(
    launched &&
      presence === 'shown' &&
      !hidden &&
      !barOpen &&
      !launch &&
      !captureView &&
      !sky &&
      !telling &&
      !expanded &&
      greeting !== 'playing' &&
      arrangement.island?.kind !== 'call' &&
      !(isTimer(arrangement.island) && arrangement.island.id === peeking),
  )

  // Tucked by hand or by itself, the island comes out for plugging in or a device connecting, and goes back as the
  // peek ends, unless you did something meanwhile. While a window is moved it stays tucked: Snap layouts has the top.
  // A low battery comes out and stays.
  let retuck: Tucker | undefined

  function notice(next: Power, heard?: Map<string, Peeked>) {
    // Plugged in, a low battery that waited is no news.
    if (next.kind === 'plugged' && pending?.kind === 'low') pending = undefined
    const tucked = tuck === 'tucking' || tuck === 'tucked'
    const landing = lands(next, free, tucked ? tucker : undefined)
    if (landing !== 'show') {
      if (landing === 'wait') pending = next
      return
    }
    // Only a device connecting or leaving that would show counts as its peek (fresh in power.ts). The demo's aren't
    // counted.
    const named = next.kind === 'device' || next.kind === 'deviceGone'
    if (named && heard && !fresh(heard, next.device.name, Date.now(), next.kind === 'deviceGone')) return
    retuck = waits(next) ? undefined : tucked ? tucker : retuck
    untuck()
    power = next
    spoken = speak(next, lang)
    clearTimeout(powerTimer)
    powerTimer = setTimeout(() => {
      power = undefined
      spoken = ''
      const by = retuck
      retuck = undefined
      if (by && tuck === 'shown' && !hidden && !pointer && !expanded && !barOpen && !card) tuckIn(by)
    }, POWER_PEEK[next.kind])
  }

  // The batteries panel opens from the bar's « batterie » and from a click on a battery peek, never from the idle
  // island. Opened from the bar, it keeps the focus for the arrows, and gives it back as it closes.
  function openBatteries(keys: boolean) {
    clearTimeout(powerTimer)
    retuck = undefined
    power = undefined
    grown = undefined
    focused = keys
    panel = 'batteries'
    expanded = true
    if (battery) spoken = readOut(items(battery, lang), lang)
    if (!tauri) return
    invoke<Battery>('battery')
      .then((read) => (battery = read))
      .catch(console.error)
    // A JBL speaker is asked for its own level, which comes on power://battery.
    invoke('battery_ask').catch(console.error)
  }

  // A click on a ring grows it to its detail; on the grown one, or Esc, it goes back. "+N" is no button.
  function pick(id: string) {
    if (!battery || id === 'more' || items(battery, lang).length < 2) return
    grown = grown === id ? undefined : id
  }

  $effect(() => {
    if (expanded) return
    untrack(() => {
      if (!panel) return
      panel = undefined
      grown = undefined
      spoken = ''
      if (focused && tauri) invoke('bar_focus', { open: false }).catch(console.error)
      focused = false
    })
  })

  $effect(() => {
    const next = free ? pending : undefined
    if (!next) return
    untrack(() => {
      pending = undefined
      notice(next)
    })
  })

  // --- Bubble swap and seek ---

  // As on the iPhone, a click on the bubble brings what it holds to the island. A call keeps its place.
  const swaps = $derived(arrangement.island?.kind !== 'call' && !barOpen && !launch && !telling)
  function swap() {
    if (beside && swaps) prefer = beside.id
  }

  // What a screen reader hears of a song, the time or a timer, which the island and the bubble show as a picture or
  // digits. In English, as the island's other names.
  const spokenOf = (a?: Activity) =>
    a?.kind === 'music'
      ? [a.title, a.artist].filter(Boolean).join(', ')
      : a?.kind === 'clock'
        ? formatTime(now)
        : a?.kind === 'timer'
          ? timerDigits(a)
          : ''

  // The bar can be dragged to a place in the song. Until the player answers, it stays where it was dropped.
  let bar = $state<HTMLElement>()
  let scrub = $state<{ id: string; ms: number; held: boolean; at: number; from: Player }>()
  const playback = $derived.by(() => {
    const p = parts.player?.player
    if (!p || scrub?.id !== p.id) return p
    return { ...p, positionMs: scrub.ms, updatedMs: scrub.at, playing: p.playing && !scrub.held }
  })

  function hold(ms: number, held: boolean) {
    const p = parts.player?.player
    if (!p) return
    const at = Date.now()
    scrub = { id: p.id, ms: Math.round(Math.min(p.endMs, Math.max(0, ms))), held, at, from: p }
    if (held) return
    tick = at
    if (tauri) invoke('media_seek', { id: p.id, ms: scrub.ms })
    const mine = scrub
    // A player that ignores the seek gets its own place back.
    setTimeout(() => scrub === mine && (scrub = undefined), 3000)
  }

  // A drag ends without a seek if the panel closes, another player or song takes it, or the bar goes.
  $effect(() => {
    const p = parts.player?.player
    untrack(() => {
      const gone = scrub?.id !== p?.id || scrub?.from.title !== p?.title || (p?.endMs ?? 0) <= 0
      if (scrub?.held && gone) scrub = undefined
    })
  })

  // Where the cursor is on the bar, in ms of the song shown.
  const under = ({ clientX }: PointerEvent) => {
    const end = parts.player?.player?.endMs
    if (!bar || !end) return 0
    const { left, width } = bar.getBoundingClientRect()
    return ((clientX - left) / width) * end
  }

  // In the panel the browser moves the progress bar on its own, and the times tick once a second while it plays.
  let played = $state<HTMLElement>()
  let tick = $state(Date.now())
  $effect(() => {
    const p = playback
    if (!played || !p || p.endMs <= 0) return
    const at = position(p, Date.now())
    const animation = played.animate([{ transform: `scaleX(${at / p.endMs})` }, { transform: 'scaleX(1)' }], {
      duration: Math.max(1, (p.endMs - at) / (p.rate > 0 ? p.rate : 1)),
      fill: 'forwards',
    })
    if (!advancing(p) || hidden) animation.pause()
    return () => {
      // Keeps the bar where it is while its content leaves, instead of snapping back to empty.
      try {
        animation.commitStyles()
      } catch {
        // The bar may already be gone.
      }
      animation.cancel()
    }
  })
  $effect(() => {
    const p = playback
    if (!p || !advancing(p) || p.endMs <= 0 || hidden) return
    let timer: ReturnType<typeof setTimeout>
    // Just past the song's next second, from where it is now: a late tick can't skip one or show one twice.
    const next = () => {
      const at = (tick = Date.now())
      timer = setTimeout(next, (1000 - (position(p, at) % 1000)) / p.rate + 1)
    }
    next()
    return () => clearTimeout(timer)
  })

  // The site's live examples run the same demo, from `npm run showcase`.
  if (import.meta.env.DEV || import.meta.env.MODE === 'showcase') {
    import('./lib/demo').then(({ demo }) =>
      demo({
        get activities() {
          return activities
        },
        set activities(next) {
          activities = next
        },
        get privacy() {
          return privacy
        },
        set privacy(next) {
          privacy = next
        },
        peek,
        hover: () => (hovered = !hovered),
        expand: () => (expanded ? (expanded = false) : open()),
        card: () => (card ? closeCard() : (card = tagged(privacy))),
        press,
        alert,
        fullscreen: () => fullscreen(!hidden),
        bar: toggleBar,
        clipboard: toggleHistory,
        capture: toggleCapture,
        captured: (captured: Captured) => settleCapture?.(captured),
        boxed,
        pixel,
        set kept(next: string[] | null) {
          kept = next
        },
        set holding(next: string) {
          holding = next
        },
        set paths(next: string[]) {
          found = next
        },
        welcome: replay,
        tuck: toggleTuck,
        swipe: (way: Direction) => tuckIn('you', way, true),
        power: notice,
        batteries: () => openBatteries(false),
        get battery() {
          return battery
        },
        set battery(next) {
          battery = next
        },
        set shortcut(next: string | undefined) {
          shortcut = next
        },
        set lookup(next: (url: string) => Promise<unknown>) {
          lookup = next
        },
        forecast: (city: string) => forecastFor(city, 0),
        get apps() {
          return apps
        },
        set apps(next) {
          apps = next
        },
        get claudeApp() {
          return claudeApp
        },
        set claudeApp(next) {
          claudeApp = next
        },
      }),
    )
  }

  const place = ({ x, y, width, height }: Rect, corners = `${radius(height)}px`) =>
    `left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:${corners}`
</script>

<svelte:window
  oncontextmenu={(event) => event.preventDefault()}
  onpointermove={(event) => {
    move(event)
    gripMove(event)
  }}
  onpointerup={gripEnd}
  onpointercancel={gripEnd}
  onresize={wake}
  onkeyup={(event) => capturing && steer(event, false)}
  onblur={() => capturing && captureKey('escape', true)}
  onkeydown={(event) => {
    if (capturing) return steer(event, true)
    if (tauri || event.key !== 'Escape') return
    if (grown) return (grown = undefined)
    expanded = false
    closeBar()
  }}
  onpointerdown={(event) => {
    if (tauri || (event.target as Element).closest('.island, .hit')) return
    // As Rust tells the app: a click elsewhere while the island waits, or one that closes it.
    elsewhere()
    expanded = false
    closeBar()
  }}
  onmousedown={(event) => {
    // A click on the chip or around the field must not take the typing away from it.
    const target = event.target as Node
    if (barOpen && island.contains(target) && !(target instanceof HTMLInputElement)) event.preventDefault()
  }}
/>

{#snippet digits(text: string)}
  {#each [...text] as char, i (i)}
    <span class="digit">
      {#key char}
        <span in:roll out:roll>{char}</span>
      {/key}
    </span>
  {/each}
{/snippet}

{#snippet icon(name: 'previous' | 'play' | 'pause' | 'next' | 'close')}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if name === 'close'}
      <path d="M6.5 6.5l11 11m0-11l-11 11" class="stroke" />
    {:else if name === 'play'}
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
    {:else if name === 'pause'}
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" /><rect x="14" y="4" width="4.5" height="16" rx="1.2" />
    {:else if name === 'previous'}
      <path
        d="M11.5 6.2v11.6a.8.8 0 0 1-1.25.66L3 13.32a.8.8 0 0 1 0-1.32l7.25-5.46a.8.8 0 0 1 1.25.66Zm10 0v11.6a.8.8 0 0 1-1.25.66L13 13.32a.8.8 0 0 1 0-1.32l7.25-5.46a.8.8 0 0 1 1.25.66Z"
      />
    {:else}
      <path
        d="M12.5 6.2v11.6a.8.8 0 0 0 1.25.66L21 13.32a.8.8 0 0 0 0-1.32l-7.25-5.46a.8.8 0 0 0-1.25.66Zm-10 0v11.6a.8.8 0 0 0 1.25.66L11 13.32a.8.8 0 0 0 0-1.32L3.75 6.54a.8.8 0 0 0-1.25.66Z"
      />
    {/if}
  </svg>
{/snippet}

{#snippet microphone(crossed: boolean)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    <path class="slash" class:on={crossed} pathLength="1" d="M4 4l16 16" />
  </svg>
{/snippet}

{#snippet dots(call: Extract<Activity, { kind: 'call' }>)}
  {#if call.mic}<span class="dot mic"></span>{/if}
  {#if call.camera}<span class="dot camera"></span>{/if}
{/snippet}

<!-- The low battery: a red battery outline filled to its level. -->
{#snippet empty(level: number)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="7" width="17.5" height="10" rx="3" /><path d="M22 10.5v3" />
    <rect class="fill" x="4" y="9" width={13.5 * Math.min(1, level / 100)} height="6" rx="1.5" />
  </svg>
{/snippet}

<!-- A device's glyph, drawn as its ring's. -->
{#snippet device(kind: Item['kind'])}
  <svg viewBox="0 0 24 24" aria-hidden="true">{@render drawing(kind)}</svg>
{/snippet}

<!-- The timer's ring, full at the start and empty at the end. -->
{#snippet dial(full: number, paused = false)}
  <svg class="dial" class:paused viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" class="rail" />
    <circle cx="8" cy="8" r="6.5" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset={1 - full} />
  </svg>
{/snippet}

<!-- A finished timer's buttons: a quiet +1 min, and OK. Their text is their name; the timer's is beside them. -->
{#snippet finish(t: Timer)}
  <button type="button" class="more" onclick={() => again(t.id)}>{said.more}</button>
  <button type="button" class="ok" onclick={() => dismiss(t.id)}>OK</button>
{/snippet}

{#snippet glyph(activity: Activity)}
  {#if activity.kind === 'clock'}
    <time class="countdown hour" datetime={now.toISOString()}>{@render digits(formatBubbleTime(now))}</time>
  {:else if activity.kind === 'call'}
    <span class="dots">{@render dots(activity)}</span>
  {:else if activity.kind === 'timer' && ended(activity, now.getTime())}
    <span class="countdown">{@render dial(1)}</span>
  {:else if activity.kind === 'timer'}
    <span class="countdown" class:paused={activity.left !== undefined}>
      {@render digits(formatCountdown(activity.left ?? activity.endsAt - now.getTime(), true))}
    </span>
  {:else if activity.art}
    <span class="art" style:background={activity.color}><img src={activity.art} alt="" /></span>
  {:else}
    <!-- A player without artwork, such as a browser, shows its equalizer. -->
    <span
      class="equalizer"
      class:still={reduced || hidden || activity.player?.playing === false}
      style:color={activity.color}
    >
      <span></span><span></span><span></span><span></span>
    </span>
  {/if}
{/snippet}

<svg class="defs" aria-hidden="true">
  <filter
    id="goo"
    filterUnits="userSpaceOnUse"
    x="0"
    y={-GOUTTE.above - 20}
    width={innerWidth.current}
    height={(innerHeight.current ?? 0) + GOUTTE.above + 20}
    color-interpolation-filters="sRGB"
  >
    <feGaussianBlur stdDeviation={sigma} />
    <!-- Alpha × 18 − 8.5 puts the edge back at half the blur, so the shapes keep their size. -->
    <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8.5" />
  </filter>
</svg>

<!-- The black shapes, under the content, so the goo never blurs the text. -->
<div class="shapes" class:goo style:--shade={geometry.shade < 1 ? geometry.shade : undefined}>
  {#if geometry.pill > 0}
    <div
      class="fill"
      style={place(geometry.fill, geometry.corners)}
      style:opacity={geometry.pill < 1 ? geometry.pill : undefined}
      style:transform={Math.abs(geometry.lean) > 0.05 ? `skewX(${-geometry.lean}deg)` : undefined}
    ></div>
  {/if}
  {#if geometry.line}
    {@const { x, y, width, height } = geometry.line}
    <div
      class="fill line"
      style="left:{x}px;top:{y}px;width:{width}px;height:{height}px"
      style:opacity={geometry.lineAlpha < 1 ? geometry.lineAlpha : undefined}
    ></div>
  {/if}
  {#if geometry.dot}
    <div class="fill" style={place(geometry.dot)}></div>
  {/if}
  {#if geometry.tag}
    <div class="fill" style={place(geometry.tag)}></div>
  {/if}
  {#if geometry.ink}
    <div class="fill" style={place(geometry.ink)}></div>
  {/if}
  {#if mark}
    <!-- Reduced motion: logo.svg standing still under the island, scaled so its pill is the island's 34 px. -->
    <svg
      class="logo"
      viewBox="212 330 600 340"
      style:left="{geometry.fill.x + geometry.fill.width / 2 - 63.75}px"
      style:top="{geometry.fill.y}px"
      out:dissolve={{ duration: 120 }}
    >
      <path
        d="M292 330H732A80 80 0 0 1 732 490H566C540 490 522.5 525.3 553.1 551A64 64 0 1 1 470.9 551C501.5 525.3 484 490 458 490H292A80 80 0 0 1 292 330Z"
      />
    </svg>
  {/if}
</div>

{#if geometry.tint}
  <!-- Over the goo, not through it: the colour a capture copied, inside the bead's rim. -->
  <div
    class="tint"
    style={place(geometry.tint)}
    style:background={geometry.tint.color}
    style:opacity={geometry.tint.alpha < 1 ? geometry.tint.alpha : undefined}
  ></div>
{/if}

{#if geometry.line && geometry.shine > 0.01}
  <!-- The line's lighter bottom row, which sets it apart from a dark title bar. -->
  <div
    class="shine"
    style="left:{geometry.hit.x}px;width:{TUCK.width}px;height:{TUCK.height}px"
    style:opacity={geometry.shine}
  ></div>
{/if}

{#if tuck === 'tucked'}
  <!-- Only the line's hit area takes the cursor: a rest, a click, a scroll down or a pull down brings it back. -->
  <button
    type="button"
    class="hit"
    aria-label={TRAY[lang].back}
    {lang}
    style="left:{geometry.hit.x}px;width:{geometry.hit.width}px;height:{geometry.hit.height}px"
    onpointerenter={() => tauri || point(true)}
    onpointerleave={() => tauri || point(false)}
    onwheel={wheelLine}
    onpointerdown={(event) => {
      if (event.button !== 0) return
      pull = event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onpointermove={(event) => pull !== undefined && event.clientY - pull >= TUCK.pull && untuck()}
    onpointerup={() => (pull = undefined)}
    onpointercancel={() => (pull = undefined)}
    onclick={untuck}
  ></button>
{/if}

<div
  class="island"
  role="group"
  bind:this={island}
  inert={away()}
  style={place(geometry.clip)}
  onwheel={wheelIsland}
  onpointerdown={(event) => {
    if (event.button === 0) press(true)
    gripStart(event)
  }}
  onpointercancel={() => press(false)}
  onpointerenter={() => tauri || point(true)}
  onpointerleave={() => (tauri ? press(false) : point(false))}
  onclickcapture={(event) => {
    // A swipe's press doesn't also click what it started on as it is released.
    if (!swiped) return
    swiped = false
    event.stopPropagation()
  }}
>
  <!-- A click anywhere opens the island; once open, the panel's own buttons take the clicks, and the opener stays for
       a screen reader to close it. Held, the opener keeps the pointer: the press shrinks it, and a release near its tip
       still clicks it. -->
  {#if !barOpen && !launch && !sky && !captureView}
    {@const done = fit?.ended && top}
    <button
      type="button"
      class="opener"
      class:behind={expanded}
      aria-label={done
        ? said.dismiss(named.get(done.id) ?? said.the)
        : ['Open', spokenOf(arrangement.island)].filter(Boolean).join(', ')}
      aria-expanded={done ? undefined : expanded}
      lang={done ? lang : undefined}
      onpointerdown={(event) => event.button === 0 && event.currentTarget.setPointerCapture(event.pointerId)}
      onclick={() => (greeting === 'playing' ? skip() : expanded ? (expanded = false) : open())}
    ></button>
  {/if}
  <!-- Laid out at the size it is headed for, and revealed by the shape as it grows. The page is in English, like the
       names of the opener, the music's controls and the tag. What the island writes is in its own language. -->
  <span
    class="content view {view.name}"
    {lang}
    class:player={!!parts.player}
    class:timer={!!parts.timer}
    class:finished={!!parts.timer && fit?.ended}
    class:done={parts.capture === 'done'}
    bind:this={content}
    style:width="{size.width}px"
    style:height="{size.height}px"
  >
    {#if parts.music}
      <span class="art" bind:this={art} style:background={parts.music.color} in:enter out:exit>
        {#if parts.music.art}
          {#key parts.music.art}
            <img src={parts.music.art} alt="" transition:dissolve={{ duration: reduced ? 0 : 160 }} />
          {/key}
        {/if}
      </span>
    {/if}
    {#if parts.player}
      <span class="meta" in:enter={{ step: 1 }} out:exit>
        <span>{parts.player.title}</span>
        <span class="muted">{parts.player.artist}</span>
      </span>
      {#if parts.player.player}
        {@const p = parts.player.player}
        {#if playback && playback.endMs > 0}
          {@const at = position(playback, tick)}
          <span class="progress muted" in:enter={{ step: 2 }} out:exit|global>
            <span>{clockTime(at)}</span>
            <span
              class="scrub"
              class:held={scrub?.held && scrub.id === playback.id}
              lang="en"
              role="slider"
              tabindex={playback.canSeek ? 0 : -1}
              aria-label="Position"
              aria-disabled={!playback.canSeek}
              aria-valuemin={0}
              aria-valuemax={Math.round(playback.endMs / 1000)}
              aria-valuenow={Math.round(at / 1000)}
              aria-valuetext={clockTime(at)}
              onpointerdown={(event) => {
                if (event.button !== 0 || !playback?.canSeek) return
                event.currentTarget.setPointerCapture(event.pointerId)
                hold(under(event), true)
              }}
              onpointermove={(event) => scrub?.held && hold(under(event), true)}
              onpointerup={(event) => scrub?.held && hold(under(event), false)}
              onpointercancel={() => scrub?.held && (scrub = undefined)}
              onkeydown={(event) => {
                const step = { ArrowLeft: -5000, ArrowRight: 5000 }[event.key]
                if (step && playback.canSeek) hold(position(playback, Date.now()) + step, false)
              }}
            >
              <span class="rail" bind:this={bar}>
                <span bind:this={played} style:background={parts.player.color}></span>
              </span>
            </span>
            <span>-{clockTime(playback.endMs - at)}</span>
          </span>
        {/if}
        <span class="controls" lang="en" in:enter={{ step: 3 }} out:exit|global>
          <button type="button" aria-label="Previous" disabled={!p.canPrevious} onclick={() => control('previous')}>
            {@render icon('previous')}
          </button>
          <button
            type="button"
            class="main"
            aria-label={p.playing ? 'Pause' : 'Play'}
            disabled={!p.canPlayPause}
            onclick={() => control(p.playing ? 'pause' : 'play')}
          >
            {@render icon(p.playing ? 'pause' : 'play')}
          </button>
          <button type="button" aria-label="Next" disabled={!p.canNext} onclick={() => control('next')}>
            {@render icon('next')}
          </button>
        </span>
      {/if}
    {/if}
    <!-- The time and the date are written in Windows' own language, which may be neither French nor English. -->
    {#if parts.date}
      <span class="muted" lang={navigator.language} in:enter out:exit>{formatShortDate(now)}</span>
    {/if}
    {#if parts.time}
      <time bind:this={clock} datetime={now.toISOString()} lang={navigator.language} in:enter out:exit>{@render digits(formatTime(now))}</time>
    {/if}
    {#if parts.panel}
      <time class="big" datetime={now.toISOString()} lang={navigator.language} in:enter out:exit>{@render digits(formatTime(now))}</time>
      <span class="muted" lang={navigator.language} in:enter={{ step: 1 }} out:exit>{formatLongDate(now)}</span>
    {/if}
    {#if parts.track}
      <span class="track" out:exit>
        <span in:enter={{ step: 1 }}>{parts.track.title}</span>
        <span class="muted" in:enter={{ step: 2 }}>{parts.track.artist}</span>
      </span>
    {/if}
    {#if parts.call}
      <span class="dots" in:enter={{ step: 1 }} out:exit>{@render dots(parts.call)}</span>
    {/if}
    {#if parts.timer}
      {@const t = parts.timer}
      {@const at = now.getTime()}
      {@const over = ended(t, at)}
      {@const paused = t.left !== undefined}
      {@const name = named.get(t.id)}
      {#if view.name === 'expanded'}
        <!-- The panel: the name, the digits and the end, then pause or resume, and cancel. -->
        {@const others = timers.filter((o) => o.id !== t.id && !ended(o, at)).length}
        <span class="timing" in:enter out:exit|global>
          <span class="muted">{name ?? said.timer}{#if others}<span class="others">+{others}</span>{/if}</span>
          <span class="big countdown" class:paused class:long={long(t, at)}>{@render digits(formatLeft(t, at))}</span>
          <span class="muted">{paused ? said.paused : said.ends(formatTime(new Date(endOf(t, at))))}</span>
        </span>
        <span class="round" in:enter={{ step: 1 }} out:exit|global>
          <button
            type="button"
            class="main"
            aria-label={(paused ? said.resume : said.pause)(name ?? said.the)}
            onclick={() => togglePause(t)}
          >
            {@render icon(paused ? 'play' : 'pause')}
          </button>
          <button
            type="button"
            aria-label={said.cancel(name ?? said.the)}
            onclick={() => {
              dismiss(t.id)
              expanded = false
            }}
          >
            {@render icon('close')}
          </button>
        </span>
      {:else}
        <span class="ring" bind:this={ring} in:enter out:exit>{@render dial(over ? 1 : fraction(t, at), paused)}</span>
        {#if view.name === 'peek'}
          <!-- The end peek: the name or "Time's up", the time since, +1 min and OK. -->
          <span class="track" out:exit>
            <span in:enter={{ step: 1 }}>{topName}</span>
            <span class="countdown" in:enter={{ step: 2 }}>{@render digits(timerDigits(t))}</span>
          </span>
          <span class="actions" in:enter={{ step: 3 }} out:exit>{@render finish(t)}</span>
        {:else}
          {#if topName && (view.name === 'hover' || over)}
            <span class="name" in:enter={{ step: 1 }} out:exit>{topName}</span>
          {/if}
          <span class="countdown" class:paused in:enter out:exit>{@render digits(timerDigits(t))}</span>
          {#if over && view.name === 'hover'}
            <span class="actions" in:enter={{ step: 2 }} out:exit>{@render finish(t)}</span>
          {/if}
        {/if}
      {/if}
    {/if}
    {#if parts.bar && history}
      <ClipboardHistory
        items={matches}
        total={history.length}
        bind:query
        {lang}
        {reduced}
        height={geometry.clip.height}
        {enter}
        {exit}
        {paths}
        onrun={act}
        onclose={() => closeBar()}
      />
    {:else if parts.bar}
      <CommandBar
        bind:line
        choices={options}
        {lang}
        {reduced}
        question={allowing ? [...CLIPBOARD_WORDS[lang].consent] : asking && consent(asking.city ?? '', lang)}
        {shortcut}
        {enter}
        {exit}
        onrun={run}
        onclose={() => closeBar()}
      />
    {/if}
    {#if parts.launch}
      <span class="mark" style:background={parts.launch.color} in:enter out:exit>
        {#if parts.launch.swatch}
          <span class="swatch" style:background={parts.launch.swatch}></span>
        {:else if parts.launch.icon}
          <canvas use:paintIcon={parts.launch.icon}></canvas>
        {:else if parts.launch.glyph}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={DRAWINGS[parts.launch.glyph]} /></svg>
        {:else if parts.launch.drawing}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={parts.launch.drawing} /></svg>
        {:else if parts.launch.letter}{parts.launch.letter}{/if}
      </span>
      <span class="launched" in:enter={{ step: 1 }} out:exit>{parts.launch.text}</span>
    {/if}
    {#if parts.weather}
      <!-- The weather asked for: its glyph, the city and the sky over the low and the high or the rain to come, and
           Open-Meteo's credit, which its licence asks for. -->
      <span class="glyph" in:enter out:exit>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={DRAWINGS[parts.weather.glyph]} /></svg>
      </span>
      <span class="track" out:exit>
        <span in:enter={{ step: 1 }}>{parts.weather.lines[0]}</span>
        <span class="muted" in:enter={{ step: 2 }}>{parts.weather.lines[1]}</span>
      </span>
      <button type="button" class="credit" in:enter={{ step: 3 }} out:exit onclick={credit}>Open-Meteo</button>
    {/if}
    <!-- One block level each: a nested block would skip its content's entrance. -->
    {#if parts.power?.kind === 'plugged'}
      {@const step = Math.ceil(BOLT / ENTER.stagger)}
      <!-- The bolt draws itself, then the level, then a small battery filled to it. -->
      <span class="bolt" style="--draw:{BOLT}ms;--wait:{ENTER.delay}ms" out:exit>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d={BOLT_PATH} /></svg>
      </span>
      <span class="level" in:enter={{ step }} out:exit>{lines(parts.power, lang)[0]}</span>
      <span class="charge" in:enter={{ step: step + 1 }} out:exit>
        <svg viewBox="0 0 25 12" aria-hidden="true">
          <rect x=".75" y=".75" width="20.5" height="10.5" rx="3.25" /><path d="M23.5 4.5v3" />
          <rect class="fill" x="2.5" y="2.5" width={17 * Math.min(1, parts.power.percent / 100)} height="7" rx="1.75" />
        </svg>
      </span>
    {:else if parts.power?.kind === 'device'}
      {@const it = { id: parts.power.device.name, ...parts.power.device }}
      <!-- What connected, its level, then its ring filling to it. Red at 20 % or less: its low warning. Without a
           level, its name instead. -->
      <span class="glyph" in:enter out:exit>{@render device(it.kind)}</span>
      <span class="level" class:named={it.percent === null} in:enter={{ step: 1 }} out:exit>{lines(parts.power, lang)[0]}</span>
      {#if it.percent !== null}
        <!-- Global: it comes and goes with the peek around it. -->
        <span
          class="gauge"
          style:width="{COMPACT.ring}px"
          style:height="{COMPACT.ring}px"
          in:enter|global={{ step: 2 }}
          out:exit|global
        >
          <Ring {it} stroke={(COMPACT.stroke * 44) / COMPACT.ring} drawn={false} wait={ENTER.delay + 2 * ENTER.stagger} {reduced} />
        </span>
      {/if}
    {:else if parts.power?.kind === 'deviceGone'}
      <!-- What left, dimmed, then a calm word. No ring: an empty one would read as a flat battery. -->
      <span class="glyph gone" in:enter out:exit>{@render device(parts.power.device.kind)}</span>
      <span class="level named muted" in:enter={{ step: 1 }} out:exit>{lines(parts.power, lang)[0]}</span>
    {:else if parts.power?.kind === 'deviceLow'}
      {@const it = { id: parts.power.device.name, ...parts.power.device }}
      {@const [first, second] = lines(parts.power, lang)}
      <span class="gauge low" in:enter out:exit><Ring {it} wait={ENTER.delay} {reduced} /></span>
      <span class="track" out:exit>
        <span in:enter={{ step: 1 }}>{first}</span>
        <span class="muted" in:enter={{ step: 2 }}>{second}</span>
      </span>
    {:else if parts.power}
      {@const [first, second] = lines(parts.power, lang)}
      <span class="cell" in:enter out:exit>{@render empty(parts.power.kind === 'low' ? parts.power.percent : 0)}</span>
      <span class="track" out:exit>
        <span in:enter={{ step: 1 }}>{first}</span>
        <span class="muted" in:enter={{ step: 2 }}>{second}</span>
      </span>
    {/if}
    {#if parts.capture === 'pick'}
      <!-- The colour under the loupe, its HEX, then the box the press can draw instead. -->
      <span class="swatch" style:background={hex} in:enter out:exit></span>
      <span class="hex" in:enter={{ step: 1 }} out:exit>{hex}</span>
      <span class="muted" in:enter={{ step: 2 }} out:exit>{CAPTURE_WORDS[lang][textColour ? 'shift' : 'drag']}</span>
    {:else if parts.capture === 'box'}
      <span class="glyph" in:enter out:exit>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={CAPTURE_GLYPHS.box} /></svg>
      </span>
      <span in:enter={{ step: 1 }} out:exit>{CAPTURE_WORDS[lang].release}</span>
    {:else if parts.capture === 'done' && got}
      <!-- What was copied. With reduced motion there is no bead: the colour shows first. Global: they come and go
           with the pill around them. -->
      {@const swatch = reduced && got.bead}
      {#if swatch}<span class="swatch" style:background={swatch} in:enter|global out:exit|global></span>{/if}
      {#each got.parts as part, i (i)}
        {@const step = 2 * i + (swatch ? 1 : 0)}
        {#if i}<span class="sep" in:enter|global={{ step: step - 1 }} out:exit|global>·</span>{/if}
        <span in:enter|global={{ step }} out:exit|global>{part}</span>
      {/each}
    {/if}
    {#if parts.batteries}
      <Batteries battery={parts.batteries} {grown} {lang} {reduced} keys={focused} {exit} onpick={pick} />
    {/if}
    {#if parts.welcome === 'hello'}
      <span class="greet" in:enter out:exit>{WORDS[lang].hello}</span>
    {:else if parts.welcome === 'keys' && keys}
      <span class="caption" in:enter out:exit>{WORDS[lang].bar}</span>
      <!-- A "+" arrives with the key after it. Global: they come and go with the row around them. -->
      {#each keys as cap, i (i)}
        {#if i}<span class="plus" in:enter|global={{ step: i + 1 }} out:exit|global>+</span>{/if}
        <span class="keycap" in:enter|global={{ step: i + 1 }} out:exit|global>{cap}</span>
      {/each}
    {/if}
    {#if parts.music}
      <span
        class="equalizer"
        class:still={reduced || hidden || parts.music.player?.playing === false}
        bind:this={eq}
        style:color={parts.music.color}
        in:enter={{ step: 1 }}
        out:exit
      >
        <span></span><span></span><span></span><span></span>
      </span>
    {/if}
  </span>
</div>

<!-- Each size of the font is readied the first time it is laid out, a stall of 30 to 40 ms. -->
<!-- This hidden copy pays it at launch instead of on the first hover and the first open. -->
<span class="island warm" aria-hidden="true">
  <span class="muted">{formatShortDate(now)}</span>
  <span class="expanded">
    <time class="big">{formatTime(now)}</time>
    <span class="muted">{formatLongDate(now)}</span>
  </span>
  <span class="bubble"><span class="countdown">0:00</span></span>
  <!-- The island's timer, at its natural width, so its shape can fit its name and digits. -->
  {#if topName}<span class="name measure" bind:clientWidth={nameWidth}>{topName}</span>{/if}
  {#if topDigits}<span class="countdown measure" bind:clientWidth={digitsWidth}>{topDigits}</span>{/if}
  <!-- The welcome's widths are read here, and the capture's pill's. -->
  <span class="greet" bind:this={greet}>{WORDS[lang].hello}</span>
  <span class="row capture" bind:this={pickRow}>
    <span class="swatch"></span><span class="hex">#000000</span><span class="muted">{CAPTURE_WORDS[lang].drag}</span>
  </span>
  <span class="row capture" bind:this={boxRow}>
    <span class="glyph"><svg viewBox="0 0 16 16"></svg></span><span>{CAPTURE_WORDS[lang].release}</span>
  </span>
  {#if got}
    <span class="row capture done" bind:this={doneRow}>
      {#if reduced && got.bead}<span class="swatch"></span>{/if}
      {#each got.parts as part, i (i)}{#if i}<span class="sep">·</span>{/if}<span>{part}</span>{/each}
    </span>
  {/if}
  {#if keys}
    <span class="row" bind:this={row}>
      <span class="caption">{WORDS[lang].bar}</span>
      {#each keys as cap, i (i)}
        {#if i}<span class="plus">+</span>{/if}
        <span class="keycap">{cap}</span>
      {/each}
    </span>
  {/if}
</span>

<!-- The welcome, read once to a screen reader with the real shortcut, then cleared, and so is a battery peek. -->
<span class="spoken" role="status" {lang}>{spoken}</span>
<!-- Its own region, mounted before the tag: an app that starts using the microphone or the camera is heard. -->
<span class="spoken" role="status">{inUse}</span>

{#if geometry.dot}
  <!-- Merging back, it slides over the island's end: a click there is the island's. -->
  <button
    type="button"
    class="island bubble"
    aria-label={swaps ? ['Show', spokenOf(beside), 'in the island'].filter(Boolean).join(' ') : spokenOf(beside)}
    aria-disabled={!swaps}
    inert={!beside}
    style={place(geometry.dot)}
    onclick={swap}
  >
    {#if beside && revealed}
      {#key beside.id}
        <span class="content" in:enter|global out:exit|global={{ shrinks: true }}>
          {@render glyph(beside)}
        </span>
      {/key}
    {/if}
  </button>
{/if}

{#if geometry.tag}
  {@const uses = light(privacy)}
  <div
    class="island tag"
    role="group"
    aria-label="Microphone and camera"
    style={place(geometry.tag)}
    onpointerenter={() => pointTag(true)}
    onpointermove={moveTag}
    onpointerleave={() => pointTag(false)}
  >
    <!-- It stays while the card is open, so a screen reader can close the card from where it opened it. -->
    <button
      type="button"
      class="opener"
      class:behind={card}
      aria-expanded={card}
      aria-label={[inUse, privacy.muted && privacy.canMute && 'microphone muted']
        .filter(Boolean)
        .join(', ')}
      onclick={() => {
        if (card) return closeCard()
        clearTimeout(tagTimer)
        // Not while the tag sinks, as a rest on it.
        card = tagged(privacy)
      }}
    ></button>
    {#if revealed && !card}
      <span class="disc" bind:clientWidth={tagContent} in:enter|global out:exit|global={{ shrinks: false }}>
        {#if privacy.muted && privacy.canMute}<span class="crossed">{@render microphone(true)}</span>{/if}
        {#if uses}<span class="dot" class:mic={uses === 'mic'} class:camera={uses === 'camera'}></span>{/if}
      </span>
    {:else if revealed}
      <PrivacyCard bind:privacy {now} {enter} {exit} onclose={closeCard} />
    {/if}
  </div>
{/if}

<style>
  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  /* Not paint-contained: the tuck's line keeps its ink above the window, and the goo must still see it there. */
  .shapes {
    position: absolute;
    inset: 0;
    pointer-events: none;
    contain: layout style;
  }

  /* --shade: how much of the shadow is left as the island tucks. */
  .fill {
    position: absolute;
    background: #000;
    box-shadow: 0 6px 18px rgb(0 0 0 / calc(0.45 * var(--shade, 1)));
  }

  /* The threshold would eat a box shadow and grow the shapes with it: the shadow comes after. */
  .goo {
    filter: url(#goo) drop-shadow(0 6px 18px rgb(0 0 0 / calc(0.45 * var(--shade, 1))));
  }

  .goo .fill,
  .fill.line {
    box-shadow: none;
  }

  /* The tuck's line: square against the edge, round underneath, as radius(4). */
  .fill.line {
    border-radius: 0 0 2px 2px;
  }

  .shine {
    position: absolute;
    top: 0;
    border-radius: 0 0 2px 2px;
    box-shadow: inset 0 -1px rgb(255 255 255 / 0.2);
    pointer-events: none;
  }

  .hit {
    position: absolute;
    top: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  .island {
    position: absolute;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: default;
    contain: layout paint style;
  }

  .warm {
    visibility: hidden;
  }

  .spoken {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .logo {
    position: absolute;
    width: 127.5px;
    height: 72.25px;
  }

  /* The welcome: the greeting, then the command bar's shortcut as flat keycaps. */
  .greet {
    font-family: 'Segoe UI Variable Display', 'Segoe UI', Inter, system-ui, sans-serif;
    font-size: 24px;
    line-height: 1;
    letter-spacing: -0.01em;
  }

  .row {
    display: inline-flex;
    align-items: center;
  }

  .caption {
    margin-right: 12px;
    color: rgb(255 255 255 / 0.6);
    font-weight: 500;
  }

  .keycap {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    min-width: 26px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    background: rgb(255 255 255 / 0.12);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
    font-size: 13px;
  }

  .plus {
    margin: 0 5px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
    font-weight: 500;
  }

  /* High contrast drops the black fill and the shadow: an outline keeps the shape. */
  /* It would also blank every fill, so the indicators keep their own colors. */
  @media (forced-colors: active) {
    .island,
    .fill.line {
      outline: 1px solid CanvasText;
    }

    .dot,
    .art,
    .equalizer,
    .launch .swatch {
      forced-color-adjust: none;
    }
  }

  .content {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .view {
    inset: 0 auto auto 50%;
    translate: -50% 0;
  }

  .hover,
  .compact,
  .peek {
    justify-content: space-between;
    padding: 0 14px;
  }

  .compact:has(.art) {
    padding: 0 12px 0 6px;
  }

  .peek {
    gap: 10px;
    padding: 0 18px 0 10px;
  }

  /* The command bar: the field from the left, the chip 8 px from the right end. */
  .view.bar {
    justify-content: space-between;
    padding: 0 8px 0 18px;
  }

  /* An app launching or a question handed off: its icon, and what opens. */
  .launch {
    justify-content: flex-start;
    gap: 8px;
    padding: 0 16px 0 8px;
  }

  .launch .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
  }

  /* A colour's own swatch, ringed so black shows. */
  .launch .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.28);
  }

  .launch .mark canvas {
    width: 100%;
    height: 100%;
  }

  .launch .mark svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The screen capture: a swatch, the HEX, the second gesture; then what was copied, centred. */
  .capture {
    justify-content: flex-start;
    gap: 8px;
    padding: 0 16px 0 10px;
  }

  .capture.done {
    justify-content: center;
    gap: 6px;
    padding: 0 18px;
  }

  .capture .muted {
    margin-left: 2px;
  }

  .capture .glyph svg {
    width: 16px;
    height: 16px;
    stroke-width: 1.5;
  }

  /* A 1.5 px ring at 28 %, so black shows on the island. It keeps its colour in a contrast theme. */
  .swatch {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.28);
    forced-color-adjust: none;
  }

  /* Never narrower, so the pill doesn't twitch as the HEX changes. */
  .hex {
    min-width: 64px;
  }

  .sep {
    color: rgb(255 255 255 / 0.6);
    font-weight: 500;
  }

  .tint {
    position: absolute;
    pointer-events: none;
  }

  /* The weather asked for: a glyph, two lines, and the credit in the bottom right corner. */
  .weather {
    justify-content: flex-start;
    gap: 12px;
    padding: 0 18px 0 16px;
  }

  .weather .glyph svg {
    width: 28px;
    height: 28px;
    stroke-width: 1.6;
  }

  .weather .track > span:first-child {
    color: #fff;
  }

  /* On the second line's baseline. */
  .credit {
    position: absolute;
    right: 18px;
    bottom: 9.5px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.5);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
  }

  /* A battery peek: plugging in and a device connecting, a glyph at the left end, the level then its drawing at the
     right; a low battery, a battery or a ring and two lines. */
  .power {
    justify-content: flex-start;
    gap: 6px;
    padding: 0 14px;
  }

  .power .level {
    margin-left: auto;
  }

  .power .named {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
  }

  .power:has(.track) {
    justify-content: flex-start;
    gap: 12px;
    padding: 0 18px 0 16px;
  }

  .bolt,
  .cell,
  .glyph,
  .charge,
  .gauge {
    display: grid;
    flex: none;
  }

  .glyph.gone svg {
    stroke: rgb(255 255 255 / 0.45);
  }

  .glyph svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .charge svg {
    width: 25px;
    height: 12px;
    fill: none;
    stroke: rgb(255 255 255 / 0.45);
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .charge .fill {
    fill: #4ade80;
    stroke: none;
  }

  .gauge.low {
    width: 32px;
    height: 32px;
  }

  .bolt svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .bolt path {
    stroke-dasharray: 1;
    animation: draw var(--draw) var(--wait) cubic-bezier(0.2, 0, 0, 1) backwards;
  }

  .cell svg {
    width: 28px;
    height: 28px;
    fill: none;
    stroke: #f87171;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .cell .fill {
    fill: #f87171;
    stroke: none;
  }

  .launched {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
  }

  .expanded {
    flex-direction: column;
    justify-content: flex-start;
    gap: 8px;
    padding-top: 24px;
  }

  .muted {
    color: rgb(255 255 255 / 0.6);
    font-size: 13px;
    font-weight: 500;
  }

  .expanded .muted {
    font-size: 15px;
  }

  .opener {
    position: absolute;
    inset: 0;
    z-index: 1;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  /* Open, it lets the mouse through to what it opened. */
  .opener.behind {
    pointer-events: none;
  }

  /* The music panel: artwork, title and equalizer, then the progress, then the controls. */
  .player {
    display: grid;
    grid-template:
      'art meta eq' auto
      'bar bar bar' auto
      'controls controls controls' auto / auto minmax(0, 1fr) auto;
    align-content: center;
    gap: 12px;
    padding: 0 20px;
  }

  .player .muted {
    font-size: 13px;
  }

  .meta {
    grid-area: meta;
    display: grid;
    gap: 2px;
    text-align: left;
  }

  .meta > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress {
    grid-area: bar;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Taller than the bar it holds, so it is easy to catch. Like on the iPhone, the bar thickens under the cursor. */
  .scrub {
    flex: 1;
    display: grid;
    align-items: center;
    height: 16px;
    outline: none;
  }

  .rail {
    height: 4px;
    border-radius: 4px;
    overflow: hidden;
    background: rgb(255 255 255 / 0.18);
    transition: height 0.15s;
  }

  .scrub[aria-disabled='false']:hover .rail,
  .scrub.held .rail,
  .scrub:focus-visible .rail {
    height: 7px;
  }

  .rail > span {
    display: block;
    height: 100%;
    transform: scaleX(0);
    transform-origin: left;
  }

  /* High contrast blanks both: the track takes the gray of disabled text, the part played the highlight colour. */
  @media (forced-colors: active) {
    .rail {
      background: GrayText;
    }

    .rail > span {
      forced-color-adjust: none;
      background: Highlight !important;
    }
  }

  .controls {
    grid-area: controls;
    display: flex;
    justify-content: center;
    gap: 36px;
  }

  .controls button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: #fff;
    cursor: default;
    transition: scale 0.15s;
  }

  .controls button:active:not(:disabled) {
    scale: 0.88;
  }

  .controls button:disabled {
    opacity: 0.35;
  }

  .controls svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .controls .main svg {
    width: 26px;
    height: 26px;
  }

  .big {
    font-family: 'Segoe UI Variable Display', 'Segoe UI', Inter, system-ui, sans-serif;
    font-size: 44px;
    line-height: 1;
  }

  /* The timer: its ring at the left end, its name, its digits at the right end, and once it ended, +1 min and OK. */
  .view.timer {
    justify-content: flex-start;
    gap: 8px;
    padding: 0 14px;
  }

  .view.timer.peek {
    gap: 12px;
    padding: 0 12px 0 16px;
  }

  /* A finished timer's buttons sit over the opener, whose click is its OK everywhere else. */
  .view.finished {
    z-index: 2;
    pointer-events: none;
  }

  .view.finished button {
    pointer-events: auto;
  }

  .ring {
    display: grid;
    flex: none;
    width: 14px;
    height: 14px;
  }

  .peek .ring {
    width: 26px;
    height: 26px;
  }

  .dial {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    rotate: -90deg;
    fill: none;
    stroke: #fbbf24;
    stroke-width: 2.2;
  }

  .dial circle:last-child {
    transition: stroke-dashoffset 0.3s;
  }

  .dial .rail {
    stroke: rgb(251 191 36 / 0.25);
  }

  /* Paused, the ring freezes at half strength with the digits. */
  .dial.paused {
    opacity: 0.5;
  }

  .bubble .dial {
    width: 14px;
    height: 14px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    color: rgb(255 255 255 / 0.6);
    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
  }

  .timer .name {
    max-width: 120px;
  }

  .finished .name,
  .peek .track > span:first-child {
    color: #fff;
  }

  .measure {
    display: inline-block;
  }

  .timer .countdown {
    margin: 0 0 0 auto;
  }

  .timer .track .countdown,
  .timing .countdown {
    margin: 0;
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .more,
  .ok {
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 13px;
    font: inherit;
    font-size: 13px;
    cursor: default;
  }

  .more {
    width: 52px;
    background: none;
    color: rgb(255 255 255 / 0.6);
  }

  .more:hover {
    color: #fff;
  }

  .ok {
    width: 38px;
    background: #fff;
    color: #000;
  }

  /* The timer's panel: the name, the digits and the end on the left, two round buttons on the right. */
  .expanded.timer {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 20px 0 24px;
  }

  .timing {
    display: grid;
    gap: 4px;
    min-width: 0;
    text-align: left;
  }

  .expanded .timing .muted {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
  }

  .timing .big {
    font-size: 40px;
  }

  /* With hours, h:mm:ss would run under the pause button at 40 px. */
  .timing .big.long {
    font-size: 30px;
  }

  .others {
    margin-left: 6px;
  }

  .round {
    display: flex;
    flex: none;
    gap: 10px;
  }

  .round button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
    color: #fff;
    cursor: default;
    transition: scale 0.15s;
  }

  .round button:active {
    scale: 0.9;
  }

  .round .main {
    background: rgb(251 191 36 / 0.2);
    color: #fbbf24;
  }

  .round svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .round .stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  @media (prefers-reduced-motion: reduce) {
    .dial circle:last-child,
    .round button,
    .controls button {
      transition: none;
    }
  }

  /* The old and the new digit share one cell while they roll. */
  .digit {
    display: inline-grid;
    white-space: pre;
  }

  .digit > span {
    grid-area: 1 / 1;
  }

  .track {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    text-align: left;
  }

  .track > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .art {
    display: grid;
    flex: none;
    width: 22px;
    height: 22px;
    overflow: hidden;
    border-radius: 6px;
  }

  /* The old and the new artwork share one cell while they cross-fade. */
  .art > img {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .player .art {
    grid-area: art;
    width: 52px;
    height: 52px;
    border-radius: 12px;
  }

  .player .equalizer {
    grid-area: eq;
    align-self: start;
    margin-top: 4px;
  }

  .peek .art {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .bubble .art {
    border-radius: 50%;
  }

  /* The privacy tag. As a disc, what it holds sits in a row from its left end. Its card is PrivacyCard.svelte. */
  .tag .disc {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 6px;
  }

  .tag .dot {
    width: 8px;
    height: 8px;
    transition: background-color 0.3s;
  }

  .tag .crossed svg {
    display: block;
    width: 12px;
    height: 12px;
  }

  .tag svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The slash draws itself across the microphone, and wipes back off. */
  .slash {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 0.28s cubic-bezier(0.2, 0, 0, 1);
  }

  .slash.on {
    stroke-dashoffset: 0;
  }

  .crossed .slash {
    animation: draw 0.32s 0.12s cubic-bezier(0.2, 0, 0, 1) backwards;
  }

  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slash,
    .tag .dot {
      transition: none;
    }

    .crossed .slash,
    .bolt path {
      animation: none;
    }
  }

  .countdown {
    margin: auto;
    color: #fbbf24;
  }

  /* Paused, the digits freeze at half strength, without a blink. */
  .countdown.paused {
    opacity: 0.5;
  }

  .bubble .countdown {
    font-size: 10px;
  }

  /* The time in the bubble is the island's time, in its white. */
  .countdown.hour {
    color: #fff;
  }

  .dots {
    display: flex;
    gap: 5px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .mic {
    background: #fb923c;
  }

  .camera {
    background: #4ade80;
  }

  .equalizer {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 14px;
  }

  .equalizer span {
    width: 3px;
    height: 100%;
    border-radius: 1.5px;
    background: currentColor;
    animation: bounce 0.9s ease-in-out infinite alternate;
  }

  .equalizer span:nth-child(2) {
    animation-delay: -0.3s;
  }

  .equalizer span:nth-child(3) {
    animation-delay: -0.6s;
  }

  .equalizer span:nth-child(4) {
    animation-delay: -0.15s;
  }

  .equalizer.still span {
    animation: none;
    transform: scaleY(0.6);
  }

  @keyframes bounce {
    from {
      transform: scaleY(0.25);
    }
    to {
      transform: scaleY(1);
    }
  }
</style>

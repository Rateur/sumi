<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { untrack } from 'svelte'
  import { prefersReducedMotion } from 'svelte/motion'
  import { MediaQuery, SvelteMap } from 'svelte/reactivity'
  import { fade as dissolve } from 'svelte/transition'
  import { innerHeight, innerWidth } from 'svelte/reactivity/window'
  import { CLOCK, arrange, peeks, type Activity, type Arrangement, type Presence } from './lib/activities'
  import {
    formatBubbleTime,
    formatCountdown,
    formatLongDate,
    formatShortDate,
    formatTime,
    msUntilNextMinute,
    msUntilNextSecond,
  } from './lib/clock'
  import { dominant } from './lib/color'
  import { ENTER, EXIT, FULLSCREEN, PRESS, bezier, motion, squash, type Axis } from './lib/motion'
  import { label, lasted, light, quiet, tagged, type Privacy } from './lib/privacy'
  import {
    BUBBLE,
    CARD,
    GAP,
    TAG,
    TAG_GAP,
    TOP,
    cardSize,
    layout,
    radius,
    resolveView,
    sizeOf,
    type Rect,
    type View,
  } from './lib/shapes'
  import {
    clockTime,
    nextChange,
    nobody,
    position,
    shown as showing,
    songs,
    update,
    type Player,
    type Players,
  } from './lib/music'
  import { Spring } from './lib/spring'

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
  let activities = $state<Activity[]>([])
  // Music comes from Rust; `prefer` is the activity picked with a click on the bubble.
  let music = $state<Activity[]>([])
  let prefer = $state<string>()
  let hovered = $state(false)
  let expanded = $state(false)
  let peeking = $state<string>()
  let hidden = $state(false)
  let presence: Presence = 'shown'
  let revealed = $state(true)
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

  let shown: Arrangement | undefined
  const arrangement = $derived.by(() => (shown = arrange([...activities, ...music], shown, prefer)))
  const view = $derived(resolveView({ activity: arrangement.island, hovered, expanded, peeking }))
  const key = $derived('activity' in view && view.activity ? `${view.name}:${view.activity.id}` : view.name)
  const size = $derived(sizeOf(view))
  const reduced = $derived(prefersReducedMotion.current)

  // What the island shows, piece by piece. A piece that stays from one view to the next moves instead of fading.
  const parts = $derived.by(() => {
    const name = revealed ? view.name : undefined
    const activity = name && 'activity' in view ? view.activity : undefined
    return {
      date: name === 'hover',
      time: name === 'idle' || name === 'hover' || activity?.kind === 'call',
      panel: name === 'expanded' && !activity,
      music: activity?.kind === 'music' ? activity : undefined,
      player: name === 'expanded' && activity?.kind === 'music' ? activity : undefined,
      track: name === 'peek' && activity?.kind === 'music' ? activity : undefined,
      call: activity?.kind === 'call' ? activity : undefined,
      timer: activity?.kind === 'timer' ? activity : undefined,
    }
  })

  // A running timer needs the seconds, in step with its end; the clock alone wakes up once a minute.
  const ends = $derived(activities.flatMap((a) => (a.kind === 'timer' ? [a.endsAt] : [])))
  $effect(() => {
    const wait = () => (ends.length ? msUntilNextSecond(Math.min(...ends), Date.now()) : msUntilNextMinute(new Date()))
    now = new Date()
    let timer = setTimeout(function tick() {
      now = new Date()
      timer = setTimeout(tick, wait())
    }, wait())
    return () => clearTimeout(timer)
  })

  // One spring per axis, so the width can lead and the height follow. `travel` slides the bubble out
  // of the island and `bubble` is its size; `tagShift`, `tagW` and `tagH` do the same for the privacy tag, which
  // also opens into a card; `drop` lifts everything off the screen in fullscreen.
  const start = untrack(() => size)
  const width = new Spring(start.width)
  const height = new Spring(start.height)
  const drop = new Spring(0)
  const travel = new Spring(0)
  const bubble = new Spring(0)
  const tagShift = new Spring(0)
  const tagW = new Spring(0)
  const tagH = new Spring(0)
  const springs = [width, height, drop, travel, bubble, tagShift, tagW, tagH]

  let goo = $state(false)
  let sigma = $state(0)
  let ramp: { from: number; to: number; start: number; end: number } | undefined
  let phase: 'none' | 'split' | 'shown' | 'merge' = 'none'
  let delayed: ReturnType<typeof setTimeout> | undefined
  let reveal = 0
  // Where the open card's left edge stays while it is open.
  let anchor: number | undefined
  let geometry = $state.raw(shape())
  let raf = 0

  /** Where everything is drawn: the shapes stretch with their speed, the content and its clip don't. */
  function shape() {
    const s = reduced ? 0 : squash(width.velocity)
    const [w, h] = [width.value * (1 + s), height.value / (1 + s)]
    const viewport = window.innerWidth
    const [fill, dot] = layout(viewport, { width: w, height: h }, bubble.value, {
      travel: travel.value,
      drop: drop.value,
    })
    const clip = { width: Math.min(w, width.value), height: Math.min(h, height.value) }
    // The privacy tag sits beside whichever edge is farther right, level with the top row. While it is smaller than
    // a disc it grows from the disc's center; past that, from its top-left corner, into the card.
    const right = dot && dot.x + dot.width > fill.x + fill.width ? dot : fill
    const [tw, th] = [tagW.value, tagH.value]
    const inset = Math.max(0, (TAG - Math.max(tw, th)) / 2)
    const beside = right.x + right.width + TAG_GAP
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
    return { fill, dot, tag: flag, clip: layout(viewport, clip, 0, { drop: drop.value })[0] }
  }

  // Frames run only while something moves: at rest there is no loop, no IPC and no filter.
  function wake() {
    raf ||= requestAnimationFrame(frame)
  }

  function frame(t: number) {
    raf = 0
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
    if (phase === 'split' && near(travel) && near(bubble)) {
      phase = 'shown'
      fade(0, 120, t)
    } else if (phase === 'merge' && near(travel) && near(bubble)) {
      phase = 'none'
      bubble.jump(0)
      pulse(120, 0, t)
      fade(0, 120, t)
    }
    if (tagPhase === 'split' && near(tagShift) && near(tagW)) {
      tagPhase = 'shown'
      fade(0, 120, t)
    } else if (tagPhase === 'merge' && near(tagShift) && near(tagW)) {
      tagPhase = 'none'
      tagW.jump(0)
      tagH.jump(0)
      fade(0, 120, t)
    }
    if (!hidden && !revealed && drop.value >= reveal) revealed = true
    geometry = shape()
    const moving = springs.some((s) => !s.resting) || !!ramp || !!delayed
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
    const target = sizeOf(to)
    // Off the screen in fullscreen, the shape takes its new size at once: nobody would see it move.
    if (reduced || (hidden && drop.resting)) {
      width.jump(target.width)
      height.jump(target.height)
      return wake()
    }
    const { width: w, height: h, delay, pulse: arrives } = motion(from, to)
    const go = () => {
      delayed = undefined
      const t = performance.now()
      drive(width, target.width, w, t)
      drive(height, target.height, h, t)
      if (arrives) pulse(0, 150, t)
      wake()
    }
    if (delay) delayed = setTimeout(go, delay)
    else go()
    wake()
  }

  /** Swells the shape for a moment without changing its size. */
  function pulse(dw: number, dh: number, t = performance.now()) {
    if (reduced) return
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

  // The bubble splits off like a drop, joined to the island by a neck until they part.
  $effect(() => {
    const has = !!arrangement.bubble
    untrack(() => (has ? split() : merge()))
  })

  function split() {
    if (phase === 'split' || phase === 'shown') return
    if (reduced || forced.current || (hidden && drop.resting)) {
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
    sigma = GOO
    travel.to(0, 0.5, 0.3, t)
    bubble.to(BUBBLE, 0.4, 0.25, t)
    wake()
  }

  function merge() {
    if (phase === 'none' || phase === 'merge') return
    if (reduced || forced.current || (hidden && drop.resting)) {
      bubble.jump(0)
      phase = 'none'
      return wake()
    }
    const t = performance.now()
    phase = 'merge'
    fade(GOO, 80, t)
    drive(travel, -TRAVEL, [0.36, 0], t)
    drive(bubble, 20, [0.36, 0], t)
  }

  // The privacy tag splits off whatever is rightmost like a drop, as the bubble does, and sinks back into it.
  let tagPhase: 'none' | 'split' | 'shown' | 'merge' = 'none'
  $effect(() => {
    const has = tagged(privacy)
    untrack(() => (has ? emerge() : retract()))
  })

  function emerge() {
    if (tagPhase === 'split' || tagPhase === 'shown') return
    const w = Math.max(TAG, tagContent)
    if (reduced || forced.current || (hidden && drop.resting)) {
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
    sigma = GOO
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
    if (reduced || forced.current || (hidden && drop.resting)) {
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

  // Pieces that stay from one view to the next move from their old box to their new one, in step
  // with the shape, so a change of mind halfway costs nothing.
  let before = new Map<Element, DOMRect>()
  let box: DOMRect | undefined
  let grows = true
  let last = untrack(() => view)
  let flips: { node: HTMLElement; dx: number; dy: number; scale: number }[] = []
  let basis = { w0: 0, w1: 0, h0: 0, h1: 0 }

  $effect.pre(() => {
    void [key, revealed]
    untrack(() => {
      if (!content) return
      const [a, b] = [sizeOf(last), size]
      grows = revealed && b.width * b.height >= a.width * a.height
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
    })
  })

  function flip() {
    if (reduced) return
    // A piece on its way out is inert and has already left the layout.
    const nodes = [clock, art, eq].filter((node): node is HTMLElement => !!node && !node.inert && before.has(node))
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
    if (reduced) return { duration: 120, css: (t: number) => `opacity:${t}` }
    if (content?.contains(node)) {
      // Scaled from the island's center, or from its top for the panel and the peek.
      const [r, c] = [node.getBoundingClientRect(), content.getBoundingClientRect()]
      const top = view.name === 'expanded' || view.name === 'peek' ? c.top : c.top + c.height / 2
      node.style.transformOrigin = `${c.left + c.width / 2 - r.left}px ${top - r.top}px`
    }
    return {
      delay: ENTER.delay + ENTER.stagger * step,
      duration: ENTER.duration,
      easing: entering,
      css: (t: number, u: number) =>
        `opacity:${t};filter:blur(${ENTER.blur * u}px);scale:${ENTER.scale + (1 - ENTER.scale) * t}`,
    }
  }

  function exit(node: HTMLElement, { shrinks = !grows } = {}) {
    if (content?.contains(node)) {
      // Out of the layout, where it was drawn, so the pieces that stay can move at once.
      const r = before.get(node) ?? node.getBoundingClientRect()
      const c = box ?? content.getBoundingClientRect()
      flips = flips.filter((f) => f.node !== node)
      Object.assign(node.style, {
        position: 'absolute',
        left: `calc(50% + ${r.left - c.left - c.width / 2}px)`,
        top: `${r.top - c.top}px`,
        width: `${node.offsetWidth}px`,
        margin: '0',
        transform: '',
      })
    }
    if (reduced) return { duration: 120, css: (t: number) => `opacity:${t}` }
    // No blur on the way out: too quick to see, and a growing blur stalls the GPU for several frames.
    const to = shrinks ? 1 - EXIT.scale : 1 + EXIT.scale
    return {
      duration: EXIT.duration,
      easing: leaving,
      css: (t: number, u: number) => `opacity:${t};scale:${1 + (to - 1) * u}`,
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

  // The Rust side lets clicks through everywhere except over these rounded rectangles, padded by a pixel.
  let sent: (Rect & { radius: number })[] = []
  function report(moving: boolean) {
    if (!tauri) return
    const rects =
      hidden && drop.resting ? [] : [geometry.fill, geometry.dot, geometry.tag].filter((r) => r !== undefined)
    const padded = rects.map(({ x, y, width, height }) => ({
      x: x - 1,
      y: y - 1,
      width: width + 2,
      height: height + 2,
      radius: radius(height) + 1,
    }))
    const sides = ['x', 'y', 'width', 'height'] as const
    const changed =
      padded.length !== sent.length ||
      padded.some((r, i) => sides.some((side) => Math.abs(r[side] - sent[i][side]) >= 0.5))
    if (!changed && moving) return
    sent = padded
    invoke('set_island_rects', { rects: padded })
  }

  // Gives under the finger at once. The panel opens on release and carries the press's speed.
  let pressed = false
  function press(down: boolean) {
    if (reduced || expanded || pressed === down) return
    pressed = down
    const [k, [duration, bounce]] = down ? [PRESS.scale, PRESS.down] : [1, PRESS.up]
    const t = performance.now()
    width.to(size.width * k, duration, bounce, t)
    height.to(size.height * k, duration, bounce, t)
    wake()
  }

  function open() {
    if (hidden) return
    pressed = false
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
      pointer = false
      rest = undefined
      expanded = false
      hovered = false
      peeking = undefined
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

  // A timer that runs out, or a new song while the island is compact, swells it for a moment. A new song in the
  // bubble swells the bubble.
  const done = $derived(arrangement.island?.kind === 'timer' && now.getTime() >= arrangement.island.endsAt)
  $effect(() => {
    if (done) untrack(alert)
  })

  const newSong = (now?: Activity, was?: Activity) =>
    now?.kind === 'music' && was?.kind === 'music' && now.id === was.id && now.title !== was.title
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
  let hoverTimer: ReturnType<typeof setTimeout>
  let pointer = false
  let rest: { x: number; y: number } | undefined
  function point(inside: boolean) {
    pointer = inside
    rest = undefined
    clearTimeout(hoverTimer)
    if (!inside) press(false)
    if (inside !== hovered) hoverTimer = setTimeout(() => (hovered = inside && !onTag), inside ? hoverTime : LEAVE)
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
      listen('island://dismiss', () => {
        expanded = false
        closeCard()
      }),
      listen<Presence>('island://presence', ({ payload }) => {
        presence = payload
        fullscreen(payload === 'hidden')
      }),
    ]
    return () => stops.forEach((stop) => stop.then((unlisten) => unlisten()))
  })

  $effect(() => {
    // Esc and a click elsewhere close the tag's card too.
    if (tauri) invoke('set_island_expanded', { expanded: expanded || card })
  })

  let peekTimer: ReturnType<typeof setTimeout>
  function peek(id: string) {
    // The activity has already changed in place: only the peek is skipped.
    if (!peeks(activities.find((a) => a.id === id), presence)) return
    peeking = id
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => (peeking = undefined), 3000)
  }

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
    if (prefer && (prefer === CLOCK.id ? !music.length : !music.some((a) => a.id === prefer))) prefer = undefined
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

  /** The artwork's main colour, read from a 16 px copy, once per picture. */
  async function tint(url: string): Promise<string | undefined> {
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const context = new OffscreenCanvas(16, 16).getContext('2d')
      context?.drawImage(image, 0, 0, 16, 16)
      return context ? dominant(context.getImageData(0, 0, 16, 16).data) : undefined
    } catch {
      return undefined
    }
  }

  $effect(() => {
    if (!tauri) return
    const stops = [
      listen<Player[]>('media://players', ({ payload }) => {
        heard = true
        latest = payload
        refresh()
      }),
      listen<{ id: string; url: string | null }>('media://artwork', ({ payload }) => paint(payload.id, payload.url)),
    ]
    // What Rust sent before these listeners existed.
    invoke<{ players: Player[]; artwork: Record<string, string> }>('media_players').then((snapshot) => {
      if (!heard) latest = snapshot.players
      Object.entries(snapshot.artwork).forEach(([id, url]) => artwork.has(id) || paint(id, url))
      refresh()
    })
    return () => {
      stops.forEach((stop) => stop.then((unlisten) => unlisten()))
      clearTimeout(change)
    }
  })

  function control(action: 'play' | 'pause' | 'next' | 'previous') {
    const id = parts.player?.id
    if (tauri && id) invoke('media_control', { id, action })
  }

  $effect(() => {
    if (!tauri) return
    let heard = false
    const stop = listen<Privacy>('privacy://state', ({ payload }) => {
      heard = true
      privacy = payload
    })
    // What Rust found before this listener existed.
    invoke<Privacy>('privacy_state').then((state) => heard || (privacy = state))
    return () => {
      stop.then((unlisten) => unlisten())
    }
  })

  // The tag fits what it holds: a disc around the dot and the crossed microphone, or the card. The card opens as
  // the island does, width first, and closes height first, without a bounce.
  let tagContent = $state(0)
  const tagSize = $derived(card ? cardSize(privacy.apps.length) : { width: Math.max(TAG, tagContent), height: TAG })
  $effect(() => {
    const { width: w, height: h } = tagSize
    untrack(() => {
      if (tagPhase !== 'split' && tagPhase !== 'shown') return
      if (w === tagW.target && h === tagH.target) return
      if (reduced || forced.current || (hidden && drop.resting)) {
        tagW.jump(w)
        tagH.jump(h)
        return wake()
      }
      const t = performance.now()
      if (h > tagH.target) {
        drive(tagW, w, [0.46, 0.26], t)
        drive(tagH, h, [0.52, 0.18], t)
      } else if (h < tagH.target) {
        drive(tagW, w, [0.4, 0], t)
        drive(tagH, h, [0.34, 0], t)
      } else drive(tagW, w, w > tagW.value ? [0.4, 0.3] : [0.3, 0], t)
      wake()
    })
  })

  // The card opens once the cursor rests on the tag, and closes a beat after it leaves, as the island's hover does.
  let tagRest: { x: number; y: number } | undefined
  function pointTag(inside: boolean) {
    onTag = inside
    tagRest = undefined
    clearTimeout(tagTimer)
    tagTimer = setTimeout(() => (card = inside && tagged(privacy)), inside ? hoverTime : LEAVE)
  }

  function moveTag({ clientX: x, clientY: y }: PointerEvent) {
    if (!onTag || card) return
    if (tagRest && Math.abs(x - tagRest.x) <= REST && Math.abs(y - tagRest.y) <= REST) return
    if (tagRest) pointTag(true)
    tagRest = { x, y }
  }

  function closeCard() {
    onTag = false
    clearTimeout(tagTimer)
    card = false
  }

  // The app's own icon, painted from the pixels Rust read.
  function paintIcon(canvas: HTMLCanvasElement, icon: { side: number; rgba: string }) {
    const draw = ({ side, rgba }: typeof icon) => {
      const bytes = Uint8ClampedArray.from(atob(rgba), (c) => c.charCodeAt(0))
      canvas.width = canvas.height = side
      canvas.getContext('2d')?.putImageData(new ImageData(bytes, side, side), 0, 0)
    }
    draw(icon)
    return { update: draw }
  }

  function mute() {
    if (tauri) invoke('privacy_mute', { muted: !privacy.muted })
    else privacy = { ...privacy, muted: !privacy.muted }
  }

  function settings() {
    if (tauri) invoke('privacy_settings', { camera: light(privacy) === 'camera' })
    closeCard()
  }

  // Windows can't turn the camera off for every app the way it mutes the microphone: the app's own window can.
  async function show(name: string) {
    closeCard()
    if (tauri && !(await invoke<boolean>('privacy_show', { name }))) settings()
  }

  // As on the iPhone, a click on the bubble brings what it holds to the island. A call keeps its place.
  function swap() {
    const picked = arrangement.bubble
    if (picked && arrangement.island?.kind !== 'call') prefer = picked.id
  }

  // The bar can be dragged to a place in the song. Until the player answers, it stays where it was dropped.
  let track = $state<HTMLElement>()
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

  // A drag ends without a seek if the panel closes, or another player or song takes it.
  $effect(() => {
    const p = parts.player?.player
    untrack(() => {
      if (scrub?.held && (scrub.id !== p?.id || scrub.from.title !== p?.title)) scrub = undefined
    })
  })

  // Where the cursor is on the bar, in ms of the song shown.
  const under = ({ clientX }: PointerEvent) => {
    const end = parts.player?.player?.endMs
    if (!track || !end) return 0
    const { left, width } = track.getBoundingClientRect()
    return ((clientX - left) / width) * end
  }

  // In the panel the browser moves the progress bar on its own, and the times tick once a second while it plays.
  let bar = $state<HTMLElement>()
  let tick = $state(Date.now())
  $effect(() => {
    const p = playback
    if (!bar || !p || p.endMs <= 0) return
    const at = position(p, Date.now())
    const animation = bar.animate([{ transform: `scaleX(${at / p.endMs})` }, { transform: 'scaleX(1)' }], {
      duration: Math.max(1, (p.endMs - at) / (p.rate > 0 ? p.rate : 1)),
      fill: 'forwards',
    })
    if (!p.playing || hidden) animation.pause()
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
    if (!p?.playing || p.endMs <= 0 || hidden) return
    tick = Date.now()
    const timer = setInterval(() => (tick = Date.now()), 1000)
    return () => clearInterval(timer)
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
        press,
        alert,
        fullscreen: () => fullscreen(!hidden),
      }),
    )
  }

  const place = ({ x, y, width, height }: Rect) =>
    `left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:${radius(height)}px`
</script>

<svelte:window
  oncontextmenu={(event) => event.preventDefault()}
  onpointermove={move}
  onresize={wake}
  onkeydown={(event) => !tauri && event.key === 'Escape' && (expanded = false)}
  onpointerdown={(event) => !tauri && !island.contains(event.target as Node) && (expanded = false)}
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

{#snippet icon(name: 'previous' | 'play' | 'pause' | 'next')}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if name === 'play'}
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

{#snippet camera()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="6.5" width="13" height="11" rx="2.5" /><path d="M16 10.5l5-3v9l-5-3" />
  </svg>
{/snippet}

{#snippet dots(call: Extract<Activity, { kind: 'call' }>)}
  {#if call.mic}<span class="dot mic"></span>{/if}
  {#if call.camera}<span class="dot camera"></span>{/if}
{/snippet}

{#snippet glyph(activity: Activity)}
  {#if activity.kind === 'clock'}
    <time class="countdown hour" datetime={now.toISOString()}>{@render digits(formatBubbleTime(now))}</time>
  {:else if activity.kind === 'call'}
    <span class="dots">{@render dots(activity)}</span>
  {:else if activity.kind === 'timer'}
    <span class="countdown">{@render digits(formatCountdown(activity.endsAt - now.getTime(), true))}</span>
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
    y="0"
    width={innerWidth.current}
    height={innerHeight.current}
    color-interpolation-filters="sRGB"
  >
    <feGaussianBlur stdDeviation={sigma} />
    <!-- Alpha × 18 − 8.5 puts the edge back at half the blur, so the shapes keep their size. -->
    <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8.5" />
  </filter>
</svg>

<!-- The black shapes, under the content, so the goo never blurs the text. -->
<div class="shapes" class:goo>
  <div class="fill" style={place(geometry.fill)}></div>
  {#if geometry.dot}
    <div class="fill" style={place(geometry.dot)}></div>
  {/if}
  {#if geometry.tag}
    <div class="fill" style={place(geometry.tag)}></div>
  {/if}
</div>

<div
  class="island"
  role="group"
  bind:this={island}
  style={place(geometry.clip)}
  onpointerdown={(event) => event.button === 0 && press(true)}
  onpointercancel={() => press(false)}
  onpointerenter={() => tauri || point(true)}
  onpointerleave={() => (tauri ? press(false) : point(false))}
>
  <!-- A click anywhere opens the island; once open, the panel's own buttons take the clicks. -->
  {#if !expanded}
    <button type="button" class="opener" aria-label="Open" aria-expanded="false" onclick={open}></button>
  {/if}
  <!-- Laid out at the size it is headed for, and revealed by the shape as it grows. -->
  <span
    class="content view {view.name}"
    class:player={!!parts.player}
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
          <span class="progress muted" in:enter={{ step: 2 }} out:exit>
            <span>{clockTime(at)}</span>
            <span
              class="scrub"
              class:held={scrub?.held && scrub.id === playback.id}
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
              <span class="bar" bind:this={track}>
                <span bind:this={bar} style:background={parts.player.color}></span>
              </span>
            </span>
            <span>-{clockTime(playback.endMs - at)}</span>
          </span>
        {/if}
        <span class="controls" in:enter={{ step: 3 }} out:exit>
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
    {#if parts.date}
      <span class="muted" in:enter out:exit>{formatShortDate(now)}</span>
    {/if}
    {#if parts.time}
      <time bind:this={clock} datetime={now.toISOString()} in:enter out:exit>{@render digits(formatTime(now))}</time>
    {/if}
    {#if parts.panel}
      <time class="big" datetime={now.toISOString()} in:enter out:exit>{@render digits(formatTime(now))}</time>
      <span class="muted" in:enter={{ step: 1 }} out:exit>{formatLongDate(now)}</span>
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
      <span class="countdown" in:enter out:exit>
        {@render digits(formatCountdown(parts.timer.endsAt - now.getTime()))}
      </span>
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
</span>

{#if geometry.dot}
  <button type="button" class="island bubble" aria-label="Show in the island" style={place(geometry.dot)} onclick={swap}>
    {#if arrangement.bubble && revealed}
      {#key arrangement.bubble.id}
        <span class="content" in:enter|global out:exit|global={{ shrinks: true }}>
          {@render glyph(arrangement.bubble)}
        </span>
      {/key}
    {/if}
  </button>
{/if}

{#if geometry.tag}
  {@const uses = light(privacy)}
  {@const many = privacy.apps.length > CARD.rows}
  {@const rows = privacy.apps.slice(0, many ? CARD.rows - 1 : CARD.rows)}
  <div
    class="island tag"
    role="group"
    aria-label="Microphone and camera"
    style={place(geometry.tag)}
    onpointerenter={() => pointTag(true)}
    onpointermove={moveTag}
    onpointerleave={() => pointTag(false)}
  >
    {#if !card}
      <button
        type="button"
        class="opener"
        aria-expanded="false"
        aria-label={[
          label(privacy) && `${label(privacy)}: ${uses === 'camera' ? 'camera' : 'microphone'} in use`,
          privacy.muted && privacy.canMute && 'microphone muted',
        ]
          .filter(Boolean)
          .join(', ')}
        onclick={() => {
          clearTimeout(tagTimer)
          card = true
        }}
      ></button>
    {/if}
    {#if revealed && !card}
      <span class="disc" bind:clientWidth={tagContent} in:enter|global out:exit|global={{ shrinks: false }}>
        {#if privacy.muted && privacy.canMute}<span class="crossed">{@render microphone(true)}</span>{/if}
        {#if uses}<span class="dot" class:mic={uses === 'mic'} class:camera={uses === 'camera'}></span>{/if}
      </span>
    {:else if revealed}
      {@const size = cardSize(privacy.apps.length)}
      <span class="card" style:width="{size.width}px" style:height="{size.height}px">
        {#each rows as app, i (app.name)}
          <button
            type="button"
            class="app"
            aria-label="Show {app.name}: {[app.mic && 'microphone', app.camera && 'camera']
              .filter(Boolean)
              .join(', ')}{lasted(app.sinceMs, now.getTime()) && `, ${lasted(app.sinceMs, now.getTime())}`}"
            onclick={() => show(app.name)}
            in:enter|global={{ step: i }}
            out:exit|global={{ shrinks: true }}
          >
            {#if app.icon}
              <canvas class="icon" use:paintIcon={app.icon} aria-hidden="true"></canvas>
            {:else}
              <span class="icon letter" aria-hidden="true">{app.name.slice(0, 1)}</span>
            {/if}
            <span class="name">{app.name}</span>
            <span class="uses">
              {#if app.mic}<span data-device="mic">{@render microphone(false)}</span>{/if}
              {#if app.camera}<span data-device="camera">{@render camera()}</span>{/if}
              <span class="hidden">{[app.mic && 'microphone', app.camera && 'camera'].filter(Boolean).join(', ')}</span>
            </span>
            <span class="muted since">{lasted(app.sinceMs, now.getTime())}</span>
          </button>
        {/each}
        {#if many}
          <span class="app muted more" in:enter|global={{ step: rows.length }} out:exit|global={{ shrinks: true }}>
            +{privacy.apps.length - rows.length}
          </span>
        {/if}
        <span class="actions" in:enter|global={{ step: rows.length + 1 }} out:exit|global={{ shrinks: true }}>
          {#if privacy.canMute && (privacy.muted || privacy.apps.some((a) => a.mic))}
            <button
              type="button"
              class:on={privacy.muted}
              aria-label="Mute the microphone"
              aria-pressed={privacy.muted}
              onclick={mute}
            >
              {@render microphone(privacy.muted)}
            </button>
          {/if}
          {#each privacy.apps.filter((a) => a.camera).slice(0, 1) as filming (filming.name)}
            <button type="button" class="filming" aria-label="Show {filming.name}" onclick={() => show(filming.name)}>
              {@render camera()}
            </button>
          {/each}
          <button type="button" class="settings" aria-label="Privacy settings" onclick={settings}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
            </svg>
          </button>
        </span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  .shapes {
    position: absolute;
    inset: 0;
    pointer-events: none;
    contain: layout paint style;
  }

  .fill {
    position: absolute;
    background: #000;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  }

  /* The threshold would eat a box shadow and grow the shapes with it: the shadow comes after. */
  .goo {
    filter: url(#goo) drop-shadow(0 6px 18px rgb(0 0 0 / 0.45));
  }

  .goo .fill {
    box-shadow: none;
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

  /* High contrast drops the black fill and the shadow: an outline keeps the shape. */
  /* It would also blank every fill, so the indicators keep their own colors. */
  @media (forced-colors: active) {
    .island {
      outline: 1px solid CanvasText;
    }

    .dot,
    .art,
    .equalizer {
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

  .bar {
    height: 4px;
    border-radius: 4px;
    overflow: hidden;
    background: rgb(255 255 255 / 0.18);
    transition: height 0.15s;
  }

  .scrub[aria-disabled='false']:hover .bar,
  .scrub.held .bar,
  .scrub:focus-visible .bar {
    height: 7px;
  }

  .bar > span {
    display: block;
    height: 100%;
    transform: scaleX(0);
    transform-origin: left;
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

  /* The privacy tag. As a disc, what it holds sits in a row from its left end; as a card, it is laid out at the
     card's size from the top-left corner, and the shape reveals it as it opens. */
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

  .card {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
  }

  .app {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 38px;
    margin: 0 -6px;
    padding: 0 6px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: default;
    transition:
      background-color 0.2s,
      scale 0.15s;
  }

  button.app:hover {
    background: rgb(255 255 255 / 0.08);
  }

  button.app:active {
    scale: 0.97;
  }

  .icon {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 6px;
  }

  .letter {
    display: grid;
    place-items: center;
    background: rgb(255 255 255 / 0.16);
    font-size: 12px;
  }

  .app .name {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  .uses {
    display: flex;
    gap: 4px;
  }

  .uses svg {
    display: block;
    width: 15px;
    height: 15px;
  }

  .uses [data-device='mic'] {
    color: #fb923c;
  }

  .uses [data-device='camera'] {
    color: #4ade80;
  }

  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .since {
    min-width: 36px;
    text-align: right;
  }

  .more {
    padding-left: 34px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    margin-top: auto;
  }

  .actions button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
    color: #fff;
    cursor: default;
    transition:
      scale 0.15s,
      background-color 0.25s,
      color 0.25s;
  }

  .actions button:active {
    scale: 0.88;
  }

  /* On, a button turns white, as Control Center's do. */
  .actions .on {
    background: #fff;
    color: #000;
  }

  /* The camera can't be cut from here: its button opens the app filming, in its color. */
  .actions .filming {
    color: #4ade80;
  }

  .actions .settings {
    margin-left: auto;
  }

  .actions svg {
    width: 17px;
    height: 17px;
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
    .tag .dot,
    .actions button {
      transition: none;
    }

    .crossed .slash {
      animation: none;
    }
  }

  .countdown {
    margin: auto;
    color: #fbbf24;
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

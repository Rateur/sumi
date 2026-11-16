<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { untrack } from 'svelte'
  import { prefersReducedMotion } from 'svelte/motion'
  import { MediaQuery } from 'svelte/reactivity'
  import { innerHeight, innerWidth } from 'svelte/reactivity/window'
  import { arrange, type Activity, type Arrangement } from './lib/activities'
  import {
    formatCountdown,
    formatLongDate,
    formatShortDate,
    formatTime,
    msUntilNextMinute,
    msUntilNextSecond,
  } from './lib/clock'
  import { ENTER, EXIT, PRESS, bezier, motion, squash, type Axis } from './lib/motion'
  import { BUBBLE, GAP, TOP, layout, radius, resolveView, sizeOf, type Rect, type View } from './lib/shapes'
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
  let island: HTMLButtonElement
  let content: HTMLElement | undefined
  let clock = $state<HTMLElement>()
  let art = $state<HTMLElement>()
  let eq = $state<HTMLElement>()
  let activities = $state<Activity[]>([])
  let hovered = $state(false)
  let expanded = $state(false)
  let peeking = $state<string>()
  let hidden = false
  let revealed = $state(true)
  let now = $state(new Date())
  // Windows' default. Rust sends the user's own each time the cursor arrives.
  let hoverTime = 400

  let shown: Arrangement | undefined
  const arrangement = $derived.by(() => (shown = arrange(activities, shown)))
  const view = $derived(resolveView({ activity: arrangement.island, hovered, expanded, peeking }))
  const key = $derived('activity' in view ? `${view.name}:${view.activity.id}` : view.name)
  const size = $derived(sizeOf(view))
  const reduced = $derived(prefersReducedMotion.current)

  // What the island shows, piece by piece. A piece that stays from one view to the next moves instead of fading.
  const parts = $derived.by(() => {
    const name = revealed ? view.name : undefined
    const activity = name && 'activity' in view ? view.activity : undefined
    return {
      date: name === 'hover',
      time: name === 'idle' || name === 'hover' || activity?.kind === 'call',
      panel: name === 'expanded',
      music: activity?.kind === 'music' ? activity : undefined,
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
  // of the island, `bubble` is its size and `drop` lifts everything off the screen in fullscreen.
  const start = untrack(() => size)
  const width = new Spring(start.width)
  const height = new Spring(start.height)
  const drop = new Spring(0)
  const travel = new Spring(0)
  const bubble = new Spring(0)
  const springs = [width, height, drop, travel, bubble]

  let goo = $state(false)
  let sigma = $state(0)
  let ramp: { from: number; to: number; start: number; end: number } | undefined
  let phase: 'none' | 'split' | 'shown' | 'merge' = 'none'
  let delayed: ReturnType<typeof setTimeout> | undefined
  let reveal = 0
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
    return { fill, dot, clip: layout(viewport, clip, 0, { drop: drop.value })[0] }
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
    if (reduced) {
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
    if (reduced || forced.current) {
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
    if (reduced || forced.current) {
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
    const rects = hidden && drop.resting ? [] : [geometry.fill, geometry.dot].filter((r) => r !== undefined)
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
    pressed = false
    expanded = true
  }

  // In fullscreen the content leaves, then the island slides up off the screen, shadow included.
  // Coming back, the content waits until the island is 60 % of the way down.
  function fullscreen(on: boolean) {
    if (on === hidden) return
    hidden = on
    revealed = !on && reduced
    const t = performance.now()
    const off = -(TOP + height.target + 24)
    if (reduced) drop.jump(on ? off : 0)
    else if (on) drop.to(off, 0.3, 0, t + 100)
    else {
      reveal = drop.value * 0.4
      drop.to(0, 0.5, 0.2, t)
    }
    wake()
  }

  // A timer that runs out, or a new song while the island is compact, swells it for a moment.
  const done = $derived(arrangement.island?.kind === 'timer' && now.getTime() >= arrangement.island.endsAt)
  $effect(() => {
    if (done) untrack(alert)
  })

  let song: Activity | undefined
  $effect(() => {
    const playing = arrangement.island
    untrack(() => {
      const was = song
      if (playing?.kind === 'music' && was?.kind === 'music' && playing.id === was.id && playing.title !== was.title) {
        if (view.name === 'compact') alert()
      }
      song = playing
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
    if (inside !== hovered) hoverTimer = setTimeout(() => (hovered = inside), inside ? hoverTime : LEAVE)
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
      }),
      listen('island://dismiss', () => (expanded = false)),
      listen<boolean>('island://fullscreen', ({ payload }) => fullscreen(payload)),
    ]
    return () => stops.forEach((stop) => stop.then((unlisten) => unlisten()))
  })

  $effect(() => {
    if (tauri) invoke('set_island_expanded', { expanded })
  })

  let peekTimer: ReturnType<typeof setTimeout>
  function peek(id: string) {
    peeking = id
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => (peeking = undefined), 3000)
  }

  if (import.meta.env.DEV) {
    import('./lib/demo').then(({ demo }) =>
      demo({
        get activities() {
          return activities
        },
        set activities(next) {
          activities = next
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

{#snippet dots(call: Extract<Activity, { kind: 'call' }>)}
  {#if call.mic}<span class="dot mic"></span>{/if}
  {#if call.camera}<span class="dot camera"></span>{/if}
{/snippet}

{#snippet glyph(activity: Activity)}
  {#if activity.kind === 'call'}
    <span class="dots">{@render dots(activity)}</span>
  {:else if activity.kind === 'timer'}
    <span class="countdown">{@render digits(formatCountdown(activity.endsAt - now.getTime(), true))}</span>
  {:else}
    <span class="art" style:background={activity.color}></span>
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
</div>

<button
  type="button"
  class="island"
  aria-expanded={expanded}
  bind:this={island}
  style={place(geometry.clip)}
  onclick={open}
  onpointerdown={(event) => event.button === 0 && press(true)}
  onpointercancel={() => press(false)}
  onpointerenter={() => tauri || point(true)}
  onpointerleave={() => (tauri ? press(false) : point(false))}
>
  <!-- Laid out at the size it is headed for, and revealed by the shape as it grows. -->
  <span
    class="content view {view.name}"
    bind:this={content}
    style:width="{size.width}px"
    style:height="{size.height}px"
  >
    {#if parts.music}
      <span class="art" bind:this={art} style:background={parts.music.color} in:enter out:exit></span>
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
        class:still={reduced}
        bind:this={eq}
        style:color={parts.music.color}
        in:enter={{ step: 1 }}
        out:exit
      >
        <span></span><span></span><span></span><span></span>
      </span>
    {/if}
  </span>
</button>

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
  <div class="island bubble" style={place(geometry.dot)}>
    {#if arrangement.bubble && revealed}
      {#key arrangement.bubble.id}
        <span class="content" in:enter|global out:exit|global={{ shrinks: true }}>
          {@render glyph(arrangement.bubble)}
        </span>
      {/key}
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
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
  }

  .peek .art {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .bubble .art {
    border-radius: 50%;
  }

  .countdown {
    margin: auto;
    color: #fbbf24;
  }

  .bubble .countdown {
    font-size: 10px;
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

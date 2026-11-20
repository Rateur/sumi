<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { TransitionConfig } from 'svelte/transition'
  import Ring from './Ring.svelte'
  import type { Lang } from './lib/intent'
  import { ENTER, EXIT, OPEN, bezier, motion, type Axis } from './lib/motion'
  import {
    ASIDE,
    FILL,
    GROWN,
    items,
    layout,
    others,
    panelSize,
    percent,
    spoken,
    type Battery,
    type Cell,
    type Item,
    type Line,
  } from './lib/power'
  import type { Size } from './lib/shapes'
  import { Spring } from './lib/spring'

  // The batteries panel's content: a ring per device, the PC first, one of them grown to its detail. Ported from the
  // lab as it was validated: one frame loop moves the rings, their levels and the detail's lines, only while they
  // move. The island's shape stays in Island.svelte, which lends its close transition.
  let {
    battery,
    grown,
    lang,
    reduced,
    keys,
    exit,
    onpick,
  }: {
    battery: Battery
    /** The ring grown to its detail. */
    grown?: string
    lang: Lang
    reduced: boolean
    /** Opened from the bar, which had the focus: the arrows walk the rings. */
    keys: boolean
    exit: (node: HTMLElement, params?: { shrinks?: boolean }) => TransitionConfig
    onpick: (id: string) => void
  } = $props()

  type Tween = { t0: number; dur: number; ease: (k: number) => number; blur: number; scale: number }
  type Place = { cx: number; cy: number; d: number; aside?: boolean; slide?: boolean }

  /** A ring on screen: what it draws, which the page renders, and how it moves, which the frame loop does. */
  class Live {
    it = $state() as Item
    more = $state<Item[]>()
    fill = $state(0)
    level = $state(false)
    click = $state(false)
    el?: HTMLElement
    label?: HTMLElement
    spring = new Spring(0)
    enters?: Tween
    leaves?: Tween
    labelIn?: Tween
    labelOut?: Tween
    /** The level shows under the ring. */
    labelOn = false
    dead = false
    from: Place
    to: Place
    /** Its first style, so it never shows unplaced. */
    style: string

    id: string

    constructor(spec: Cell) {
      this.id = spec.id
      this.it = spec.it
      this.more = spec.more
      this.from = this.to = spec
      this.style = `left:${half + spec.cx - spec.d / 2}px;top:${spec.cy - spec.d / 2}px;width:${spec.d}px;height:${spec.d}px;opacity:0`
    }
  }

  type Text = Line & { key: string; el?: HTMLElement; enters?: Tween; leaves?: Tween; dead?: boolean; left: number }

  const entering = bezier(...ENTER.easing)
  const leaving = bezier(...EXIT.easing)
  const linear = (k: number) => k
  // Progress of a change, in % as spring.ts snaps within 0.1 of its target: for the rings that ride the shape, the
  // ones that move aside, and the ones that slide to the small row once the levels are gone.
  const P = new Spring(100)
  const Q = new Spring(100)
  const X = new Spring(100)
  let lives = $state.raw<Live[]>([])
  let texts = $state.raw<Text[]>([])
  let shown: { grown?: string; size: Size } | undefined
  let half = 0
  let timers: ReturnType<typeof setTimeout>[] = []
  let raf = 0

  const later = (ms: number, then: () => void) => timers.push(setTimeout(then, ms))
  const enterAt = (t: number, delay: number, step: number) =>
    reduced ? t + 120 : t + delay + ENTER.delay + step * ENTER.stagger
  const enterTween = (t0: number): Tween =>
    reduced
      ? { t0, dur: 120, ease: linear, blur: 0, scale: 1 }
      : { t0, dur: ENTER.duration, ease: entering, blur: ENTER.blur, scale: ENTER.scale }
  const exitTween = (t0: number, grows: boolean): Tween =>
    reduced
      ? { t0, dur: 120, ease: linear, blur: 0, scale: 1 }
      : { t0, dur: EXIT.duration, ease: leaving, blur: 0, scale: 1 + (grows ? EXIT.scale : -EXIT.scale) }
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k
  const clamp = (x: number) => Math.min(1, Math.max(0, x))

  /** Opacity, blur and scale coming in, and whether it is still coming. */
  function inLook(tw: Tween | undefined, t: number): [number, number, number, boolean] {
    if (!tw) return [1, 0, 1, false]
    const k = clamp((t - tw.t0) / tw.dur)
    const e = tw.ease(k)
    return [e, tw.blur * (1 - e), lerp(tw.scale, 1, e), k < 1]
  }

  /** Opacity and scale going out, whether it is still going, and whether it is gone. */
  function outLook(tw: Tween | undefined, t: number): [number, number, boolean, boolean] {
    if (!tw) return [1, 1, false, false]
    const k = clamp((t - tw.t0) / tw.dur)
    const e = tw.ease(k)
    return [1 - e, lerp(1, tw.scale, e), k < 1, k >= 1]
  }

  function look(el: HTMLElement, opacity: number, blur: number, scale: number) {
    el.style.opacity = opacity < 1 ? opacity.toFixed(3) : ''
    el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : ''
    el.style.transform = Math.abs(scale - 1) > 1e-4 ? `scale(${scale.toFixed(4)})` : ''
  }

  // A ring that shrinks moves aside on its own spring; one that drops to the small row drops first, then slides.
  function place(c: Live, p: number, q: number, x: number): Place {
    const k = c.to.aside ? q : p
    const kx = c.to.slide ? x : k
    return { cx: lerp(c.from.cx, c.to.cx, kx), cy: lerp(c.from.cy, c.to.cy, k), d: lerp(c.from.d, c.to.d, k) }
  }

  const progress = (): [number, number, number] => [P.value / 100, Q.value / 100, X.value / 100]
  const keyOf = (l: Line) => `${l.cls}:${l.x}:${l.y}:${l.text}`

  /** The rings the keyboard walks: the grown one first, then the others left to right. */
  const rings = () =>
    lives.filter((c) => !c.dead && !c.leaves && c.click).sort((a, b) => a.to.cy - b.to.cy || a.to.cx - b.to.cx)

  /** Moves everything to the panel with `grown`, or to the row. */
  function go(grown: string | undefined) {
    const t = performance.now()
    const all = items(battery, lang)
    const size = panelSize(all, grown)
    const { cells, lines } = layout(all, grown, lang)
    const from = shown
    half = size.width / 2
    // As the island's own shape between the two (motion.ts): growing doesn't wait, shrinking waits 60 ms.
    const view = (s: Size) => ({ name: 'expanded', batteries: s }) as const
    const m = from ? motion(view(from.size), view(size)) : { delay: 0, width: OPEN.width, height: OPEN.height }
    const grows = m.delay === 0
    const ride: Axis =
      from && size.height !== from.size.height ? m.height : from && size.width !== from.size.width ? m.width : OPEN.height
    timers.forEach(clearTimeout)
    timers = []

    // Lines with the same text in the same place stay; the others leave and come in.
    const wanted = lines.map(keyOf)
    for (const l of texts) if (!l.leaves && !wanted.includes(l.key)) l.leaves = exitTween(t, grows)
    const staying = texts.filter((l) => !l.leaves).map((l) => l.key)
    const arriving = lines
      .filter((l) => !staying.includes(keyOf(l)))
      .map((l): Text => ({ ...l, key: keyOf(l), left: half + l.x, enters: enterTween(enterAt(t, m.delay, l.step)) }))
    texts = [...texts, ...arriving]

    const [p, q, x] = progress()
    // Rings that stay ride the shape to their new place; with reduced motion they crossfade like the rest. From one
    // grown ring to another, the two would cross: they leave and come in as content does.
    const switched = grown && from?.grown && grown !== from.grown ? [grown, from.grown] : []
    const keep = reduced ? [] : cells.map((c) => c.id).filter((id) => !switched.includes(id))
    const current = lives.filter((c) => !c.leaves)
    for (const c of current) {
      if (keep.includes(c.id)) continue
      c.from = c.to = place(c, p, q, x)
      c.leaves = exitTween(t, grows)
      if (c.labelOn) {
        c.labelOn = false
        c.labelOut = exitTween(t, grows)
      }
    }
    const added: Live[] = []
    for (const spec of cells) {
      const level = spec.more ? 0 : spec.it.percent
      const labelAt = enterAt(t, m.delay, spec.step + 1)
      const c = current.find((o) => o.id === spec.id && keep.includes(o.id))
      if (c) {
        c.from = place(c, p, q, x)
        const shrinks = spec.d < c.from.d - 0.5
        c.to = { ...spec, aside: shrinks, slide: shrinks && spec.cy - c.from.cy > 20 }
        c.it = spec.it
        c.more = spec.more
        if (spec.label && !c.labelOn) {
          c.labelOn = c.level = true
          c.labelIn = enterTween(labelAt)
          c.labelOut = undefined
        }
        if (!spec.label && c.labelOn) {
          c.labelOn = false
          // On the click that grows a ring, the levels leave at once, opacity only, before any ring moves under them.
          c.labelOut =
            grown && !reduced ? { t0: t, dur: GROWN.fade, ease: leaving, blur: 0, scale: 1 } : exitTween(t, grows)
        }
        if (Math.abs(c.spring.target - level) > 0.01) c.spring.to(level, ...FILL, t)
        continue
      }
      const fresh = new Live(spec)
      const start = enterAt(t, m.delay, spec.step)
      fresh.enters = enterTween(start)
      if (spec.label) {
        fresh.labelOn = fresh.level = true
        fresh.labelIn = enterTween(labelAt)
      }
      if (reduced || spec.more) fresh.spring.jump(level)
      else later(start - t, () => (fresh.spring.to(level, ...FILL, performance.now()), wake()))
      added.push(fresh)
    }
    lives = [...lives, ...added]

    const begin = () => {
      const now = performance.now()
      if (reduced) {
        for (const s of [P, Q, X]) s.jump(100)
        return wake()
      }
      P.jump(0)
      P.to(100, ...ride, now)
      Q.jump(0)
      Q.to(100, ...ASIDE, now)
      X.jump(0)
      const slides = lives.some((c) => !c.leaves && c.to.slide)
      if (slides) later(GROWN.slide, () => (X.to(100, ...ride, performance.now()), wake()))
      else X.jump(100)
      wake()
    }
    if (reduced || m.delay) {
      for (const s of [P, Q, X]) s.jump(0)
      later(reduced ? 120 : m.delay, begin)
    } else begin()

    const interactive = all.length > 1
    for (const c of lives) if (!c.more && !c.leaves) c.click = interactive
    shown = { grown, size }
    // From the bar, the keyboard stays in the panel: on the ring it was on, or the one that took its place.
    if (keys && interactive) {
      const on = grown ?? from?.grown
      tick().then(() => (rings().find((c) => c.id === on) ?? rings()[0])?.el?.focus({ preventScroll: true }))
    }
    wake()
  }

  function wake() {
    raf ||= requestAnimationFrame(frame)
  }

  function frame() {
    raf = 0
    const t = performance.now()
    let busy = false
    for (const s of [P, Q, X]) if (s.update(t)) busy = true
    for (const l of texts) {
      const [o1, b, s1, a1] = inLook(l.enters, t)
      const [o2, s2, a2, done] = outLook(l.leaves, t)
      l.dead = done
      busy ||= a1 || a2
      if (l.el && !done) look(l.el, o1 * o2, b, s1 * s2)
    }
    const [p, q, x] = progress()
    for (const c of lives) {
      if (c.spring.update(t)) busy = true
      c.fill = c.spring.value
      const g = place(c, p, q, x)
      const [o1, b, s1, a1] = inLook(c.enters, t)
      const [o2, s2, a2, done] = outLook(c.leaves, t)
      c.dead = done
      busy ||= a1 || a2
      if (done || !c.el) continue
      Object.assign(c.el.style, {
        left: `${half + g.cx - g.d / 2}px`,
        top: `${g.cy - g.d / 2}px`,
        width: `${g.d}px`,
        height: `${g.d}px`,
      })
      look(c.el, o1 * o2, b, s1 * s2)
      // The level under the ring: in while the row has it, out as the ring leaves the row.
      const [lo1, lb, ls1, la1] = c.labelOn ? inLook(c.labelIn, t) : [1, 0, 1, false]
      const [lo2, ls2, la2, gone] = c.labelOn ? [1, 1, false, false] : outLook(c.labelOut, t)
      busy ||= la1 || la2
      c.level = c.labelOn || (!!c.labelOut && !gone)
      if (!c.level || !c.label) continue
      const w = c.label.offsetWidth
      const top = g.cy + g.d / 2 + 6
      Object.assign(c.label.style, {
        left: `${half + g.cx - w / 2}px`,
        top: `${top}px`,
        transformOrigin: `${w / 2 - g.cx}px ${-top}px`,
      })
      look(c.label, lo1 * lo2, lb, ls1 * ls2)
    }
    if (lives.some((c) => c.dead)) lives = lives.filter((c) => !c.dead)
    if (texts.some((l) => l.dead)) texts = texts.filter((l) => !l.dead)
    if (busy) wake()
  }

  // The props are read through the island's view, which changes as the cursor rests on it: only a new battery, ring
  // or language moves anything.
  let last: unknown[] = []
  $effect(() => {
    const next = [battery, grown, lang]
    if (next.every((v, i) => v === last[i])) return
    last = next
    untrack(() => go(grown))
  })

  $effect(() => () => {
    cancelAnimationFrame(raf)
    timers.forEach(clearTimeout)
  })

  function walk(event: KeyboardEvent) {
    const all = rings()
    const i = all.findIndex((c) => c.el === document.activeElement)
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[event.key]
    if (i < 0 || j === undefined) return
    event.preventDefault()
    all[Math.min(all.length - 1, Math.max(0, j))].el?.focus({ preventScroll: true })
  }
</script>

<!-- Rings, levels and lines are placed by the frame loop above, from a first style that keeps them out of sight until
     then. The arrows walk the rings, as in a toolbar. The whole panel leaves at once as it closes. -->
<span class="batteries" role="toolbar" tabindex="-1" aria-label="Batteries" onkeydown={walk} out:exit>
  {#each lives as c (c)}
    {#if c.more}
      <span class="cell" role="img" aria-label={others(c.more, lang)} style={c.style} bind:this={c.el}>
        <Ring it={c.it} more={c.more.length} fill={0} />
      </span>
    {:else}
      <button
        type="button"
        class="cell"
        class:click={c.click}
        tabindex={c.click ? 0 : -1}
        aria-label={spoken(c.it, lang)}
        style={c.style}
        bind:this={c.el}
        onclick={() => c.click && onpick(c.id)}
      >
        <Ring it={c.it} fill={c.fill} />
      </button>
      {#if c.level}
        <span class="level" style="opacity:0" bind:this={c.label}>{percent(c.it.percent)}</span>
      {/if}
    {/if}
  {/each}
  {#each texts as l (l)}
    <span
      class="line {l.cls}"
      style="left:{l.left}px;top:{l.y}px;opacity:0;transform-origin:{-l.x}px {-l.y}px"
      style:max-width={l.max ? `${l.max}px` : undefined}
      bind:this={l.el}>{l.text}</span
    >
  {/each}
</span>

<style>
  .batteries {
    position: absolute;
    inset: 0;
    transform-origin: 50% 0;
    outline: none;
  }

  .cell {
    position: absolute;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
    pointer-events: none;
  }

  .cell.click {
    pointer-events: auto;
  }

  .cell:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
  }

  .level,
  .line {
    position: absolute;
    white-space: nowrap;
  }

  .level {
    font-size: 13px;
  }

  /* A line's vertical centre is its place; the detail's lines can be cut by an ellipsis. */
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    translate: 0 -50%;
  }

  .muted {
    color: rgb(255 255 255 / 0.6);
    font-size: 13px;
    font-weight: 500;
  }

  .big {
    font-family: 'Segoe UI Variable Display', 'Segoe UI', Inter, system-ui, sans-serif;
    font-size: 40px;
    line-height: 1;
  }
</style>

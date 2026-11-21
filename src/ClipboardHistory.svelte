<script lang="ts">
  import { untrack } from 'svelte'
  import type { TransitionConfig } from 'svelte/transition'
  import { CLIPBOARD_WORDS, GLYPHS, count, preview, quiet } from './lib/clipboard'
  import type { Lang } from './lib/intent'
  import { ENTER, EXIT, FILTER_IN, HL, bezier } from './lib/motion'
  import { LIST } from './lib/shapes'
  import { Spring } from './lib/spring'

  // The clipboard history's list, under the bar's own row: the field and the count, the rows, the ink highlight and
  // the chip that rides it. The shape stays in Island.svelte, which lends its content transitions and the height it
  // draws, so rows clip under its moving edge. These springs run here, only while they move.
  let {
    items,
    total,
    query = $bindable(),
    lang,
    reduced,
    height,
    enter,
    exit,
    onpaste,
    onclose,
  }: {
    /** What the filter keeps, newest first. */
    items: readonly string[]
    total: number
    query: string
    lang: Lang
    reduced: boolean
    height: number
    enter: (node: HTMLElement, params?: { step?: number }) => TransitionConfig
    exit: (node: HTMLElement, params?: { shrinks?: boolean }) => TransitionConfig
    onpaste: (text: string, plain: boolean) => void
    onclose: () => void
  } = $props()

  const words = $derived(CLIPBOARD_WORDS[lang])
  const line = $derived(quiet(items.length, total, query, lang))
  const entering = bezier(...ENTER.easing)
  const leaving = bezier(...EXIT.easing)

  // The highlight's two edges, the scroll, the chip's width, its label's 4 px slide and its press, in percent, and
  // each row's place.
  const top = new Spring(0)
  const bottom = new Spring(LIST.row)
  const scroll = new Spring(0)
  const width = new Spring(0)
  const slide = new Spring(0)
  const press = new Spring(100)
  // Keyed by the item's text, which is unique. Plain records: not reactive, and with no prototype, so any text is a
  // key.
  const places: Record<string, Spring> = Object.create(null)
  const springs = () => [top, bottom, scroll, width, slide, press, ...Object.values(places)]
  let drawn = $state.raw({
    top: 0,
    bottom: LIST.row as number,
    scroll: 0,
    width: 0,
    slide: 0,
    press: 100,
    moving: false,
  })
  let at = $state.raw(new Map<string, number>())
  let raf = 0

  function wake() {
    raf ||= requestAnimationFrame(frame)
  }

  function frame() {
    raf = 0
    const t = performance.now()
    const all = springs()
    all.forEach((s) => s.update(t))
    drawn = {
      top: top.value,
      bottom: bottom.value,
      scroll: scroll.value,
      width: width.value,
      slide: slide.value,
      press: press.value,
      moving: !width.resting,
    }
    at = new Map(Object.entries(places).map(([text, s]) => [text, s.value]))
    if (all.some((s) => !s.resting)) raf = requestAnimationFrame(frame)
  }
  $effect(() => () => cancelAnimationFrame(raf))

  untrack(() => items.forEach((text, i) => (places[text] = new Spring(i * LIST.row))))

  // The row the highlight is on, the way it last moved, and Shift held, which turns Enter into a plain paste.
  let sel = $state(0)
  let way = 0
  let shift = $state(false)
  const label = $derived(shift ? words.actions.plain : words.actions.paste)
  // Empty as it arrives, since a live region that comes in filled isn't read. Island.svelte's says the opening.
  let heard = $state('')

  // Opening, rows pour down with the rest of the list. Once it is open, a row the filter brings in comes in where it
  // lands, a few at a time, in the order `arrivals` gives, and one it takes away leaves where it is.
  let opening = true
  let arrivals: Record<string, number> = Object.create(null)

  function row(
    node: HTMLElement,
    { i, text }: { i: number; text: string },
    { direction }: { direction: 'in' | 'out' | 'both' },
  ): TransitionConfig {
    if (reduced) return { duration: 120, css: (t) => `opacity:${t}` }
    if (direction === 'out') {
      // From its own middle, not from the point the opening poured it down from.
      node.style.transformOrigin = ''
      return { duration: EXIT.duration, easing: leaving, css: (t, u) => `opacity:${t};scale:${1 - EXIT.scale * u}` }
    }
    if (opening) return i < LIST.rows ? enter(node, { step: 2 + i }) : {}
    // The filter scrolls back to the top, so a row it brings in past the fifth lands out of sight.
    if (i >= LIST.rows) return {}
    return {
      delay: ENTER.delay + ENTER.stagger * Math.min(arrivals[text] ?? 0, 3),
      duration: ENTER.duration,
      easing: entering,
      css: (t, u) => `opacity:${t};filter:blur(${ENTER.blur * u}px);scale:${FILTER_IN + (1 - FILTER_IN) * t}`,
    }
  }

  // A row that stays but leaves the five in sight fades where it was, then takes its place out of sight; one that
  // comes into sight takes its place, then fades in. Neither travels across the list.
  const nodes: Record<string, HTMLElement> = Object.create(null)
  function track(node: HTMLElement, text: string) {
    nodes[text] = node
    return {
      destroy: () => {
        if (nodes[text] === node) delete nodes[text]
      },
    }
  }

  function fadeIn(node: HTMLElement | undefined, k: number) {
    if (!node) return
    if (reduced) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'backwards' })
      return
    }
    node.style.transformOrigin = ''
    node.animate(
      [
        { opacity: 0, filter: `blur(${ENTER.blur}px)`, scale: FILTER_IN },
        { opacity: 1, filter: 'blur(0px)', scale: 1 },
      ],
      {
        delay: ENTER.delay + ENTER.stagger * Math.min(k, 3),
        duration: ENTER.duration,
        easing: `cubic-bezier(${ENTER.easing.join(', ')})`,
        fill: 'backwards',
      },
    )
  }

  function fadeOut(node: HTMLElement | undefined, then: () => void) {
    if (!node) return then()
    const keyframes = [
      { opacity: 1, scale: 1 },
      { opacity: 0, scale: reduced ? 1 : 1 - EXIT.scale },
    ]
    const easing = `cubic-bezier(${EXIT.easing.join(', ')})`
    node.style.transformOrigin = ''
    const fade = node.animate(keyframes, { duration: reduced ? 120 : EXIT.duration, easing, fill: 'forwards' })
    fade.onfinish = () => {
      then()
      wake()
      fade.cancel()
    }
  }

  const to = (s: Spring, y: number, t: number) => (reduced ? s.jump(y) : s.to(y, 0.3, 0, t))

  // Typing filters: the selection goes back to the first row and the scroll to the top. Rows still in sight move up
  // 60 ms after a shrink starts, as the content leaves first. A fade's jump or a late move from an older filter is
  // dropped, so the newest decides where each row ends up.
  let shown = untrack(() => items)
  let filters = 0
  $effect.pre(() => {
    const next = items
    untrack(() => {
      if (next === shown) return
      const mine = ++filters
      const latest = () => mine === filters
      opening = false
      arrivals = Object.create(null)
      const t = performance.now()
      const scrolled = scroll.target
      const seen = (y: number) => y - scrolled > -LIST.row + 1 && y - scrolled < LIST.rows * LIST.row - 1
      const lag = !reduced && next.length < shown.length ? 60 : 0
      let k = 0
      next.forEach((text, i) => {
        const y = i * LIST.row
        const place = places[text]
        if (!place) {
          places[text] = new Spring(y)
          arrivals[text] = k++
          return
        }
        const [was, is] = [seen(place.target), i < LIST.rows]
        if (reduced || (!was && !is)) place.jump(y)
        else if (was && is) {
          if (place.target !== y)
            setTimeout(() => {
              if (!latest()) return
              to(place, y, performance.now())
              wake()
            }, lag)
        } else if (was) fadeOut(nodes[text], () => latest() && place.jump(y))
        else {
          place.jump(y)
          fadeIn(nodes[text], k++)
        }
      })
      arrivals[''] = k
      const kept = new Set(next)
      for (const text of Object.keys(places)) if (!kept.has(text)) delete places[text]
      shown = next
      sel = 0
      way = 0
      to(top, 0, t)
      to(bottom, LIST.row, t)
      to(scroll, 0, t)
      heard = count(next.length, total, query, lang)
      wake()
    })
  })

  // ↑ and ↓: the edge in the direction of travel leads and the other trails, so the highlight stretches from row to
  // row and gathers. Past the fifth row, the list scrolls by whole rows.
  function select(i: number) {
    if (!items.length) return
    i = Math.max(0, Math.min(items.length - 1, i))
    if (i === sel) return
    const t = performance.now()
    way = Math.sign(i - sel)
    sel = i
    const y = i * LIST.row
    if (reduced) {
      top.jump(y)
      bottom.jump(y + LIST.row)
    } else {
      const [a, b] = way > 0 ? [HL.trail, HL.lead] : [HL.lead, HL.trail]
      top.to(y, ...a, t)
      bottom.to(y + LIST.row, ...b, t)
    }
    const first = Math.round(scroll.target / LIST.row)
    if (i < first) to(scroll, y, t)
    else if (i >= first + LIST.rows) to(scroll, (i - LIST.rows + 1) * LIST.row, t)
    heard = `${preview(items[i])}. ${label}.`
    wake()
  }

  // The chip springs its width to its label, and shrinks away when no row is left. offsetWidth rounds: one more pixel
  // keeps a label with a fraction of a pixel from its ellipsis.
  let natural = $state(0)
  const chip = $derived(items.length ? natural + 1 : 0)
  $effect(() => {
    const target = chip
    untrack(() => {
      if (target === width.target) return
      if (reduced) width.jump(target)
      else {
        const grows = target > width.value
        if (!grows && width.velocity < 0) width.jump(width.value)
        width.to(target, grows ? 0.4 : 0.32, grows ? 0.15 : 0, performance.now())
      }
      wake()
    })
  })

  // Shift's label slides in 4 px from below, and out the way it came.
  let said = untrack(() => label)
  $effect(() => {
    const next = label
    untrack(() => {
      if (next !== said && !reduced) {
        slide.jump(shift ? 4 : -4)
        slide.to(0, 0.3, 0, performance.now())
        wake()
      }
      said = next
    })
  })

  // Enter: the chip gives under the key, then the bar folds into the peek and the item lands where you were.
  let running = false
  function run(plain: boolean) {
    const text = items[sel]
    if (text === undefined || running) return
    running = true
    if (!reduced) {
      const t = performance.now()
      press.to(100, 0.3, 0.3, t)
      press.kick(-80, t)
      wake()
    }
    setTimeout(() => onpaste(text, plain), reduced ? 0 : 110)
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Shift') shift = true
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      select(sel + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Tab') event.preventDefault()
    else if (event.key === 'Enter') {
      event.preventDefault()
      run(event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
    }
  }

  // The chip rides the leading edge, so it lands on the new row first and the ink follows it.
  const tall = $derived(drawn.bottom - drawn.top)
  const middle = $derived(
    way > 0 ? drawn.bottom - LIST.row / 2 : way < 0 ? drawn.top + LIST.row / 2 : (drawn.top + drawn.bottom) / 2,
  )

  // In a frame on the site, the field mustn't take the page's focus.
  const focus = (node: HTMLInputElement) => {
    if (window === parent) node.focus()
  }
</script>

<div class="history" out:exit|global>
  <input
    class="field"
    type="text"
    bind:value={query}
    placeholder={words.search}
    aria-label={words.search}
    spellcheck="false"
    autocomplete="off"
    use:focus
    onkeydown={keydown}
    onkeyup={(event) => event.key === 'Shift' && (shift = false)}
    onblur={() => (shift = false)}
    in:enter|global
  />
  <span class="count" in:enter|global={{ step: 1 }}>{count(items.length, total, query, lang)}</span>
  <div class="list" style:height="{Math.max(0, height - LIST.field - LIST.inset)}px">
    <div
      class="highlight"
      class:gone={!items.length}
      style:top="{drawn.top - drawn.scroll}px"
      style:height="{tall}px"
      style:border-radius="{Math.min(tall / 2, HL.r)}px"
      in:enter|global={{ step: 2 }}
    ></div>
    {#each items as text, i (text)}
      <div
        class="row"
        style:top="{(at.get(text) ?? i * LIST.row) - drawn.scroll}px"
        use:track={text}
        in:row|global={{ i, text }}
        out:row={{ i, text }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={GLYPHS.text} /></svg>
        <!-- The selected row leaves room for the chip. -->
        <span class="line" style:right="{i === sel ? 18 + chip : 20}px">{preview(text)}</span>
      </div>
    {/each}
    {#if line}
      <div class="quiet" style:top="{items.length * LIST.row}px" in:row|global={{ i: 1, text: '' }} out:row={{ i: 1, text: '' }}>
        {line}
      </div>
    {/if}
    <span
      class="chip"
      style:left="{468 - drawn.width}px"
      style:top="{middle - 14 - drawn.scroll}px"
      style:width="{drawn.width}px"
      style:scale={drawn.press / 100}
      style:visibility={drawn.width < 1.5 ? 'hidden' : undefined}
      in:enter|global={{ step: 3 }}
    >
      <span class="face" class:moving={drawn.moving}>
        <span class="label" style:translate="0 {drawn.slide}px">{label}</span>
        <span class="enter">↵</span>
      </span>
      <span class="face ghost" aria-hidden="true" bind:offsetWidth={natural}>
        <span class="label">{label}</span>
        <span class="enter">↵</span>
      </span>
    </span>
  </div>
  <span class="spoken" role="status">{heard}</span>
</div>

<style>
  /* Laid out from the bar's own row: rows of 40 px under it, 6 px in from the sides. */
  .history {
    position: absolute;
    inset: 0;
    transform-origin: 50% 0;
  }

  .field {
    position: absolute;
    top: 0;
    left: 18px;
    width: 300px;
    height: 44px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    caret-color: #fff;
  }

  .field::placeholder {
    color: rgb(255 255 255 / 0.6);
  }

  .count {
    position: absolute;
    top: 0;
    right: 18px;
    display: flex;
    align-items: center;
    height: 44px;
    color: rgb(255 255 255 / 0.45);
    font-size: 13px;
    font-weight: 500;
  }

  /* Rows clip under the field's row and above the bottom inset. */
  .list {
    position: absolute;
    top: 44px;
    left: 0;
    width: 480px;
    overflow: hidden;
  }

  .highlight {
    position: absolute;
    left: 6px;
    width: 468px;
    background: rgb(255 255 255 / 0.1);
    transition: opacity 0.2s linear;
  }

  .highlight.gone {
    opacity: 0;
    transition-duration: 0.1s;
  }

  .row {
    position: absolute;
    left: 6px;
    width: 468px;
    height: 40px;
  }

  .row svg {
    position: absolute;
    top: 12px;
    left: 12px;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: rgb(255 255 255 / 0.78);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .line {
    position: absolute;
    top: 0;
    left: 38px;
    overflow: hidden;
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    line-height: 40px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quiet {
    position: absolute;
    left: 18px;
    display: flex;
    align-items: center;
    height: 40px;
    color: rgb(255 255 255 / 0.5);
    font-size: 13px;
    font-weight: 500;
  }

  /* The bar's chip, 6 px in from the highlight's right end, without a mark: the row has its icon. */
  .chip {
    position: absolute;
    height: 28px;
    overflow: hidden;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.14);
    font-size: 13px;
    font-weight: 500;
  }

  .face {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    padding: 0 10px 0 12px;
  }

  .ghost {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    visibility: hidden;
  }

  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .moving .label {
    text-overflow: clip;
  }

  .enter {
    flex: none;
    color: rgb(255 255 255 / 0.6);
  }

  .spoken {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* A contrast theme outlines the highlight and the chip. */
  @media (forced-colors: active) {
    .highlight,
    .chip {
      outline: 1px solid CanvasText;
    }
  }
</style>

<script lang="ts">
  import { untrack } from 'svelte'
  import type { TransitionConfig } from 'svelte/transition'
  import {
    CLIPBOARD_WORDS,
    GLYPHS,
    actionsOf,
    codeOf,
    count,
    kindOf,
    linkParts,
    middle,
    preview,
    quiet,
    swatchOf,
    written,
    type Action,
    type Format,
  } from './lib/clipboard'
  import type { Lang } from './lib/intent'
  import { ENTER, EXIT, FILTER_IN, HL, bezier } from './lib/motion'
  import { LIST } from './lib/shapes'
  import { Spring } from './lib/spring'

  // The clipboard history's list, under the bar's own row: the field and the count, the rows, the ink highlight and
  // the chip that rides it. Each row shows its type, and on its right the dim word for what Tab gives next. The shape
  // stays in Island.svelte, which lends its content transitions and the height it draws, so rows clip under its
  // moving edge. These springs run here, only while they move.
  let {
    items,
    total,
    paths,
    query = $bindable(),
    lang,
    reduced,
    height,
    enter,
    exit,
    onrun,
    onclose,
  }: {
    /** What the filter keeps, newest first. */
    items: readonly string[]
    total: number
    /** The items Rust found on this PC as a file or a folder. */
    paths: ReadonlySet<string>
    query: string
    lang: Lang
    reduced: boolean
    height: number
    enter: (node: HTMLElement, params?: { step?: number }) => TransitionConfig
    exit: (node: HTMLElement, params?: { shrinks?: boolean }) => TransitionConfig
    onrun: (text: string, action: Action, plain: boolean) => void
    onclose: () => void
  } = $props()

  const words = $derived(CLIPBOARD_WORDS[lang])
  const line = $derived(quiet(items.length, total, query, lang))
  const entering = bezier(...ENTER.easing)
  const leaving = bezier(...EXIT.easing)
  const [easeIn, easeOut] = [ENTER.easing, EXIT.easing].map((curve) => `cubic-bezier(${curve.join(', ')})`)

  // The highlight's two edges, the scroll, the chip's width, its sideways nudge on Tab, its label's 4 px slide and
  // its press, in percent, where the selected row's hint ends, and each row's place.
  const top = new Spring(0)
  const bottom = new Spring(LIST.row)
  const scroll = new Spring(0)
  const width = new Spring(0)
  const nudge = new Spring(0)
  const slide = new Spring(0)
  const press = new Spring(100)
  const hint = new Spring(16)
  // Keyed by the item's text, which is unique. Plain records: not reactive, and with no prototype, so any text is a
  // key.
  const places: Record<string, Spring> = Object.create(null)
  const springs = () => [top, bottom, scroll, width, nudge, slide, press, hint, ...Object.values(places)]
  let drawn = $state.raw({
    top: 0,
    bottom: LIST.row as number,
    scroll: 0,
    width: 0,
    nudge: 0,
    slide: 0,
    press: 100,
    hint: 16,
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
      nudge: nudge.value,
      slide: slide.value,
      press: press.value,
      hint: hint.value,
      moving: !width.resting,
    }
    at = new Map(Object.entries(places).map(([text, s]) => [text, s.value]))
    if (all.some((s) => !s.resting)) raf = requestAnimationFrame(frame)
  }
  $effect(() => () => {
    cancelAnimationFrame(raf)
    clearTimeout(landing)
  })

  untrack(() => items.forEach((text, i) => (places[text] = new Spring(i * LIST.row))))

  // The row the highlight is on, the way it last moved, the action Tab turned it to, and Shift held, which turns a
  // paste into a plain one.
  let sel = $state(0)
  let way = 0
  let act = $state(0)
  let shift = $state(false)
  const kinds = $derived(new Map(items.map((text) => [text, kindOf(text, paths)])))
  const kind = (text: string) => kinds.get(text) ?? 'text'
  const current = $derived.by((): Action => {
    const text = items[sel]
    if (text === undefined) return 'paste'
    const actions = actionsOf(text, kind(text))
    return actions[act % actions.length]
  })
  const label = $derived(shift && current === 'paste' ? words.actions.plain : words.actions[current])
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
        easing: easeIn,
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
    node.style.transformOrigin = ''
    const fade = node.animate(keyframes, { duration: reduced ? 120 : EXIT.duration, easing: easeOut, fill: 'forwards' })
    fade.onfinish = () => {
      then()
      wake()
      fade.cancel()
    }
  }

  const to = (s: Spring, y: number, t: number) => (reduced ? s.jump(y) : s.to(y, 0.3, 0, t))

  // The row whose hint shows the Tab key beside the chip. A hint never slides under the arriving chip: the leaving
  // row's and the arriving row's fade out in 80 ms, take their new place, and fade back in over 200 ms.
  let hinted = $state<string | undefined>(untrack(() => items[0]))
  const hints: Record<string, HTMLElement> = Object.create(null)
  let faded: [string, Animation][] = []
  let landing: ReturnType<typeof setTimeout> | undefined
  function rehint(from: string | undefined, onto: string | undefined) {
    if (from === onto) return
    if (reduced) {
      hinted = onto
      hint.jump(14 + chip)
      return wake()
    }
    for (const text of [from, onto]) {
      const node = text === undefined ? undefined : hints[text]
      if (text === undefined || !node || faded.some(([was]) => was === text)) continue
      const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, easing: easeOut, fill: 'forwards' })
      faded = [...faded, [text, fade]]
    }
    clearTimeout(landing)
    landing = setTimeout(() => {
      hinted = items[sel]
      hint.jump(14 + chip)
      for (const [text, fade] of faded) {
        fade.cancel()
        hints[text]?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: easeIn, fill: 'backwards' })
      }
      faded = []
      wake()
    }, 80)
  }

  function hintOf(node: HTMLElement, text: string) {
    hints[text] = node
    return {
      destroy: () => {
        if (hints[text] === node) delete hints[text]
      },
    }
  }

  // The chip's label slides in 4 px: sideways from the side Tab turns to, and up or down from where the selection
  // went or as Shift turns it. The axis waits for a new label, so a slide under way keeps its own. A colour's value
  // rolls the way Tab turned, and back as its row is left.
  let turn = 1
  let along: 'x' | 'y' = 'y'
  let axis = $state<'x' | 'y'>('y')
  let rolled = 1
  let tabs = $state(0)
  function toward(dir: number, way: 'x' | 'y') {
    turn = dir
    along = way
  }

  // Typing filters: the selection goes back to the first row and the scroll to the top. Rows still in sight move up
  // 60 ms after a shrink starts, as the content leaves first. A fade's jump or a late move from an older filter is
  // dropped, so the newest decides where each row ends up. The same rows again, as when Rust's paths arrive, change
  // nothing.
  let shown = untrack(() => items)
  let filters = 0
  $effect.pre(() => {
    const next = items
    untrack(() => {
      if (next.length === shown.length && next.every((text, i) => text === shown[i])) return void (shown = next)
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
      act = 0
      toward(-1, 'y')
      rolled = -1
      rehint(hinted, next[0])
      to(top, 0, t)
      to(bottom, LIST.row, t)
      to(scroll, 0, t)
      heard = count(next.length, total, query, lang)
      wake()
    })
  })

  // What a screen reader hears on the selected row: its type, its line as it shows, and what Enter does.
  function told(text: string) {
    const type = kind(text)
    const name = words.kinds[type].split(' ')[0]
    const code = codeOf(text)
    const said =
      type === 'colour'
        ? written(text, current as Format)
        : type === 'path'
          ? middle(text)
          : type === 'code'
            ? `${code.first}, ${words.lines(code.lines)}`
            : preview(text)
    return `${name ? `${name}, ` : ''}${said}. ${label}.`
  }

  // ↑ and ↓: the edge in the direction of travel leads and the other trails, so the highlight stretches from row to
  // row and gathers. Past the fifth row, the list scrolls by whole rows. The row left goes back to its first action.
  function select(i: number) {
    if (!items.length) return
    i = Math.max(0, Math.min(items.length - 1, i))
    if (i === sel) return
    const t = performance.now()
    way = Math.sign(i - sel)
    toward(way, 'y')
    rolled = -1
    sel = i
    act = 0
    rehint(hinted, items[i])
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
    heard = told(items[i])
    wake()
  }

  // Tab and Shift+Tab turn the selected row's action. The chip gives a little sideways, as a page turns. On a row
  // with one action, Tab does nothing.
  function cycle(dir: number) {
    const text = items[sel]
    if (text === undefined) return
    const actions = actionsOf(text, kind(text))
    if (actions.length < 2) return
    toward(dir, 'x')
    rolled = dir
    act = (act + dir + actions.length) % actions.length
    tabs++
    heard = told(text)
    if (reduced) return
    const t = performance.now()
    nudge.to(0, 0.36, 0.35, t)
    nudge.kick(-90 * dir, t)
    wake()
  }

  // The chip springs its width to its label, and shrinks away when no row is left. offsetWidth rounds: one more pixel
  // keeps a label with a fraction of a pixel from its ellipsis. The selected row's hint follows it, but jumps to its
  // first place, and waits while it fades.
  let natural = $state(0)
  let placed = false
  const chip = $derived(items.length ? natural + 1 : 0)
  $effect(() => {
    const target = chip
    untrack(() => {
      const t = performance.now()
      if (target !== width.target) {
        if (reduced) width.jump(target)
        else {
          const grows = target > width.value
          if (!grows && width.velocity < 0) width.jump(width.value)
          width.to(target, grows ? 0.4 : 0.32, grows ? 0.15 : 0, t)
        }
      }
      if (!faded.length && hint.target !== 14 + target) {
        if (reduced || !placed) hint.jump(14 + target)
        else hint.to(14 + target, 0.32, 0, t)
      }
      placed ||= natural > 0
      wake()
    })
  })

  let said = untrack(() => label)
  $effect(() => {
    const next = label
    untrack(() => {
      if (next !== said && !reduced) {
        axis = along
        slide.jump(4 * turn)
        slide.to(0, 0.3, 0, performance.now())
        wake()
      }
      said = next
    })
  })

  // The dim word slides in 4 px from the side Tab turns to, and only then.
  function turns(node: HTMLElement, last: { word: string; tabs: number }) {
    return {
      update(next: { word: string; tabs: number }) {
        if (!reduced && next.word !== last.word && next.tabs !== last.tabs) {
          node.animate([{ opacity: 0, translate: `${4 * turn}px 0` }, { opacity: 1, translate: '0 0' }], {
            duration: 200,
            easing: easeIn,
          })
        }
        last = next
      },
    }
  }

  // A colour's value rolls: the old one rises out 6 px in 90 ms, and the new one, 60 ms later, rises in from 6 px
  // out of a 3 px blur. Started together, two long values smudge into each other.
  function roll(node: HTMLElement, _: unknown, { direction }: { direction: 'in' | 'out' | 'both' }): TransitionConfig {
    if (reduced) return {}
    if (direction === 'in') {
      const y = 6 * rolled
      return {
        delay: 60,
        duration: 200,
        easing: entering,
        css: (t, u) => `opacity:${t};translate:0 ${y * u}px;filter:blur(${3 * u}px)`,
      }
    }
    Object.assign(node.style, { position: 'absolute', left: '0', top: '0' })
    const y = -6 * rolled
    return { duration: 90, easing: leaving, css: (t, u) => `opacity:${t};translate:0 ${y * u}px` }
  }

  // « Sans traqueurs » fades a link's trackers out in 160 ms, and leaving it brings them back in 200 ms.
  function fades(_: HTMLElement, __: unknown, { direction }: { direction: 'in' | 'out' | 'both' }): TransitionConfig {
    const out = direction === 'out'
    return { duration: out ? 160 : 200, easing: out ? leaving : entering, css: (t) => `opacity:${t}` }
  }

  // Enter: the chip gives under the key, then the bar folds into the peek and the action runs where you were.
  let running = false
  function run(plain: boolean) {
    const text = items[sel]
    if (text === undefined || running) return
    running = true
    const action = current
    if (!reduced) {
      const t = performance.now()
      press.to(100, 0.3, 0.3, t)
      press.kick(-80, t)
      wake()
    }
    setTimeout(() => onrun(text, action, plain), reduced ? 0 : 110)
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      toward(1, 'y')
      shift = true
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      select(sel + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Tab') {
      event.preventDefault()
      cycle(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
    }
  }

  function keyup(event: KeyboardEvent) {
    if (event.key !== 'Shift') return
    toward(-1, 'y')
    shift = false
  }

  // The chip rides the leading edge, so it lands on the new row first and the ink follows it.
  const tall = $derived(drawn.bottom - drawn.top)
  const middleY = $derived(
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
    onkeyup={keyup}
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
      {@const type = kind(text)}
      {@const actions = actionsOf(text, type)}
      {@const now = i === sel ? actions[act % actions.length] : actions[0]}
      {@const on = text === hinted}
      {@const next = actions.length > 1 ? actions[((on ? act : 0) + 1) % actions.length] : undefined}
      <div
        class="row"
        style:top="{(at.get(text) ?? i * LIST.row) - drawn.scroll}px"
        use:track={text}
        in:row|global={{ i, text }}
        out:row={{ i, text }}
      >
        {#if type === 'colour'}
          <span class="swatch" style:background={swatchOf(text)}></span>
        {:else}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={GLYPHS[type]} /></svg>
        {/if}
        <!-- The selected row ends where its hint meets the chip. -->
        <span class="body" style:right="{on ? drawn.hint : 16}px">
          <span class="line" class:mono={type === 'code'}>
            {#if type === 'link'}
              {@const link = linkParts(text, now === 'clean')}
              <!-- Trackers leave the line once faded, so its end shows what is left. -->
              {link.domain}{#each link.rest as part, k (k)}{#if !part.tracker}<span class="dim">{part.text}</span
                  >{:else if now !== 'clean'}<span class="tracker" in:fades out:fades>{part.text}</span>{/if}{/each}
            {:else if type === 'colour'}
              <span class="value">
                {#key now}<span in:roll out:roll>{written(text, now as Format)}</span>{/key}
              </span>
            {:else if type === 'path'}
              {middle(text)}
            {:else if type === 'code'}
              {@const code = codeOf(text)}
              {code.first} <span class="dim">· {words.lines(code.lines)}</span>
            {:else}
              {preview(text)}
            {/if}
          </span>
          {#if next}
            <span class="hint" use:hintOf={text}>
              {#if on}<span class="tab">Tab</span>{/if}
              <span use:turns={{ word: next, tabs }}>{words.actions[next]}</span>
            </span>
          {/if}
        </span>
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
      style:top="{middleY - 14 - drawn.scroll}px"
      style:width="{drawn.width}px"
      style:translate="{drawn.nudge}px 0"
      style:scale={drawn.press / 100}
      style:visibility={drawn.width < 1.5 ? 'hidden' : undefined}
      in:enter|global={{ step: 3 }}
    >
      <span class="face" class:moving={drawn.moving}>
        <span class="label" style:translate={axis === 'x' ? `${drawn.slide}px 0` : `0 ${drawn.slide}px`}>{label}</span>
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

  /* A colour's swatch in the glyph's 16 px slot, ringed so black shows on the black panel. */
  .swatch {
    position: absolute;
    top: 13px;
    left: 13px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.28);
  }

  /* The line from 44 px, then the hint, 14 px apart. */
  .body {
    position: absolute;
    top: 0;
    left: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
  }

  .line {
    min-width: 0;
    margin-right: 4px;
    overflow: hidden;
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    line-height: 40px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line.mono {
    font: 400 13px/40px 'Cascadia Mono', Consolas, ui-monospace, monospace;
  }

  .dim {
    color: rgb(255 255 255 / 0.55);
  }

  .tracker {
    color: rgb(255 255 255 / 0.35);
  }

  /* The value Tab rolls, laid out on its own so the old one can leave from where it was. */
  .value,
  .value span {
    position: relative;
    display: inline-block;
  }

  .hint {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin-left: 10px;
    color: rgb(255 255 255 / 0.45);
    font-size: 12px;
    font-weight: 500;
  }

  .hint span {
    display: inline-block;
  }

  /* The welcome's keycap, small. */
  .tab {
    height: 16px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.12);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
    color: rgb(255 255 255 / 0.7);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
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

  /* A contrast theme outlines the highlight, the chip and the Tab key, draws the glyphs in its text colour and keeps
     a colour's swatch. */
  @media (forced-colors: active) {
    .highlight,
    .chip,
    .tab {
      outline: 1px solid CanvasText;
    }

    .row svg {
      stroke: CanvasText;
    }

    .swatch {
      forced-color-adjust: none;
    }
  }
</style>

<script lang="ts" module>
  import { ASSISTANTS, type App, type Choice, type Lang, type Target } from './lib/intent'

  /** An app from the list, with the color of the monogram that stands in until its icon loads. Start's apps have
   * the id Rust opens them by, and their icon once it is read. */
  export type Listed = App & { color: string; id?: string; icon?: Icon | null }
  type Icon = { side: number; rgba: string }

  // Monograms for the assistants, until their icons ship.
  const MARKS: Record<Target, string> = {
    claude: '#D97757',
    chatgpt: '#10A37F',
    gemini: '#4285F4',
    perplexity: '#20808D',
    search: '#5F6368',
  }

  /** What fills the 16 px icon slot: the app's icon, a monogram, a clock, or the timer's amber ring. */
  export function markOf(choice: Choice<Listed>): { letter?: string; color?: string; icon?: Icon } {
    if (choice.kind === 'app' && choice.app.icon) return { icon: choice.app.icon }
    if (choice.kind === 'app') return { letter: choice.app.name[0], color: choice.app.color }
    if (choice.kind === 'ask') return { letter: ASSISTANTS[choice.to].name[0], color: MARKS[choice.to] }
    return {}
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import type { TransitionConfig } from 'svelte/transition'
  import { Spring } from './lib/spring'
  import { paintIcon } from './PrivacyCard.svelte'

  // The command bar's content: the field, and one chip that says what Enter will do. The bar's shape stays in
  // Island.svelte, which lends its content transitions; the chip's own small springs run here, only while they move.
  let {
    line = $bindable(),
    choices,
    lang,
    reduced,
    shortcut,
    enter,
    exit,
    onrun,
    onclose,
  }: {
    line: string
    choices: Choice<Listed>[]
    lang: Lang
    reduced: boolean
    /** The shortcut that opens the bar, as Rust registered it: `Win+Alt+S`. */
    shortcut?: string
    enter: (node: HTMLElement, params?: { step?: number }) => TransitionConfig
    exit: (node: HTMLElement, params?: { shrinks?: boolean }) => TransitionConfig
    onrun: (choice: Choice<Listed>) => void
    onclose: () => void
  } = $props()

  // Tab and Shift+Tab turn through the alternatives; typing starts over from the top guess.
  let pick = $state(0)
  const choice = $derived(choices.length ? choices[pick % choices.length] : undefined)
  // While the chip shrinks away on an empty line, it keeps its last label.
  let shown = $state<Choice<Listed>>()
  $effect(() => {
    if (choice) shown = choice
  })
  const mark = $derived(shown && markOf(shown))

  // The chip's width, its sideways nudge on Tab, the label's 4 px slide and the press, in percent.
  const width = new Spring(0)
  const nudge = new Spring(0)
  const slide = new Spring(0)
  const scale = new Spring(100)
  const springs = [width, nudge, slide, scale]
  let drawn = $state({ width: 0, nudge: 0, slide: 0, scale: 100, moving: false })
  let raf = 0

  function wake() {
    raf ||= requestAnimationFrame(frame)
  }

  // The page's own clock, as every spring starts on: in a frame, Chromium's rAF time can run seconds behind it.
  function frame() {
    raf = 0
    const t = performance.now()
    springs.forEach((s) => s.update(t))
    drawn = { width: width.value, nudge: nudge.value, slide: slide.value, scale: scale.value, moving: !width.resting }
    if (springs.some((s) => !s.resting)) raf = requestAnimationFrame(frame)
  }
  $effect(() => () => cancelAnimationFrame(raf))

  // Only the width springs to a new label: no fade, and the height never changes.
  let natural = $state(0)
  $effect(() => {
    // offsetWidth rounds: one more pixel keeps a label with a fraction of a pixel from its ellipsis.
    const target = choice ? natural + 1 : 0
    untrack(() => {
      if (target === width.target) return
      if (reduced) width.jump(target)
      else {
        const grows = target > width.value
        // A shrink that may not bounce starts from a standstill, as the island's own do.
        if (!grows && width.velocity < 0) width.jump(width.value)
        width.to(target, grows ? 0.4 : 0.32, grows ? 0.15 : 0, performance.now())
      }
      wake()
    })
  })

  // A new label slides in by 4 px, from the side the alternatives turn to.
  let turn = 1
  let label = ''
  $effect(() => {
    const next = choice?.label ?? ''
    untrack(() => {
      if (label && next && next !== label && !reduced) {
        slide.jump(4 * turn)
        slide.to(0, 0.3, 0, performance.now())
        wake()
      }
      label = next
      turn = 1
    })
  })

  let running = false
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      event.preventDefault()
      if (choices.length < 2) return
      turn = event.shiftKey ? -1 : 1
      pick = (pick + turn + choices.length) % choices.length
      if (reduced) return
      // The chip gives a little sideways, as a page turns.
      const t = performance.now()
      nudge.to(0, 0.36, 0.35, t)
      nudge.kick(-90 * turn, t)
      wake()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!choice || running) return
      running = true
      const picked = choice
      // The chip gives under the key, then the bar folds into the answer.
      if (!reduced) {
        const t = performance.now()
        scale.to(100, 0.3, 0.3, t)
        scale.kick(-80, t)
        wake()
      }
      setTimeout(() => onrun(picked), reduced ? 0 : 110)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
    }
  }

  // In a frame on the site, the bar mustn't take the page's focus: keys would type in it instead of scrolling.
  const focus = (node: HTMLInputElement) => {
    if (window === parent) node.focus()
  }
</script>

{#snippet face(choice: Choice<Listed>, mark: ReturnType<typeof markOf>)}
  <span class="mark" style:background={mark.color}>
    {#if mark.icon}
      <canvas use:paintIcon={mark.icon}></canvas>
    {:else if mark.letter}
      {mark.letter}
    {:else if choice.kind === 'clock'}
      <svg class="clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2 1.5" /></svg>
    {:else}
      <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /></svg>
    {/if}
  </span>
  <span class="label" style:translate="{drawn.slide}px 0">{choice.label}</span>
  <span class="enter">↵</span>
{/snippet}

<input
  class="field"
  type="text"
  bind:value={line}
  placeholder={lang === 'fr' ? 'Minuteur, app, question…' : 'Timer, app, question…'}
  aria-label={lang === 'fr' ? 'Barre de commande' : 'Command bar'}
  aria-keyshortcuts={shortcut?.replace('Win', 'Meta')}
  spellcheck="false"
  autocomplete="off"
  use:focus
  oninput={() => (pick = 0)}
  onkeydown={keydown}
  in:enter|global
  out:exit|global
/>
<span
  class="chip"
  role="status"
  style:width="{drawn.width}px"
  style:translate="{drawn.nudge}px 0"
  style:scale={drawn.scale / 100}
  in:enter|global={{ step: 1 }}
  out:exit|global
>
  {#if shown && mark}
    <!-- The ellipsis waits for the chip to settle, so a growing label is revealed, not cut. -->
    <span class="row" class:moving={drawn.moving}>{@render face(shown, mark)}</span>
    <!-- Laid out at its own width, out of sight: the chip springs to it. -->
    <span class="row ghost" aria-hidden="true" bind:offsetWidth={natural}>{@render face(choice ?? shown, mark)}</span>
  {/if}
</span>

<style>
  .field {
    flex: none;
    width: 240px;
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

  /* The chip has no padding of its own, so it can spring down to nothing. */
  .chip {
    position: relative;
    flex: none;
    height: 28px;
    overflow: hidden;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.14);
    font-size: 13px;
    font-weight: 500;
  }

  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    padding: 0 10px 0 6px;
  }

  .ghost {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    max-width: 200px;
    visibility: hidden;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
  }

  .mark canvas {
    width: 100%;
    height: 100%;
  }

  .mark svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: #fbbf24;
    stroke-width: 2;
  }

  .mark svg.clock {
    stroke: #fff;
    stroke-linecap: round;
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

  /* The slot and the glyph keep their colors in a contrast theme; the chip itself is outlined. */
  @media (forced-colors: active) {
    .chip {
      outline: 1px solid CanvasText;
    }

    .mark {
      forced-color-adjust: none;
    }
  }
</style>

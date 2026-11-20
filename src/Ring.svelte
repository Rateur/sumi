<script lang="ts" module>
  /** The plug-in peek's bolt, which the PC's ring wears too while it is on mains. */
  export const BOLT_PATH = 'M9.5 1.5 3.5 9H8l-1.5 5.5L12.5 7H8z'

  export { glyph }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { FILL, colorOf, type Item } from './lib/power'
  import { Spring } from './lib/spring'

  // A battery's ring, drawn on 44 units so its stroke and glyph scale with it: the track at a quarter of its colour,
  // the arc from 12 o'clock, the device's glyph or "+N", and the PC's bolt on a disc of the island's black.
  let {
    it,
    stroke = 4,
    drawn = true,
    more = 0,
    fill,
    wait = 0,
    reduced = false,
  }: {
    it: Item
    /** In the ring's 44 units. */
    stroke?: number
    /** Whether the glyph shows inside. */
    drawn?: boolean
    /** How many devices "+N" stands for. */
    more?: number
    /** The arc, out of 100, when the panel moves it; otherwise it fills itself, `wait` ms after it appears. */
    fill?: number
    wait?: number
    reduced?: boolean
  } = $props()

  let own = $state(0)
  $effect(() => {
    if (fill !== undefined) return
    const level = it.percent
    if (reduced) return void (own = level)
    const spring = new Spring(untrack(() => own))
    let raf = 0
    const frame = () => {
      const moving = spring.update(performance.now())
      own = spring.value
      raf = moving ? requestAnimationFrame(frame) : 0
    }
    const start = setTimeout(() => {
      spring.to(level, ...FILL, performance.now())
      frame()
    }, wait)
    return () => {
      clearTimeout(start)
      cancelAnimationFrame(raf)
    }
  })
  const level = $derived(fill ?? own)
  const r = $derived(22 - stroke / 2)
  const color = $derived(more ? '#fff' : colorOf(it))
</script>

<svg viewBox="0 0 44 44" aria-hidden="true">
  <circle class="track" cx="22" cy="22" {r} stroke={color} stroke-width={stroke} />
  <!-- Under half a unit, the round caps would show a dot. -->
  {#if level >= 0.5}
    <circle
      class="arc"
      cx="22"
      cy="22"
      {r}
      stroke={color}
      stroke-width={stroke}
      pathLength="100"
      stroke-dasharray="{level.toFixed(2)} 100"
      transform="rotate(-90 22 22)"
    />
  {/if}
  {#if more}
    <text class="more" x="22" y="22.5">+{more}</text>
  {:else if drawn}
    <svg class="glyph" x="12" y="12" width="20" height="20" viewBox="0 0 24 24">{@render glyph(it.kind)}</svg>
  {/if}
  {#if !more && it.pc && it.plugged}
    <circle cx="22" cy={stroke / 2} r="6.5" fill="#000" />
    <path fill="#fff" transform="translate(16.4 {stroke / 2 - 5.6}) scale(0.7)" d={BOLT_PATH} />
  {/if}
</svg>

<!-- The glyphs, on the 24-unit grid of the island's icons. The PC is a laptop: a desktop has no battery ring. -->
{#snippet glyph(kind: Item['kind'])}
  {#if kind === 'laptop'}
    <rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" />
  {:else if kind === 'headset'}
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3.5" y="14" width="4.5" height="6.5" rx="1.5" /><rect x="16" y="14" width="4.5" height="6.5" rx="1.5" />
  {:else if kind === 'speaker'}
    <rect x="6" y="2.5" width="12" height="19" rx="3" /><circle cx="12" cy="14.5" r="3.5" /><path d="M12 7h.01" />
  {:else if kind === 'mouse'}
    <rect x="6.5" y="3" width="11" height="18" rx="5.5" /><path d="M12 7v3.5" />
  {:else if kind === 'keyboard'}
    <rect x="2" y="6.5" width="20" height="11" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  {:else if kind === 'controller'}
    <path
      d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.6a2.6 2.6 0 0 1-4.6 2.1L15.5 16h-7l-1.7 1.8a2.6 2.6 0 0 1-4.6-2.1l.9-4.6a4.5 4.5 0 0 1 4.4-3.6Z"
    />
    <path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17 13h.01" />
  {:else}
    <rect x="2" y="7" width="17.5" height="10" rx="3" /><path d="M22 10.5v3" />
  {/if}
{/snippet}

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .track,
  .arc {
    fill: none;
  }

  .track {
    stroke-opacity: 0.25;
  }

  .arc {
    stroke-linecap: round;
  }

  .glyph {
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .more {
    fill: #fff;
    font-size: 13px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
  }

  /* In a contrast theme the rings keep their own colours, as the microphone and camera dots do. */
  @media (forced-colors: active) {
    svg {
      forced-color-adjust: none;
    }
  }
</style>

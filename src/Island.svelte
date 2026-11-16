<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { untrack } from 'svelte'
  import { Spring, prefersReducedMotion } from 'svelte/motion'
  import { innerWidth } from 'svelte/reactivity/window'
  import { fade } from 'svelte/transition'
  import { arrange, type Activity, type Arrangement } from './lib/activities'
  import {
    formatCountdown,
    formatLongDate,
    formatShortDate,
    formatTime,
    msUntilNextMinute,
    msUntilNextSecond,
  } from './lib/clock'
  import { BUBBLE, layout, radius, resolveView, sizeOf, type Rect } from './lib/shapes'

  // Tuned at 60 Hz against Svelte's integrator: growing covers 90 % of the way in ~120 ms
  // and overshoots by ~4 %, shrinking lands in ~150 ms without a bounce. Both rest within 0.6 s.
  const GROW = { stiffness: 0.1, damping: 0.4 }
  const SHRINK = { stiffness: 0.1, damping: 0.5 }
  // Content leaves this fast, and the shape waits for it before shrinking.
  const EXIT = 80

  const tauri = isTauri()
  let island: HTMLButtonElement
  let activities = $state<Activity[]>([])
  let hovered = $state(false)
  let expanded = $state(false)
  let peeking = $state<string>()
  let now = $state(new Date())

  let shown: Arrangement | undefined
  const arrangement = $derived.by(() => (shown = arrange(activities, shown)))
  const view = $derived(resolveView({ activity: arrangement.island, hovered, expanded, peeking }))
  const key = $derived('activity' in view ? `${view.name}:${view.activity.id}` : view.name)
  const reduced = $derived(prefersReducedMotion.current)

  // Svelte's spring adds its forces once per frame, so a faster screen would stiffen it and lose
  // the overshoot. Scaling by the frame time, in 60 Hz frames, keeps the same feel at any rate.
  let frame = $state(1)
  const stamps: number[] = []
  requestAnimationFrame(function measure(stamp) {
    stamps.push(stamp)
    if (stamps.length < 12) return void requestAnimationFrame(measure)
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b)
    frame = 60 / Math.round(1000 / gaps[5])
  })
  const tuned = ({ stiffness, damping }: typeof GROW) => ({ stiffness: stiffness * frame, damping: damping * frame })

  const size = new Spring(sizeOf({ name: 'idle' }), GROW)
  const bubble = new Spring(0, GROW)
  const rects = $derived(layout(innerWidth.current ?? 0, size.current, bubble.current))

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

  $effect(() => {
    const target = sizeOf(view)
    if (reduced) return void size.set(target, { instant: true })
    const shrinks = untrack(() => target.width * target.height < size.target.width * size.target.height)
    Object.assign(size, tuned(shrinks ? SHRINK : GROW))
    if (!shrinks) return void size.set(target)
    const timer = setTimeout(() => size.set(target), EXIT)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    Object.assign(bubble, tuned(GROW))
  })

  $effect(() => {
    bubble.set(arrangement.bubble ? BUBBLE : 0, { instant: reduced })
  })

  // The Rust side lets clicks through everywhere except over these rectangles.
  $effect(() => {
    if (tauri) invoke('set_island_rects', { rects })
  })

  // Once the window lets the cursor through, the DOM stops hearing about it: Rust watches instead.
  $effect(() => {
    if (!tauri) return
    const stops = [
      listen<boolean>('island://pointer', (event) => (hovered = event.payload)),
      listen('island://dismiss', () => (expanded = false)),
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
      }),
    )
  }

  const place = ({ x, y, width, height }: Rect) =>
    `left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:${radius(height)}px`
</script>

<svelte:window
  onkeydown={(event) => !tauri && event.key === 'Escape' && (expanded = false)}
  onpointerdown={(event) => !tauri && !island.contains(event.target as Node) && (expanded = false)}
/>

{#snippet glyph(activity: Activity, short = false)}
  {#if activity.kind === 'call'}
    <span class="dots">
      {#if activity.mic}<span class="dot mic"></span>{/if}
      {#if activity.camera}<span class="dot camera"></span>{/if}
    </span>
  {:else if activity.kind === 'timer'}
    <span class="countdown">{formatCountdown(activity.endsAt - now.getTime(), short)}</span>
  {:else}
    <span class="art" style:background={activity.color}></span>
  {/if}
{/snippet}

{#snippet equalizer(color: string)}
  <span class="equalizer" class:still={reduced} style:color>
    <span></span><span></span><span></span><span></span>
  </span>
{/snippet}

<button
  type="button"
  class="island"
  aria-expanded={expanded}
  bind:this={island}
  style={place(rects[0])}
  onclick={() => (expanded = true)}
  onpointerenter={() => tauri || (hovered = true)}
  onpointerleave={() => tauri || (hovered = false)}
>
  {#key key}
    <span
      class="content view {view.name}"
      style:width="{sizeOf(view).width}px"
      style:height="{sizeOf(view).height}px"
      in:fade={{ delay: reduced ? 0 : 60, duration: reduced ? 120 : 160 }}
      out:fade={{ duration: reduced ? 120 : EXIT }}
    >
      {#if view.name === 'idle'}
        <time datetime={now.toISOString()}>{formatTime(now)}</time>
      {:else if view.name === 'hover'}
        <span class="muted">{formatShortDate(now)}</span>
        <time datetime={now.toISOString()}>{formatTime(now)}</time>
      {:else if view.name === 'expanded'}
        <time class="big" datetime={now.toISOString()}>{formatTime(now)}</time>
        <span class="muted">{formatLongDate(now)}</span>
      {:else if view.activity.kind === 'music'}
        {@render glyph(view.activity)}
        {#if view.name === 'peek'}
          <span class="track">
            <span>{view.activity.title}</span>
            <span class="muted">{view.activity.artist}</span>
          </span>
        {/if}
        {@render equalizer(view.activity.color)}
      {:else if view.activity.kind === 'call'}
        <time datetime={now.toISOString()}>{formatTime(now)}</time>
        {@render glyph(view.activity)}
      {:else}
        {@render glyph(view.activity)}
      {/if}
    </span>
  {/key}
</button>

{#if rects[1]}
  <div class="island bubble" style={place(rects[1])}>
    {#if arrangement.bubble}
      <span class="content" transition:fade={{ duration: reduced ? 120 : EXIT }}>
        {@render glyph(arrangement.bubble, true)}
      </span>
    {/if}
  </div>
{/if}

<style>
  .island {
    position: absolute;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: #000;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
    color: inherit;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: default;
  }

  .content {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Laid out at the size it is headed for, and revealed by the shape as it grows. */
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

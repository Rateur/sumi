<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { formatTime, msUntilNextMinute } from './lib/clock'

  let island: HTMLDivElement
  let now = $state(new Date())

  $effect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      now = new Date()
      timer = setTimeout(tick, msUntilNextMinute(now))
    }
    timer = setTimeout(tick, msUntilNextMinute(now))
    return () => clearTimeout(timer)
  })

  // The Rust side lets clicks through everywhere except over this rectangle.
  $effect(() => {
    if (!isTauri()) return
    const report = () => {
      const { x, y, width, height } = island.getBoundingClientRect()
      invoke('set_island_rect', { rect: { x, y, width, height } })
    }
    const observer = new ResizeObserver(report)
    observer.observe(island)
    return () => observer.disconnect()
  })
</script>

<div class="island" bind:this={island}>
  <time datetime={now.toISOString()}>{formatTime(now)}</time>
</div>

<style>
  .island {
    position: absolute;
    top: 8px;
    left: 50%;
    width: 132px;
    height: 34px;
    display: grid;
    place-items: center;
    transform: translateX(-50%);
    border-radius: 17px;
    background: #000;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>

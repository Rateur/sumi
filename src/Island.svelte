<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'

  let island: HTMLDivElement

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

<div class="island" bind:this={island}></div>

<style>
  .island {
    position: absolute;
    top: 8px;
    left: 50%;
    width: 132px;
    height: 34px;
    transform: translateX(-50%);
    border-radius: 17px;
    background: #000;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  }
</style>

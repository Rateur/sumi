<script lang="ts" module>
  /** An app's own icon, painted from the pixels Rust read. The command bar paints Start's icons the same way. */
  export function paintIcon(canvas: HTMLCanvasElement, icon: { side: number; rgba: string }) {
    const draw = ({ side, rgba }: typeof icon) => {
      const bytes = Uint8ClampedArray.from(atob(rgba), (c) => c.charCodeAt(0))
      canvas.width = canvas.height = side
      canvas.getContext('2d')?.putImageData(new ImageData(bytes, side, side), 0, 0)
    }
    draw(icon)
    return { update: draw }
  }
</script>

<script lang="ts">
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import type { TransitionConfig } from 'svelte/transition'
  import { lasted, light, type Privacy } from './lib/privacy'
  import { CARD, cardSize } from './lib/shapes'

  // What the privacy tag opens into. The tag's shape, springs and timers stay in Island.svelte, which lends its
  // content transitions so the rows come in as the island's own content does.
  let {
    privacy = $bindable(),
    now,
    enter,
    exit,
    onclose,
  }: {
    privacy: Privacy
    now: Date
    enter: (node: HTMLElement, params?: { step?: number }) => TransitionConfig
    exit: (node: HTMLElement, params?: { shrinks?: boolean }) => TransitionConfig
    onclose: () => void
  } = $props()

  const tauri = isTauri()
  const many = $derived(privacy.apps.length > CARD.rows)
  const rows = $derived(privacy.apps.slice(0, many ? CARD.rows - 1 : CARD.rows))
  const cardBox = $derived(cardSize(privacy.apps.length))

  function mute() {
    if (tauri) invoke('privacy_mute', { muted: !privacy.muted })
    else privacy = { ...privacy, muted: !privacy.muted }
  }

  function settings() {
    if (tauri) invoke('privacy_settings', { camera: light(privacy) === 'camera' })
    onclose()
  }

  // Windows can't turn the camera off for every app the way it mutes the microphone: the app's own window can.
  async function show(name: string) {
    onclose()
    if (tauri && !(await invoke<boolean>('privacy_show', { name }))) settings()
  }
</script>

<!-- Island.svelte keeps its own copy for the disc: a snippet takes its styles from the file it is written in. -->
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

<span class="card" style:width="{cardBox.width}px" style:height="{cardBox.height}px">
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

<style>
  /* Before `.app`, which takes over its colour and weight on the `+2` row. */
  .muted {
    color: rgb(255 255 255 / 0.6);
    font-size: 13px;
    font-weight: 500;
  }

  /* Laid out at the card's size from the top-left corner: the tag's shape reveals it as it opens. */
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

  .card svg {
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

  @media (prefers-reduced-motion: reduce) {
    .slash,
    .actions button {
      transition: none;
    }
  }
</style>

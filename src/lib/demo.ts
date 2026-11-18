import type { Activity } from './activities'
import type { Player } from './music'
import type { Privacy, PrivacyApp } from './privacy'

const SONGS = [
  { title: 'Midnight City', artist: 'M83', color: '#A78BFA' },
  { title: 'Intro', artist: 'The xx', color: '#F472B6' },
]

// A minute into a four-minute song, with every control on.
const playing = (id: string, title: string, artist: string): Player => ({
  id,
  title,
  artist,
  playing: true,
  canPlayPause: true,
  canNext: true,
  canPrevious: true,
  canSeek: true,
  endMs: 240_000,
  positionMs: 60_000,
  updatedMs: Date.now(),
  rate: 1,
})

// The site's examples bring their own song: `?title=…&artist=…&art=…&color=…`.
const params = new URLSearchParams(location.search)
const own = Object.fromEntries(['title', 'artist', 'art', 'color'].flatMap((k) => (params.has(k) ? [[k, params.get(k)]] : [])))
const song = { ...SONGS[0], ...own }

const fakes: Record<string, () => Activity> = {
  call: () => ({ id: 'call', kind: 'call', mic: true, camera: true }),
  timer: () => ({ id: 'timer', kind: 'timer', endsAt: Date.now() + 25 * 60_000 }),
  done: () => ({ id: 'done', kind: 'timer', endsAt: Date.now() + 3000 }),
  music: () => ({ id: 'music', kind: 'music', ...song, player: playing('music', song.title, song.artist) }),
  video: () => ({
    id: 'video',
    kind: 'music',
    title: 'Lofi beats',
    artist: 'YouTube',
    color: '#F87171',
    player: playing('video', 'Lofi beats', 'YouTube'),
  }),
}

const KEYS: Record<string, string> = {
  c: 'call',
  t: 'timer',
  d: 'done',
  m: 'music',
  v: 'video',
  p: 'peek',
  n: 'track',
  h: 'hover',
  e: 'expand',
  a: 'alert',
  f: 'fullscreen',
  k: 'mic',
  j: 'camera',
  u: 'mute',
  ',': 'press',
  '.': 'cancel',
}

/**
 * Dev only, in the browser. Each transition has a key and a name for `window.__sumiDemo.trigger(name)`:
 * C call, T timer, D a timer that ends in 3 s, M music, V a second player (a second activity splits the
 * bubble off, ending it merges it back; a click on the bubble swaps the two), P peek the song, N next song, H hover, E open or close, A alert, F fullscreen,
 * comma press and period cancel the press (E releases it into the panel).
 */
export function demo(island: {
  activities: Activity[]
  privacy: Privacy
  peek: (id: string) => void
  hover: () => void
  expand: () => void
  press: (down: boolean) => void
  alert: () => void
  fullscreen: () => void
}) {
  const toggle = (fake: Activity) => {
    const others = island.activities.filter((a) => a.id !== fake.id)
    island.activities = others.length < island.activities.length ? others : [...others, fake]
  }
  const use = (fake: PrivacyApp) => {
    const { apps } = island.privacy
    const others = apps.filter((a) => a.name !== fake.name)
    island.privacy = { ...island.privacy, canMute: true, apps: others.length < apps.length ? others : [...others, fake] }
  }
  const actions: Record<string, () => void> = {
    mic: () => use({ name: 'Discord', mic: true, camera: false, sinceMs: Date.now() - 12 * 60_000 }),
    camera: () => use({ name: 'Microsoft Teams', mic: true, camera: true, sinceMs: Date.now() }),
    mute: () => (island.privacy = { ...island.privacy, canMute: true, muted: !island.privacy.muted }),
    ...Object.fromEntries(Object.entries(fakes).map(([name, fake]) => [name, () => toggle(fake())])),
    peek: () => island.peek('music'),
    track: () => {
      island.activities = island.activities.map((a) =>
        a.kind === 'music' ? { ...a, ...SONGS[a.title === SONGS[0].title ? 1 : 0] } : a,
      )
    },
    hover: island.hover,
    expand: island.expand,
    press: () => island.press(true),
    cancel: () => island.press(false),
    alert: island.alert,
    fullscreen: island.fullscreen,
  }
  addEventListener('keydown', ({ key }) => actions[KEYS[key]]?.())
  // `?show=music&show=video` starts in those states. A page that frames the island drives it by name, and hears
  // when it can.
  const run = (name: unknown) => typeof name === 'string' && Object.hasOwn(actions, name) && actions[name]()
  params.getAll('show').forEach(run)
  addEventListener('message', ({ origin, data }) => origin === location.origin && run(data))
  if (parent !== window) parent.postMessage('sumi:ready', location.origin)
  Object.assign(window, {
    __sumiDemo: { transitions: Object.keys(actions), trigger: (name: string) => actions[name]() },
  })
}

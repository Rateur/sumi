import { isTauri } from '@tauri-apps/api/core'
import type { Listed } from '../CommandBar.svelte'
import type { Activity } from './activities'
import type { Player } from './music'
import type { Privacy, PrivacyApp } from './privacy'
import { ended, isTimer, order, pause, resume } from './timers'

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

// The site's examples bring their own song: `?title=…&artist=…&art=…&color=…`. The page is public, so outside dev
// only a frame on the site's own pages may set it: a shared link can't dress the island up.
const framed = (() => {
  try {
    return parent !== window && parent.location.origin === location.origin
  } catch {
    return false
  }
})()

// Only a trusted page (dev, or the site's own frame) may set the song. A second check behind that gate: the cover must
// come from the site, and the colour must be a colour.
export function songParams(search: string, origin: string, isColor: (value: string) => boolean, trusted: boolean) {
  if (!trusted) return {}
  const params = new URLSearchParams(search)
  const sameOrigin = (url: string) => {
    try {
      return new URL(url, origin).origin === origin
    } catch {
      return false
    }
  }
  const allowed: Record<string, (value: string) => boolean> = {
    title: () => true,
    artist: () => true,
    art: sameOrigin,
    color: isColor,
  }
  return Object.fromEntries(
    Object.entries(allowed).flatMap(([key, ok]) => {
      const value = params.get(key)
      return value !== null && ok(value) ? [[key, value]] : []
    }),
  )
}

const own = songParams(location.search, location.origin, (v) => CSS.supports('color', v), import.meta.env.DEV || framed)
const song = { ...SONGS[0], ...own }

// The command bar's stand-ins for Start's list: twelve apps, each with its monogram's color.
const fr = navigator.language.toLowerCase().startsWith('fr')
const APPS: Listed[] = [
  { name: 'Discord', color: '#5865F2' },
  { name: 'Spotify', color: '#1DB954' },
  { name: 'Steam', color: '#2A475E' },
  { name: 'Visual Studio Code', color: '#007ACC' },
  { name: 'Google Chrome', color: '#DB4437' },
  { name: fr ? 'Paramètres' : 'Settings', color: '#6B7280' },
  { name: fr ? 'Explorateur de fichiers' : 'File Explorer', color: '#B7791F' },
  { name: fr ? 'Calculatrice' : 'Calculator', color: '#4B5563' },
  { name: 'Microsoft Teams', color: '#6264A7' },
  { name: 'Claude', color: '#D97757' },
  { name: 'Notes', color: '#A16207' },
  { name: 'Mail', color: '#0A66C2' },
]

const fakes: Record<string, () => Activity> = {
  call: () => ({ id: 'call', kind: 'call', mic: true, camera: true }),
  timer: () => ({ id: 'timer', kind: 'timer', endsAt: Date.now() + 25 * 60_000, total: 25 * 60_000 }),
  done: () => ({ id: 'done', kind: 'timer', endsAt: Date.now() + 3000, total: 3000 }),
  pasta: () => ({
    id: 'pasta',
    kind: 'timer',
    endsAt: Date.now() + 10 * 60_000,
    total: 10 * 60_000,
    label: fr ? 'pâtes' : 'pasta',
  }),
  long: () => ({ id: 'long', kind: 'timer', endsAt: Date.now() + 90 * 60_000, total: 90 * 60_000 }),
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
  o: 'card',
  ',': 'press',
  '.': 'cancel',
  i: 'claude',
  b: 'bar',
  l: 'pasta',
  g: 'long',
  z: 'pause',
  w: 'welcome',
}

/**
 * Dev only, in the browser. Each transition has a key and a name for `window.__sumiDemo.trigger(name)`:
 * C call, T timer, D a timer that ends in 3 s, L a timer with a name, G one over an hour, Z pause or resume the
 * timer that ends first, M music, V a second player (a second activity splits the
 * bubble off, ending it merges it back; a click on the bubble swaps the two), P peek the song, N next song, H hover, E open or close, A alert, F fullscreen,
 * comma press and period cancel the press (E releases it into the panel). B or Ctrl+Alt+Space opens the command
 * bar ('bar'; the Claude app takes Ctrl+Alt+Space when it runs), and I takes the Claude app away or brings it back ('claude'). Enter in the bar opens
 * nothing: the island only plays its answer. W plays the first-launch welcome from the drop ('welcome'), with the
 * shortcut `?shortcut=…` names: `Win+Alt+S` by default, `Alt+Shift+S`, or empty for none.
 */
export function demo(island: {
  activities: Activity[]
  privacy: Privacy
  peek: (id: string) => void
  hover: () => void
  expand: () => void
  card: () => void
  press: (down: boolean) => void
  alert: () => void
  fullscreen: () => void
  bar: () => void
  welcome: () => void
  shortcut: string | undefined
  apps: Listed[]
  claudeApp: boolean
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
    pause: () => {
      const t = Date.now()
      const first = order(island.activities.filter(isTimer).filter((a) => !ended(a, t)), t)[0]
      if (!first) return
      island.activities = island.activities.map((a) =>
        a.id !== first.id || !isTimer(a) ? a : a.left === undefined ? pause(a, t) : resume(a, t),
      )
    },
    hover: island.hover,
    expand: island.expand,
    card: island.card,
    press: () => island.press(true),
    cancel: () => island.press(false),
    alert: island.alert,
    fullscreen: island.fullscreen,
    bar: island.bar,
    welcome: island.welcome,
    // Without the app, Windows knows no `claude:` link either: questions open the website.
    claude: () => {
      island.claudeApp = !island.claudeApp
      island.apps = APPS.filter((app) => island.claudeApp || app.name !== 'Claude')
    },
  }
  // In the app, the bar lists Start's own apps.
  if (!isTauri()) {
    island.apps = APPS
    island.claudeApp = true
    island.shortcut = (new URLSearchParams(location.search).get('shortcut') ?? 'Win+Alt+S') || undefined
  }
  addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.code === 'Space') {
      event.preventDefault()
      return actions.bar()
    }
    // Letters typed in the bar are text, not demo keys.
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.altKey || event.metaKey) return
    actions[KEYS[event.key]]?.()
  })
  // In dev, `?show=music&show=video` starts in those states. A page that frames the island drives it by name, and
  // hears when it can.
  const run = (name: unknown) => typeof name === 'string' && Object.hasOwn(actions, name) && actions[name]()
  if (import.meta.env.DEV) new URLSearchParams(location.search).getAll('show').forEach(run)
  addEventListener('message', ({ origin, data }) => origin === location.origin && run(data))
  if (parent !== window) parent.postMessage('sumi:ready', location.origin)
  Object.assign(window, {
    __sumiDemo: { transitions: Object.keys(actions), trigger: (name: string) => actions[name]() },
  })
}

import type { Activity } from './activities'

const SONGS = [
  { title: 'Midnight City', artist: 'M83', color: '#A78BFA' },
  { title: 'Intro', artist: 'The xx', color: '#F472B6' },
]

const fakes: Record<string, () => Activity> = {
  call: () => ({ id: 'call', kind: 'call', mic: true, camera: true }),
  timer: () => ({ id: 'timer', kind: 'timer', endsAt: Date.now() + 25 * 60_000 }),
  done: () => ({ id: 'done', kind: 'timer', endsAt: Date.now() + 3000 }),
  music: () => ({ id: 'music', kind: 'music', ...SONGS[0] }),
}

const KEYS: Record<string, string> = {
  c: 'call',
  t: 'timer',
  d: 'done',
  m: 'music',
  p: 'peek',
  n: 'track',
  h: 'hover',
  e: 'expand',
  a: 'alert',
  f: 'fullscreen',
  ',': 'press',
  '.': 'cancel',
}

/**
 * Dev only, in the browser. Each transition has a key and a name for `window.__sumiDemo.trigger(name)`:
 * C call, T timer, D a timer that ends in 3 s, M music (a second activity splits the bubble off, ending
 * it merges it back), P peek the song, N next song, H hover, E open or close, A alert, F fullscreen,
 * comma press and period cancel the press (E releases it into the panel).
 */
export function demo(island: {
  activities: Activity[]
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
  const actions: Record<string, () => void> = {
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
  Object.assign(window, {
    __sumiDemo: { transitions: Object.keys(actions), trigger: (name: string) => actions[name]() },
  })
}

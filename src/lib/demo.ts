import type { Activity } from './activities'

const fakes: Record<string, () => Activity> = {
  c: () => ({ id: 'call', kind: 'call', mic: true, camera: true }),
  t: () => ({ id: 'timer', kind: 'timer', endsAt: Date.now() + 25 * 60_000 }),
  m: () => ({ id: 'music', kind: 'music', title: 'Midnight City', artist: 'M83', color: '#A78BFA' }),
}

/** Dev only, in the browser: C, T and M toggle a fake call, timer and song; P peeks the song. */
export function demo(island: { activities: Activity[]; peek: (id: string) => void }) {
  addEventListener('keydown', ({ key }) => {
    if (key === 'p') return island.peek('music')
    const fake = fakes[key]?.()
    if (!fake) return
    const others = island.activities.filter((a) => a.id !== fake.id)
    island.activities = others.length < island.activities.length ? others : [...others, fake]
  })
}

// The island's motion as CSS, for the website, worked out from these springs so the site moves as Sumi does.
import type { Activity } from './activities'
import { ENTER, EXIT, FULLSCREEN, PRESS, motion, type Axis } from './motion'
import type { View } from './shapes'
import { Spring } from './spring'

/** A spring as a CSS transition: the time it takes to settle, and a `linear()` easing that traces it. */
export function spring([duration, bounce]: Axis): string {
  // Over 100 px the app's spring settles within 0.1 px, close enough to the end for anything on the page.
  const s = new Spring(0)
  s.to(100, duration, bounce, 0)
  const points: [number, number][] = [[0, 0]]
  let t = 0
  while (s.update((t += 1000 / 240))) points.push([t, s.value / 100])
  points.push([t, 1])
  const stops = simplify(points, 0.002).map(([at, v]) => `${round(v, 4)} ${round((at / t) * 100, 2)}%`)
  return `${Math.round(t)}ms linear(${stops.join(', ')})`
}

/** Drops the points a straight line between their neighbours would miss by less than `tolerance`. */
export function simplify(points: [number, number][], tolerance: number): [number, number][] {
  const [[t0, v0], [t1, v1]] = [points[0], points[points.length - 1]]
  let [worst, at] = [0, 0]
  for (let i = 1; i < points.length - 1; i++) {
    const [t, v] = points[i]
    const miss = Math.abs(v - (v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)))
    if (miss > worst) [worst, at] = [miss, i]
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]]
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)]
}

const round = (x: number, digits: number) => +x.toFixed(digits)
const bezier = (easing: readonly number[]) => `cubic-bezier(${easing.join(', ')})`

const song: Activity = { id: 'song', kind: 'music', title: '', artist: '', color: '' }
const timer: Activity = { id: 'timer', kind: 'timer', endsAt: 0 }
const views = {
  idle: { name: 'idle' },
  hover: { name: 'hover' },
  expanded: { name: 'expanded' },
  music: { name: 'compact', activity: song },
  timer: { name: 'compact', activity: timer },
  peek: { name: 'peek', activity: song },
} satisfies Record<string, View>

// Each move of the app's island, width and height apart, named for what it does.
const moves: Record<string, [View, View]> = {
  hover: [views.idle, views.hover],
  unhover: [views.hover, views.idle],
  open: [views.idle, views.expanded],
  close: [views.expanded, views.idle],
  peek: [views.music, views.peek],
  unpeek: [views.peek, views.music],
  grow: [views.timer, views.music],
  shrink: [views.music, views.timer],
}

/** Custom properties for `:root`: each move's width and height, the press, fullscreen, and how content comes and goes. */
export function motionVars(): string {
  const vars: Record<string, string> = {}
  for (const [name, [from, to]] of Object.entries(moves)) {
    const { width, height } = motion(from, to)
    vars[`${name}-w`] = spring(width)
    vars[`${name}-h`] = spring(height)
  }
  vars.press = spring(PRESS.down)
  vars.release = spring(PRESS.up)
  vars['press-scale'] = String(PRESS.scale)
  vars.hide = spring(FULLSCREEN.hide)
  vars['hide-delay'] = `${FULLSCREEN.delay}ms`
  vars.show = spring(FULLSCREEN.show)
  vars.enter = `${ENTER.duration}ms ${bezier(ENTER.easing)}`
  vars['enter-delay'] = `${ENTER.delay}ms`
  vars['enter-stagger'] = `${ENTER.stagger}ms`
  vars['enter-blur'] = `${ENTER.blur}px`
  vars['enter-scale'] = String(ENTER.scale)
  vars.exit = `${EXIT.duration}ms ${bezier(EXIT.easing)}`
  vars['exit-time'] = `${EXIT.duration}ms`
  vars['exit-scale'] = String(1 - EXIT.scale)
  return Object.entries(vars)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('')
}

import type { Activity } from './activities'

/** One player as Rust sends it (src-tauri/src/media.rs). Times are in ms, and `updatedMs` is Unix time. */
export interface Player {
  id: string
  title: string
  artist: string
  playing: boolean
  canPlayPause: boolean
  canNext: boolean
  canPrevious: boolean
  canSeek: boolean
  endMs: number
  positionMs: number
  updatedMs: number
  rate: number
}

/** What `media_players` returns (src-tauri/src/media.rs): the last word from each player, and their artwork by id. */
export interface Snapshot {
  players: Player[]
  artwork: Record<string, string>
}

/** The `media://artwork` payload: a player's artwork as a data: URL, or null once it has none. */
export interface Artwork {
  id: string
  url: string | null
}

/** A paused player keeps its place this long, then the clock comes back. */
export const PAUSED = 60_000
/** A player that vanishes stays this long: some drop their session between two songs. */
export const HOLD = 2_500
/** Tints the equalizer and the progress bar until the artwork gives a colour, or when it has none. */
export const NEUTRAL = '#d4d4d8'

/** What the island knows about players: the last word from each, when each last played, and when each went. */
export interface Players {
  last: Map<string, Player>
  playedAt: Map<string, number>
  goneAt: Map<string, number>
}

export const nobody = (): Players => ({ last: new Map(), playedAt: new Map(), goneAt: new Map() })

/** Takes in what Windows says now. A player first seen paused never played here, so it isn't shown. */
export function update(known: Players, players: readonly Player[], now: number): Players {
  const last = new Map(known.last)
  const playedAt = new Map(known.playedAt)
  const goneAt = new Map(known.goneAt)
  for (const p of players) {
    // Pausing counts as the last moment it played: the minute starts there.
    if (p.playing || last.get(p.id)?.playing) playedAt.set(p.id, now)
    last.set(p.id, p)
    goneAt.delete(p.id)
  }
  const ids = new Set(players.map((p) => p.id))
  for (const id of last.keys()) if (!ids.has(id) && !goneAt.has(id)) goneAt.set(id, now)
  for (const [id, at] of goneAt) {
    if (now - at < HOLD) continue
    last.delete(id)
    playedAt.delete(id)
    goneAt.delete(id)
  }
  return { last, playedAt, goneAt }
}

/** The players the island shows, in Windows' order: those playing, and those paused less than a minute ago. */
export function shown(known: Players, now: number): Player[] {
  return [...known.last.values()].filter((p) => p.playing || now - (known.playedAt.get(p.id) ?? -Infinity) < PAUSED)
}

/** When the list changes on its own next: a pause that runs out, or a player gone for good. */
export function nextChange(known: Players, now: number): number | undefined {
  const paused = [...known.last.values()].filter((p) => !p.playing && known.playedAt.has(p.id))
  const times = [
    ...paused.map((p) => known.playedAt.get(p.id)! + PAUSED),
    ...[...known.goneAt.values()].map((at) => at + HOLD),
  ].filter((t) => t > now)
  return times.length ? Math.min(...times) : undefined
}

/** Whether the song moves on by itself: playing, from a stamped position, forward. */
// Some players never stamp their position: it is then taken as current.
export const advancing = (p: Player) => p.playing && p.updatedMs > 1e12 && p.rate > 0

/** Where the song is at `now`: it moves on by itself while playing, from the last position Windows gave. */
export function position(p: Player, now: number): number {
  const since = advancing(p) ? (now - p.updatedMs) * p.rate : 0
  const at = Math.max(0, p.positionMs + since)
  return p.endMs > 0 ? Math.min(at, p.endMs) : at
}

/** 3:07, or 1:02:07 past an hour. */
export function clockTime(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const [h, m] = [Math.floor(s / 3600), Math.floor(s / 60) % 60]
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The island's music activities, with each player's artwork and colour once they are known. */
export function songs(players: readonly Player[], art: ReadonlyMap<string, { url: string; color?: string }>): Activity[] {
  return players.map((p) => ({
    id: p.id,
    kind: 'music',
    title: p.title,
    artist: p.artist,
    color: art.get(p.id)?.color ?? NEUTRAL,
    art: art.get(p.id)?.url,
    player: p,
  }))
}

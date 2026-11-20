import type { Activity } from './activities'
import type { Lang } from './intent'
import { label, light, type Privacy } from './privacy'

/** What the tray icon's corner shows, as Rust draws it (src-tauri/src/tray.rs): the microphone or camera dot, the
 * music's bars, or nothing. */
export type Badge = 'mic' | 'camera' | 'music' | 'plain'

/** The tray as the page sets it with `set_tray`: the icon's corner, its tooltip and its menu's words. */
export interface Tray {
  badge: Badge
  tip: string
  tuck: string
  quit: string
}

/** The tray's words: its menu's items, as the island is or is about to be, and the tooltip's. */
export const TRAY = {
  fr: { tuck: "Ranger l'île", back: "Faire revenir l'île", quit: 'Quitter Sumi', mic: 'micro :', camera: 'caméra :' },
  en: { tuck: 'Tuck the island', back: 'Bring the island back', quit: 'Quit Sumi', mic: 'microphone:', camera: 'camera:' },
} satisfies Record<Lang, Record<string, string>>

/** Windows keeps a tooltip to 127 characters. */
export const TIP = 127

type Song = Extract<Activity, { kind: 'music' }>

/** A song that plays now, among the island's activities. A paused one stays on the island a minute, not here. */
const playing = (activities: readonly Activity[]) =>
  activities.find((a): a is Song => a.kind === 'music' && a.player?.playing === true)

/** The icon's corner, in the island's order of importance: a device in use, then music that plays. */
export function badge(privacy: Privacy, activities: readonly Activity[]): Badge {
  return light(privacy) ?? (playing(activities) ? 'music' : 'plain')
}

/**
 * What the tooltip says, as the icon shows it: the apps using the device, the song, or the command bar's shortcut,
 * cut to fit Windows.
 */
export function tip(privacy: Privacy, activities: readonly Activity[], keys: readonly string[] | undefined, lang: Lang) {
  const device = light(privacy)
  const song = playing(activities)
  const said = device
    ? `${TRAY[lang][device]} ${label({ ...privacy, apps: privacy.apps.filter((a) => a[device]) })}`
    : (song && [song.title, song.artist].filter(Boolean).join(' – ')) || keys?.join('+')
  const text = said ? `Sumi · ${said}` : 'Sumi'
  // Cut whole characters: never half of an emoji's pair.
  return text.length <= TIP ? text : `${text.slice(0, TIP - 1).replace(/[\uD800-\uDBFF]$/, '')}…`
}

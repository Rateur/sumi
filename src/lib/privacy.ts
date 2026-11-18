/** One app using the microphone, the camera or both, as Rust sends it (src-tauri/src/privacy.rs). */
export interface PrivacyApp {
  name: string
  mic: boolean
  camera: boolean
  /** Unix time, when Sumi first saw it. */
  sinceMs: number
}

export interface Privacy {
  apps: PrivacyApp[]
  muted: boolean
  canMute: boolean
}

export const quiet = (): Privacy => ({ apps: [], muted: false, canMute: false })

/** Apple's rule: green while a camera is on, with or without the microphone, orange for the microphone alone. */
export function light({ apps }: Privacy): 'camera' | 'mic' | undefined {
  if (apps.some((a) => a.camera)) return 'camera'
  if (apps.some((a) => a.mic)) return 'mic'
  return undefined
}

/** Whether the tag beside the island shows at all: a device in use, or a muted microphone not to forget. */
export const tagged = (p: Privacy): boolean => p.apps.length > 0 || (p.canMute && p.muted)

/** What the tag says under the cursor: the app, and how many others. */
export function label({ apps }: Privacy): string {
  if (!apps.length) return ''
  return apps.length > 1 ? `${apps[0].name} +${apps.length - 1}` : apps[0].name
}

/** How long an app has used its device, in the user's language: "12 min", "1 h 5 min". Under a minute, nothing. */
export function lasted(sinceMs: number, now: number, locale?: string): string {
  const minutes = Math.floor(Math.max(0, now - sinceMs) / 60_000)
  if (minutes < 1) return ''
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60]
  const parts = hours ? { hours, minutes: rest } : { minutes }
  return DurationFormat
    ? new DurationFormat(locale, { style: 'short' }).format(parts)
    : hours
      ? `${hours} h ${rest} min`
      : `${minutes} min`
}

// The project's TypeScript lib predates Intl.DurationFormat, which WebView2 has: it is typed here.
const DurationFormat = (
  Intl as unknown as {
    DurationFormat?: new (locale?: string, options?: { style: 'short' }) => { format(parts: object): string }
  }
).DurationFormat

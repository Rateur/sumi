/**
 * What a line typed in the command bar does: a timer, an app or a question. Local rules only, so the same text
 * always gives the same chip, and nothing is sent anywhere while typing. The first rule that matches wins:
 * a timer, an app's exact name or alias, an assistant by name, a verb and an app, then the default target.
 */

export type Lang = 'fr' | 'en'

/** An entry from Start's list. The bar hands back the caller's own object, so it may carry more. */
export interface App {
  name: string
}

/** A running timer, as the bar needs it: `left` is the time left while paused. */
export interface Timer {
  id: string
  endsAt: number
  label?: string
  left?: number
}

export type Assistant = 'claude' | 'chatgpt' | 'gemini' | 'perplexity'
export type Target = Assistant | 'search'

export type Choice<A extends App = App> = { label: string } & (
  | { kind: 'timer'; ms: number; name?: string }
  | { kind: 'add'; id: string; ms: number }
  | { kind: 'pause' | 'resume' | 'stop'; id: string }
  | { kind: 'app'; app: A }
  // `peek` is what the island shows after Enter: 'Claude', or 'Claude · navigateur' when it opens on the web.
  | { kind: 'ask'; to: Target; question: string; web: boolean; peek: string }
)

export interface Options<A extends App> {
  apps: readonly A[]
  lang: Lang
  /** Whether Windows knows the `claude:` link, so Claude opens in its app. */
  claudeApp: boolean
  timers?: readonly Timer[]
  now?: number
  /** The default target first, then the others in the user's order. The search engine always comes last. */
  order?: readonly Assistant[]
}

/**
 * Their links are a fixed table in Rust (`link` in src-tauri/src/apps.rs), which builds them from the question. Only
 * Claude has a documented app link; the others open their website, prefilled and never sent.
 */
export const ASSISTANTS: Record<Target, { name: string; app?: boolean }> = {
  claude: { name: 'Claude', app: true },
  chatgpt: { name: 'ChatGPT' },
  gemini: { name: 'Gemini' },
  perplexity: { name: 'Perplexity' },
  search: { name: 'Google' },
}

const ORDER: Assistant[] = ['claude', 'chatgpt', 'gemini', 'perplexity']

const WORDS = {
  fr: {
    open: 'Ouvrir',
    ask: 'Demander à',
    web: 'navigateur',
    search: 'Rechercher',
    timer: 'Minuteur',
    none: (q: string) => `Aucune app « ${q} »`,
    pause: ['Pause', 'Mettre en pause'],
    resume: ['Reprendre', 'Reprendre'],
    stop: ['Arrêter', 'Arrêter le minuteur'],
  },
  en: {
    open: 'Open',
    ask: 'Ask',
    web: 'browser',
    search: 'Search',
    timer: 'Timer',
    none: (q: string) => `No app "${q}"`,
    pause: ['Pause', 'Pause the timer'],
    resume: ['Resume', 'Resume the timer'],
    stop: ['Stop', 'Stop the timer'],
  },
} as const

// Hand-written aliases, French and English alike: any word of a group finds the app named by another.
const ALIASES = [
  ['parametres', 'settings', 'reglages'],
  ['explorateur de fichiers', 'file explorer', 'explorateur', 'explorer'],
  ['calculatrice', 'calculator', 'calc'],
  ['visual studio code', 'code', 'vscode'],
]

/** Lowercase without accents, one character for one, so a match in the folded text slices the typed one. */
export function fold(text: string): string {
  return Array.from(text, (c) => {
    const f = c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    return f.length === c.length ? f : c
  }).join('')
}

// --- Timers ---

const NUM = String.raw`\d+(?:[.,]\d+)?`
const SEC = 'secondes?|seconds?|secs?|s'
const MIN = 'minutes?|mins?|mn|m'
const HOUR = 'heures?|hours?|hrs?|h'
const UNIT: [RegExp, number][] = [
  [new RegExp(`^(?:${SEC})$`), 1000],
  [new RegExp(`^(?:${MIN})$`), 60_000],
  [new RegExp(`^(?:${HOUR})$`), 3_600_000],
]
// 1h30, 1 h 30, 1h30m, 2m30, 2m30s, 2 min 30, 90s, 1,5h, or a bare number of minutes.
const DURATION = new RegExp(
  String.raw`(?<![\w.,])(?:(${NUM})\s*(${HOUR})(?:\s*(\d+)\s*(?:${MIN})?)?(?:\s*(\d+)\s*(?:${SEC}))?` +
    String.raw`|(${NUM})\s*(${MIN})(?:\s*(\d+)\s*(?:${SEC})?)?|(${NUM})\s*(${SEC})|(\d+))(?![\w.,])`,
)
const KEYWORDS = new Set(['minuteur', 'minuterie', 'timer'])
const GLUE = new Set(['de', 'pour', 'for', 'of', 'a', 'un'])
// A question, a conversion, a stopwatch or a cycle: never a timer.
const QUESTION = /\b(combien|comment|quel|quelle|quels|quelles|pourquoi|how|what|why|convert|convertir)\b|\?/
const CONVERSION = /\b(en|in|to) [a-z]/
const NOT_A_TIMER = /\b(chrono|chronometre|stopwatch|pomodoro)\b/
// A time of day, checked before the accents go: 'à 18h30' is an alarm, 'a' alone is glue.
const TIME_OF_DAY = /(^|\s)(à|at|until|vers|jusqu['’]à|jusqu['’]a)\s*\d/
const HOURS_12 = 12 * 3_600_000

const toMs = (n: string, unit: string) => {
  const per = UNIT.find(([re]) => re.test(unit))![1]
  return Number(n.replace(',', '.')) * per
}

/** A whole line read as a new timer: its length, and its label of at most 3 words. Anything else is no timer. */
export function parseTimer(line: string): { ms: number; label?: string } | undefined {
  const typed = line.trim().replace(/\s+/g, ' ')
  const text = fold(typed)
  if (QUESTION.test(text) || CONVERSION.test(text) || NOT_A_TIMER.test(text) || TIME_OF_DAY.test(typed.toLowerCase()))
    return
  const m = DURATION.exec(text)
  if (!m) return
  const [, h, hu, hm, hs, mn, mu, ms, sn, su, bare] = m
  const n = (s?: string) => (s ? Number(s) : 0)
  const total =
    h !== undefined
      ? toMs(h, hu) + n(hm) * 60_000 + n(hs) * 1000
      : mn !== undefined
        ? toMs(mn, mu) + n(ms) * 1000
        : sn !== undefined
          ? toMs(sn, su)
          : Number(bare) >= 1 && Number(bare) <= 180
            ? Number(bare) * 60_000
            : 0
  if (total < 1000 || total > HOURS_12) return
  // The words around the duration, without the keyword in front and the glue next to it, are its label.
  const words = (s: string) => s.split(' ').filter(Boolean)
  const before = words(typed.slice(0, m.index).replace(/(^|\s)d['’]$/i, ''))
  const after = words(typed.slice(m.index + m[0].length))
  while (before.length && GLUE.has(fold(before.at(-1)!))) before.pop()
  const keyword = before.length > 0 && KEYWORDS.has(fold(before[0]))
  if (keyword) before.shift()
  while (after.length && GLUE.has(fold(after[0]))) after.shift()
  const label = [...before, ...after]
  if (label.length > 3 || label.some((w) => /\d/.test(w) || !/\p{L}/u.test(w) || KEYWORDS.has(fold(w)))) return
  // A bare number with words is a name ('gpt 4', 'windows 11') unless a keyword says it is a timer.
  if (bare !== undefined && label.length && !keyword) return
  return { ms: Math.round(total), label: label.join(' ') || undefined }
}

/** '25 min', '1 h 30', '2 min 30 s', '45 s': unit words, never the raw text, so a misreading shows. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
  if (h) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
  if (m) return sec ? `${m} min ${sec} s` : `${m} min`
  return `${sec} s`
}

/** '+5', 'pause', 'stop pâtes': words that act on a running timer, the one that ends first or the one named. */
function timerAction<A extends App>(line: string, timers: readonly Timer[], now: number, lang: Lang): Choice<A> | undefined {
  const text = fold(line)
  const ends = (t: Timer) => (t.left !== undefined ? now + t.left : t.endsAt)
  const soonest = (list: readonly Timer[], name?: string) =>
    name ? list.find((t) => t.label && fold(t.label) === fold(name)) : list.toSorted((a, b) => ends(a) - ends(b))[0]
  const words = WORDS[lang]
  const add = new RegExp(String.raw`^\+\s*(${NUM})\s*(${SEC}|${MIN}|${HOUR})?$`).exec(text)
  if (add) {
    const ms = toMs(add[1], add[2] ?? 'm')
    const timer = soonest(timers)
    if (!timer || ms < 1000 || ms > HOURS_12) return
    return { kind: 'add', id: timer.id, ms, label: `+${formatDuration(ms)}${timer.label ? ` · ${timer.label}` : ''}` }
  }
  const verb = /^(pause|reprendre|resume|stop|annule|annuler|cancel)(?: (.+))?$/.exec(text)
  if (!verb) return
  const kind = verb[1] === 'pause' ? 'pause' : verb[1] === 'reprendre' || verb[1] === 'resume' ? 'resume' : 'stop'
  const name = verb[2] && line.slice(line.length - verb[2].length)
  const pool = timers.filter((t) => (kind === 'pause' ? t.left === undefined : kind === 'resume' ? t.left !== undefined : true))
  const timer = soonest(pool, name)
  if (!timer) return
  const [verbWord, alone] = words[kind]
  return { kind, id: timer.id, label: timer.label ? `${verbWord} ${timer.label}` : alone }
}

// --- Apps ---

// Exact, then prefix, then the start of a word, then the letters in order. 0 is no match.
function score(query: string, name: string): number {
  if (name === query) return 4
  if (name.startsWith(query)) return 3
  if ((' ' + name).includes(' ' + query)) return 2
  if (query.length < 2) return 0
  let i = 0
  for (const c of name) if (c === query[i]) i++
  return i === query.length ? 1 : 0
}

const keys = (app: App) => {
  const name = fold(app.name)
  return [name, ...(ALIASES.find((group) => group.includes(name))?.filter((k) => k !== name) ?? [])]
}

/** The best app for a query, by a fixed ranking: on a tie the shorter name wins. Usage never reorders it. */
export function findApp<A extends App>(query: string, apps: readonly A[]): A | undefined {
  const q = fold(query.trim())
  return apps
    .map((app) => ({ app, score: Math.max(...keys(app).map((k) => score(q, k))) }))
    .filter((a) => a.score > 0)
    .toSorted((a, b) => b.score - a.score || a.app.name.length - b.app.name.length)[0]?.app
}

// --- Assistants ---

// A question opens in Claude's app when Windows knows its link, on the website otherwise.
function ask<A extends App>(to: Target, question: string, claudeApp: boolean, lang: Lang, label?: string): Choice<A> {
  const words = WORDS[lang]
  const { name, app } = ASSISTANTS[to]
  const web = !(app && claudeApp)
  const action = to === 'search' ? words.search : web ? name : `${words.ask} ${name}`
  return {
    kind: 'ask',
    to,
    question,
    web,
    peek: web ? `${name} · ${words.web}` : name,
    label: label ?? (web ? `${action} · ${words.web}` : action),
  }
}

const BY_NAME =
  /^(?:(?:demander? a |ask )?(claude|chatgpt|gpt|gemini|perplexity|google)|(cherche|recherche|search))[ :,]+(.+)$/
const VERB = /^(?:ouvre|ouvrir|lance|lancer|open|launch|start) (.+)$/

/**
 * What Enter can do with a line, the top guess first, then what Tab reaches: the default assistant, the others
 * in the user's order, then the search engine. An empty line does nothing.
 */
export function choices<A extends App>(line: string, options: Options<A>): Choice<A>[] {
  const { lang, claudeApp, timers = [], now = Date.now(), order = ORDER } = options
  const typed = line.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const text = fold(typed)
  const apps = options.apps.filter((app) => !/\b(uninstall|desinstall)/.test(fold(app.name)))
  const rest = (match: string) => typed.slice(typed.length - match.length)

  // The top guess, and the question the alternatives pass on: a named assistant's own, or the whole line.
  const [top, question] = ((): [Choice<A>, string] => {
    const action = timers.length ? timerAction<A>(typed, timers, now, lang) : undefined
    if (action) return [action, typed]
    const timer = parseTimer(typed)
    if (timer) {
      const label = `${WORDS[lang].timer} ${formatDuration(timer.ms)}${timer.label ? ` · ${timer.label}` : ''}`
      return [{ kind: 'timer', ms: timer.ms, name: timer.label, label }, typed]
    }
    // An exact name comes before the assistants, so 'Google Chrome' opens Chrome rather than searching 'chrome'.
    const named = apps.find((app) => keys(app).includes(text))
    if (named) return [{ kind: 'app', app: named, label: `${WORDS[lang].open} ${named.name}` }, typed]
    const by = BY_NAME.exec(text)
    if (by) {
      const to: Target = by[2] || by[1] === 'google' ? 'search' : by[1] === 'gpt' ? 'chatgpt' : (by[1] as Assistant)
      return [ask(to, rest(by[3]), claudeApp, lang), rest(by[3])]
    }
    const verb = VERB.exec(text)
    if (verb) {
      const app = findApp(verb[1], apps)
      if (app) return [{ kind: 'app', app, label: `${WORDS[lang].open} ${app.name}` }, typed]
      return [ask(order[0], typed, claudeApp, lang, WORDS[lang].none(rest(verb[1]))), typed]
    }
    return [ask(order[0], typed, claudeApp, lang), typed]
  })()

  const all = [top, ...[...order, 'search' as const].map((to) => ask<A>(to, question, claudeApp, lang))]
  const seen = new Set<string>()
  return all.filter((c) => {
    const id = c.kind === 'ask' ? c.to : `${c.kind}:${c.label}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

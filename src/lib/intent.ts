/**
 * What a line typed in the command bar does: a timer, an app, the time or a question. Local rules only, so the same
 * text always gives the same chip, and nothing is sent anywhere while typing. The line is read without politeness
 * or punctuation, then the first rule that matches wins: a timer, an app's exact name or alias, the time or the
 * date, an assistant by name, a search, a verb and an app, then the default target.
 */

import { formatLongDate, formatTime } from './clock'

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
  // The answer is the label itself: 'Il est 11:27' or 'Jeudi 19 novembre'.
  | { kind: 'clock'; what: 'time' | 'date' }
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
  /** The locale of the island's clock; the system's when left out. */
  locale?: string
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
    time: (t: string) => `Il est ${t}`,
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
    time: (t: string) => `It's ${t}`,
    pause: ['Pause', 'Pause the timer'],
    resume: ['Resume', 'Resume the timer'],
    stop: ['Stop', 'Stop the timer'],
  },
} as const

/** Lowercase without accents, one character for one, so a match in the folded text slices the typed one. */
export function fold(text: string): string {
  return Array.from(text, (c) => {
    const f = c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    return f.length === c.length ? f : c
  }).join('')
}

// --- Reading the line ---

// Punctuation outside numbers ('1:30' and '1,5h' keep theirs), and a hyphen between letters ('est-il', 'peux-tu').
const PUNCT = /[?!;«»"“”()]|(?<!\d)[.,:]|[.,:](?!\d)|(?<=\p{L})-(?=\p{L})/gu
// Politeness anywhere, and what opens a request at the start. Matched on the folded line.
const POLITE = /(?<=^| )(?:s'il (?:te|vous) plait|stp|svp|merci(?: beaucoup)?|please|thanks|thank you)(?= |$)/g
const OPENER = new RegExp(
  '^(?:hey sumi|sumi|est ce que|tu peux|tu pourrais|peux tu|pourrais tu|vous pouvez|pouvez vous|pourriez vous|' +
    "can you|could you|would you|je veux|je voudrais|j'aimerais|i want to|i want|i'd like to|i'd like|" +
    'i would like to|i would like|dis moi|dites moi|me dire|tell me)(?= |$)',
  'g',
)

/**
 * The line as the rules read it: one apostrophe, no punctuation that can't matter, no politeness, single spaces.
 * The letters stay as typed, and `at` gives each one's place in the typed line, so a question is cut from what was
 * typed. A line that is only politeness ('merci') stays whole.
 */
export function normalize(typed: string): { text: string; at: number[] } {
  const s = typed.replace(/[’‘ʼ]/g, "'").replace(PUNCT, ' ')
  // UTF-16 places, as fold keeps one unit for one.
  let at = Array.from({ length: s.length }, (_, i) => i)
  const text = () => at.map((i) => s[i]).join('')
  const squeeze = () => {
    at = at.filter((i, k) => s[i] !== ' ' || (k > 0 && s[at[k - 1]] !== ' '))
    while (at.length && s[at.at(-1)!] === ' ') at.pop()
  }
  const cut = (re: RegExp) => {
    const gone = new Set<number>()
    for (const m of fold(text()).matchAll(re)) for (let k = m.index; k < m.index + m[0].length; k++) gone.add(k)
    at = at.filter((_, k) => !gone.has(k))
    return gone.size > 0
  }
  squeeze()
  while (cut(OPENER) || cut(POLITE)) squeeze()
  return at.length ? { text: text(), at } : { text: typed, at: Array.from({ length: typed.length }, (_, i) => i) }
}

// Dropped after a verb: 'ouvre les paramètres', 'open the calculator', 'lance l'explorateur'.
const DET = String.raw`(?:(?:le|la|les|un|une|des|du|de la|mon|ma|mes|ton|ta|tes|the|a|an|my) |l'|d')?`

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
// 'chrono' counts up, so it is a timer only with a unit: 'chrono 5 min', never 'chrono 5'.
const KEYWORDS = new Set(['minuteur', 'minuterie', 'timer', 'chrono', 'chronometre'])
// Glue and determiners around the duration and the label, with their accents: 'thé' is no 'the'.
const EDGE = new Set(
  ['de', "d'", 'pour', 'for', 'of', 'a', 'an', 'un', 'une', 'le', 'la', 'les', "l'", 'des', 'du', 'the', 'my'].concat(
    ['mon', 'ma', 'mes', 'ton', 'ta', 'tes'],
  ),
)
// The verbs that start one: 'mets un minuteur de 10 s', 'set a timer for 5 minutes', 'lance 25m'.
const SET = new RegExp(
  '^(?:mets|met|mettre|mettez|lance|lancer|lancez|demarre|demarrer|demarrez|programme|programmer|regle|regler|' +
    'set|start|make|put) ',
)
// A question, a conversion, a stopwatch or a cycle: never a timer.
const QUESTION = /\b(combien|comment|quel|quelle|quels|quelles|pourquoi|how|what|why|convert|convertir)\b|\?/
const CONVERSION = /\b(en|in|to) [a-z]/
const NOT_A_TIMER = /\b(stopwatch|pomodoro)\b/
// A time of day, checked before the accents go: 'à 18h30' is an alarm, 'a' alone is glue.
const TIME_OF_DAY = /(^|\s)(à|at|until|vers|jusqu['’]à|jusqu['’]a)\s*\d/
const HOURS_12 = 12 * 3_600_000

const toMs = (n: string, unit: string) => {
  const per = UNIT.find(([re]) => re.test(unit))![1]
  return Number(n.replace(',', '.')) * per
}

/** A whole line read as a new timer: its length, and its label of at most 3 words. Anything else is no timer. */
export function parseTimer(line: string): { ms: number; label?: string } | undefined {
  const raw = line.trim().replace(/\s+/g, ' ')
  const folded = fold(raw)
  if (QUESTION.test(folded) || CONVERSION.test(folded) || NOT_A_TIMER.test(folded) || TIME_OF_DAY.test(raw.toLowerCase()))
    return
  let typed = normalize(raw).text
  typed = typed.slice(SET.exec(fold(typed))?.[0].length ?? 0)
  const text = fold(typed)
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
  // The words around the duration, without the keyword and the glue next to them, are its label.
  const words = (s: string) => s.split(' ').filter(Boolean)
  const before = words(typed.slice(0, m.index).replace(/(^|\s)d'$/i, ''))
  const after = words(typed.slice(m.index + m[0].length))
  const trim = (list: string[]) => {
    while (list.length && EDGE.has(list[0].toLowerCase())) list.shift()
    while (list.length && EDGE.has(list.at(-1)!.toLowerCase())) list.pop()
  }
  trim(before)
  trim(after)
  // In front ('minuteur 10'), or behind in English ('10 minute timer').
  const isKeyword = (w = '') => KEYWORDS.has(fold(w))
  const keyword = isKeyword(before[0]) ? before.shift() : isKeyword(after[0]) ? after.shift() : undefined
  trim(before)
  trim(after)
  const label = [...before, ...after]
  if (label.length > 3 || label.some((w) => /\d/.test(w) || !/\p{L}/u.test(w) || KEYWORDS.has(fold(w)))) return
  // A bare number with words is a name ('gpt 4', 'windows 11') unless a keyword says it is a timer.
  if (bare !== undefined && ((label.length && !keyword) || fold(keyword ?? '').startsWith('chrono'))) return
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

/** How names compare: folded, without apostrophes or hyphens, each word without a plural s or x. */
export function key(name: string): string {
  return fold(name)
    .replace(/['’]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .join(' ')
}

// Hand-written aliases, French and English alike: any word of a group finds the app named by another.
const ALIASES = [
  ['parametres', 'settings', 'reglages', 'preferences', 'options'],
  ['explorateur de fichiers', 'file explorer', 'explorateur', 'explorer', 'fichiers', 'mes fichiers', 'files'],
  ['calculatrice', 'calculator', 'calc'],
  ['visual studio code', 'code', 'vscode'],
].map((group) => group.map(key))

// Optimal string alignment: a wrong, missing or extra letter, or two swapped neighbors, is one typo.
function typos(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

// Exact, then prefix, then the start of a word, then the letters in order, then a typo or two. 0 is no match.
function score(query: string, name: string): number {
  if (name === query) return 4
  if (name.startsWith(query)) return 3
  if ((' ' + name).includes(' ' + query)) return 2
  if (query.length < 2) return 0
  let i = 0
  for (const c of name) if (c === query[i]) i++
  if (i === query.length) return 1
  // Only on a name long enough to tell: one typo from 5 letters, two from 9. Against the name, its start, or a word.
  const allowed = query.length >= 9 ? 2 : query.length >= 5 ? 1 : 0
  const near = [name, name.slice(0, query.length), ...name.split(' ')].some((w) => typos(query, w) <= allowed)
  return allowed && near ? 0.5 : 0
}

const keys = (app: App) => {
  const name = key(app.name)
  return [name, ...(ALIASES.find((group) => group.includes(name))?.filter((k) => k !== name) ?? [])]
}

/** The best app for a query, by a fixed ranking: on a tie the shorter name wins. Usage never reorders it. */
export function findApp<A extends App>(query: string, apps: readonly A[]): A | undefined {
  const q = key(query)
  if (!q) return
  return apps
    .map((app) => ({ app, score: Math.max(...keys(app).map((k) => score(q, k))) }))
    .filter((a) => a.score > 0)
    .toSorted((a, b) => b.score - a.score || a.app.name.length - b.app.name.length)[0]?.app
}

// --- The time and the date ---

// Whole lines only, so 'quelle heure est-il à Tokyo' stays a question.
const TIME = new RegExp(
  "^(?:(?:il est |c'est )?quel(?:le)? heure(?: (?:est(?: | t'| t )il|il est|c'est|est ce))?|l'heure|heure|" +
    "what time is it|what time it is|what(?:'s| is) the time|whats the time|(?:the |current )?time)$",
)
const DATE = new RegExp(
  "^(?:(?:on est |c'est )?quel jour(?: (?:sommes nous|nous sommes|on est|est on|est il|c'est|est ce))?|" +
    "(?:on est|nous sommes) le combien|quelle date(?: (?:sommes nous|on est|est on))?|" +
    "(?:la )?date(?: d'aujourd'hui)?|what day is it|what day is today|" +
    "what(?:'s| is) (?:the|today's) date(?: today)?|whats the date|(?:the |today's )?date)$",
)

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

// The verbs, as lemmas: each inflection a person types leads to one intent.
const BY_NAME = new RegExp(
  '^(?:(?:demande|demander|demandez|pose|poser|ask|tell)(?: (?:la|une|ma|the|a|my) question)?(?: (?:a|to))? )?' +
    '(claude|chatgpt|gpt|gemini|perplexity|google) (.+)$',
)
const SEARCH = /^(?:cherche|chercher|recherche|rechercher|trouve|trouver|search|look up|find)(?: moi)? (.+)$/
// The first group says no app aloud; 'montre' or 'show' without an app is just a question.
const VERB = new RegExp(
  '^(?:(ouvre|ouvres|ouvrez|ouvrir|lance|lancer|lancez|demarre|demarrer|demarrez|open|launch|start)|' +
    `affiche|afficher|montre|montrer|show|run) ${DET}(.+)$`,
)

/**
 * What Enter can do with a line, the top guess first, then what Tab reaches: the default assistant, the others
 * in the user's order, then the search engine. An empty line does nothing.
 */
export function choices<A extends App>(line: string, options: Options<A>): Choice<A>[] {
  const { lang, claudeApp, timers = [], now = Date.now(), locale, order = ORDER } = options
  const typed = line.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!typed) return []
  const read = normalize(typed)
  const text = fold(read.text)
  const apps = options.apps.filter((app) => !/\b(uninstall|desinstall)/.test(fold(app.name)))
  // The end of the line a rule matched, as typed for a question, as read for a label.
  const rest = (match: string) => typed.slice(read.at[read.text.length - match.length])
  const tail = (match: string) => read.text.slice(read.text.length - match.length)
  const open = (app: A): Choice<A> => ({ kind: 'app', app, label: `${WORDS[lang].open} ${app.name}` })

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
    const named = apps.find((app) => keys(app).includes(key(read.text)))
    if (named) return [open(named), typed]
    if (TIME.test(text)) {
      return [{ kind: 'clock', what: 'time', label: WORDS[lang].time(formatTime(new Date(now), locale)) }, typed]
    }
    if (DATE.test(text)) {
      const day = formatLongDate(new Date(now), locale)
      return [{ kind: 'clock', what: 'date', label: day[0].toUpperCase() + day.slice(1) }, typed]
    }
    const by = BY_NAME.exec(text)
    if (by) {
      const to: Target = by[1] === 'google' ? 'search' : by[1] === 'gpt' ? 'chatgpt' : (by[1] as Assistant)
      return [ask(to, rest(by[2]), claudeApp, lang), rest(by[2])]
    }
    const search = SEARCH.exec(text)
    if (search) return [ask('search', rest(search[1]), claudeApp, lang), rest(search[1])]
    const verb = VERB.exec(text)
    if (verb) {
      const app = findApp(verb[2], apps)
      if (app) return [open(app), typed]
      if (verb[1]) return [ask(order[0], typed, claudeApp, lang, WORDS[lang].none(tail(verb[2]))), typed]
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

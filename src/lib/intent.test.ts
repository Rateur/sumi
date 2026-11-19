import { describe, expect, it } from 'vitest'
import { choices, findApp, formatDuration, handOff, parseTimer, type App, type Timer } from './intent'

const names = ['Discord', 'Spotify', 'Steam', 'Visual Studio Code', 'Google Chrome', 'Paramètres', 'Explorateur de fichiers']
const apps: App[] = [...names, 'Calculatrice', 'Microsoft Teams', 'Claude', 'Notes', 'Mail'].map((name) => ({ name }))
const fr = { apps, lang: 'fr', claudeApp: true } as const
const en = { ...fr, lang: 'en', claudeApp: false } as const
const top = (line: string, options: Parameters<typeof choices>[1] = fr) => choices(line, options)[0]
const labels = (line: string, options: Parameters<typeof choices>[1] = fr) => choices(line, options).map((c) => c.label)

describe('parseTimer', () => {
  const minutes = (n: number) => n * 60_000
  const accepted: [string, number, string?][] = [
    ['25m', minutes(25)],
    ['25 min', minutes(25)],
    ['25mn', minutes(25)],
    ['25 minutes', minutes(25)],
    ['90s', 90_000],
    ['45 secondes', 45_000],
    ['1h', minutes(60)],
    ['2 heures', minutes(120)],
    ['1 hour', minutes(60)],
    ['1h30', minutes(90)],
    ['1h30m', minutes(90)],
    ['1 h 30', minutes(90)],
    ['1,5h', minutes(90)],
    ['1.5h', minutes(90)],
    ['2m30', 150_000],
    ['2m30s', 150_000],
    ['2 min 30', 150_000],
    ['10', minutes(10)],
    ['timer 10', minutes(10)],
    ['minuteur 10', minutes(10)],
    ['minuteur de 10 min', minutes(10)],
    ['timer for 10 minutes', minutes(10)],
    ['25m pâtes', minutes(25), 'pâtes'],
    ['pâtes 25m', minutes(25), 'pâtes'],
    ['thé 3 min', minutes(3), 'thé'],
    ['10 min laundry', minutes(10), 'laundry'],
    ['minuteur lessive 45', minutes(45), 'lessive'],
  ]
  it.each(accepted)('reads %s', (line, ms, label) => {
    expect(parseTimer(line)).toEqual({ ms, label })
  })

  const rejected = [
    '25m en pieds',
    '25m in feet',
    'combien de temps pour cuire des pâtes 10 min ?',
    '1:30',
    'à 18h30',
    'at 6pm',
    'until 18:30',
    "jusqu'à 18h",
    '18h30',
    '13h',
    '0',
    '0m',
    '0s',
    '2025',
    '25m de pâtes al dente pour quatre',
    'pomodoro',
    'chrono 5',
    '+5',
    'pause',
    'stop',
  ]
  it.each(rejected)('leaves %s to the assistant', (line) => {
    expect(parseTimer(line)).toBeUndefined()
  })

  it('takes 1 s to 12 h, and a bare number up to 180 min', () => {
    expect(parseTimer('1s')?.ms).toBe(1000)
    expect(parseTimer('12h')?.ms).toBe(12 * 3_600_000)
    expect(parseTimer('180')?.ms).toBe(minutes(180))
    expect(parseTimer('181')).toBeUndefined()
  })
})

describe('formatDuration', () => {
  it('uses unit words', () => {
    expect(formatDuration(25 * 60_000)).toBe('25 min')
    expect(formatDuration(90 * 60_000)).toBe('1 h 30')
    expect(formatDuration(150_000)).toBe('2 min 30 s')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(3_600_000)).toBe('1 h')
  })
})

describe('choices', () => {
  it('does nothing on an empty line', () => {
    expect(choices('  ', fr)).toEqual([])
  })

  it('starts a timer, in either language', () => {
    expect(top('25m')).toMatchObject({ kind: 'timer', ms: 25 * 60_000, label: 'Minuteur 25 min' })
    expect(top('10 min pâtes', en)).toMatchObject({ kind: 'timer', name: 'pâtes', label: 'Timer 10 min · pâtes' })
  })

  it('opens an app after a verb, with a fuzzy match', () => {
    expect(top('ouvre disc')).toMatchObject({ kind: 'app', app: { name: 'Discord' }, label: 'Ouvrir Discord' })
    expect(top('open spot', en)).toMatchObject({ kind: 'app', label: 'Open Spotify' })
    expect(top('lance vsc')).toMatchObject({ kind: 'app', label: 'Ouvrir Visual Studio Code' })
  })

  it('says when no app matches, and keeps the default target for Enter', () => {
    expect(top('ouvre zzz')).toMatchObject({ kind: 'ask', to: 'claude', label: 'Aucune app « zzz »' })
    expect(top('open zzz', en)).toMatchObject({ kind: 'ask', to: 'claude', label: 'No app "zzz"' })
  })

  it('opens an app by its exact name or an alias, French and English alike', () => {
    expect(top('discord')).toMatchObject({ kind: 'app', label: 'Ouvrir Discord' })
    expect(top('settings')).toMatchObject({ kind: 'app', label: 'Ouvrir Paramètres' })
    expect(top('réglages')).toMatchObject({ kind: 'app', label: 'Ouvrir Paramètres' })
    expect(top('code')).toMatchObject({ kind: 'app', label: 'Ouvrir Visual Studio Code' })
    expect(top('calc')).toMatchObject({ kind: 'app', label: 'Ouvrir Calculatrice' })
    expect(top('explorer')).toMatchObject({ kind: 'app', label: 'Ouvrir Explorateur de fichiers' })
    // The name alone is the app, not an empty question.
    expect(top('claude')).toMatchObject({ kind: 'app', label: 'Ouvrir Claude' })
    expect(top('Google Chrome')).toMatchObject({ kind: 'app', label: 'Ouvrir Google Chrome' })
  })

  it('matches a bare name exactly only', () => {
    expect(top('disc')).toMatchObject({ kind: 'ask', to: 'claude' })
  })

  it('asks an assistant by name, with the rest as the question', () => {
    expect(top('claude quoi de neuf')).toMatchObject({ kind: 'ask', to: 'claude', label: 'Demander à Claude', peek: 'Claude' })
    expect(top('demande à Claude: Quoi ?')).toMatchObject({ url: 'claude://claude.ai/new?q=Quoi%20%3F' })
    expect(top('ask gpt hello', en)).toMatchObject({ to: 'chatgpt', url: 'https://chatgpt.com/?q=hello' })
    expect(top('gemini météo')).toMatchObject({ to: 'gemini', label: 'Gemini · navigateur' })
    expect(top('cherche chats')).toMatchObject({ to: 'search', label: 'Rechercher · navigateur' })
    expect(top('google chats', en)).toMatchObject({ to: 'search', label: 'Search · browser', peek: 'Google · browser' })
  })

  it('opens Claude on the web when its app is missing, and says so', () => {
    expect(top('claude hi', en)).toMatchObject({ web: true, label: 'Claude · browser', peek: 'Claude · browser' })
    expect(top('qui a écrit Candide')).toMatchObject({ url: 'claude://claude.ai/new?q=qui%20a%20%C3%A9crit%20Candide' })
  })

  it('puts the question one Tab away from a guessed app', () => {
    expect(labels('notes')).toEqual([
      'Ouvrir Notes',
      'Demander à Claude',
      'ChatGPT · navigateur',
      'Gemini · navigateur',
      'Perplexity · navigateur',
      'Rechercher · navigateur',
    ])
  })

  it('passes a named question on to the alternatives, once each', () => {
    const list = choices('perplexity pourquoi le ciel est bleu', en)
    expect(list.map((c) => c.kind === 'ask' && c.to)).toEqual(['perplexity', 'claude', 'chatgpt', 'gemini', 'search'])
    expect(list[1]).toMatchObject({ url: 'https://claude.ai/new?q=pourquoi%20le%20ciel%20est%20bleu' })
  })

  it('follows the user order for the default target', () => {
    expect(top('bonjour', { ...fr, order: ['chatgpt', 'claude'] })).toMatchObject({ to: 'chatgpt' })
  })

  it('leaves out uninstallers', () => {
    const list = [{ name: 'Uninstall Discord' }, { name: 'Discord' }]
    expect(top('ouvre disc', { ...fr, apps: list })).toMatchObject({ app: { name: 'Discord' } })
    expect(top('ouvre uninst', { ...fr, apps: list })).toMatchObject({ kind: 'ask' })
  })

  describe('with a timer running', () => {
    const timers: Timer[] = [
      { id: 'a', endsAt: 20 * 60_000, label: 'pâtes' },
      { id: 'b', endsAt: 5 * 60_000 },
    ]
    const running = { ...fr, timers, now: 0 }

    it('adds time to the one that ends first', () => {
      expect(top('+5', running)).toMatchObject({ kind: 'add', id: 'b', ms: 5 * 60_000, label: '+5 min' })
      expect(top('+1 min', running)).toMatchObject({ kind: 'add', ms: 60_000 })
    })

    it('pauses, resumes and stops, by name too', () => {
      expect(top('pause', running)).toMatchObject({ kind: 'pause', id: 'b', label: 'Mettre en pause' })
      expect(top('stop pâtes', running)).toMatchObject({ kind: 'stop', id: 'a', label: 'Arrêter pâtes' })
      expect(top('annule', running)).toMatchObject({ kind: 'stop', id: 'b' })
      expect(top('resume', running)).toMatchObject({ kind: 'ask' })
      const paused = { ...running, timers: [{ ...timers[0], left: 60_000 }] }
      expect(top('reprendre', paused)).toMatchObject({ kind: 'resume', id: 'a', label: 'Reprendre pâtes' })
    })

    it('sends a name it does not know to the assistant', () => {
      expect(top('stop riz', running)).toMatchObject({ kind: 'ask' })
    })
  })
})

describe('findApp', () => {
  it('ranks exact, prefix, word start, then letters in order, the shorter name first', () => {
    const list = ['Steam', 'Steam VR', 'Microsoft Teams', 'Notepad'].map((name) => ({ name }))
    expect(findApp('steam', list)?.name).toBe('Steam')
    expect(findApp('ste', list)?.name).toBe('Steam')
    expect(findApp('teams', list)?.name).toBe('Microsoft Teams')
    expect(findApp('ntpd', list)?.name).toBe('Notepad')
    expect(findApp('x', list)).toBeUndefined()
  })
})

describe('handOff', () => {
  it('cuts a long question for Claude', () => {
    expect(handOff('claude', 'a'.repeat(20_000), true).url).toHaveLength('claude://claude.ai/new?q='.length + 14_000)
  })
})

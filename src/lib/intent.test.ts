import { describe, expect, it } from 'vitest'
import { choices, findApp, formatDuration, normalize, parseTimer, type App, type Choice, type Timer } from './intent'

const names = ['Discord', 'Spotify', 'Steam', 'Visual Studio Code', 'Google Chrome', 'Paramètres', 'Explorateur de fichiers']
// Word and Time Doctor sit one typo from 'world' and 'timer': they must not catch them.
const others = ['Calculatrice', 'Microsoft Teams', 'Claude', 'Notes', 'Mail', 'Word', 'Time Doctor']
const apps: App[] = [...names, ...others].map((name) => ({ name }))
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
    'gpt 4',
    'windows 11',
    'claude 3',
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

  it('keeps the label without its glue, accents included', () => {
    expect(parseTimer('un minuteur de 10 min pour les pâtes')).toEqual({ ms: 600_000, label: 'pâtes' })
    expect(parseTimer('set a timer for 5 minutes for the pasta')).toEqual({ ms: 300_000, label: 'pasta' })
  })

  // Test data only, after a timer keyword: Duckling's Duration corpora (Duckling/Duration/FR and EN/Corpus.hs,
  // github.com/facebook/duckling, BSD-3-Clause, Copyright (c) Facebook, Inc. and its affiliates), and the French
  // DurationParser spec of Recognizers-Text (github.com/microsoft/Recognizers-Text, MIT, Copyright (c) Microsoft).
  const s = 1000
  const min = 60_000
  const spelled: [string, number][] = [
    ['une sec', 1 * s],
    ['1 seconde', 1 * s],
    ['2 mins', 2 * min],
    ['deux minutes', 2 * min],
    ['one sec', 1 * s],
    ['1 second', 1 * s],
    ['two minutes', 2 * min],
    ['2m', 2 * min],
    ['2 m', 2 * min],
    ['half an hour', 30 * min],
    ['half hour', 30 * min],
    ['an hour and a half', 90 * min],
    ['one hour and half', 90 * min],
    ['1 hour thirty', 90 * min],
    ['1 hour and thirty', 90 * min],
    ['1.5 hours', 90 * min],
    ['1.5 hrs', 90 * min],
    ['1 hour fifteen', 75 * min],
    ['1 hour and fifteen', 75 * min],
    ['2 hours ten', 130 * min],
    ['2 hour and 10', 130 * min],
    ['1 hour fifteen seconds', 3615 * s],
    ['1 hour and fifteen seconds', 3615 * s],
    ['5 and a half minutes', 330 * s],
    ['five and half min', 330 * s],
    ['5 and an half minute', 330 * s],
    ['an hour and 45 minutes', 105 * min],
    ['one hour and 45 minutes', 105 * min],
    ['a minute and 30 seconds', 90 * s],
    ['one minute and 30 seconds', 90 * s],
    ['an hour and 30 seconds', 3630 * s],
    ['15.5 minutes', 930 * s],
    ['15.5 min', 930 * s],
    ['3h', 180 * min],
    ['3 heures', 180 * min],
    ['3 hrs', 180 * min],
    ['3 min', 3 * min],
    ['3,5 seconde', 3.5 * s],
    ['123,45 sec', 123.45 * s],
    ['vingt min', 20 * min],
    ['une heure', 60 * min],
    ['3-min', 3 * min],
    ['30-minutes', 30 * min],
    ['un et demi heures', 90 * min],
    ['une et demi heure', 90 * min],
    ['demi heure', 30 * min],
    ['deux heures', 120 * min],
    ['deux et demi heures', 150 * min],
    ['2 heures 50 minutes', 170 * min],
    ['trois heures', 180 * min],
    ['trois secondes et demi', 3.5 * s],
    ['une heure et demie', 90 * min],
    ['demi-heure', 30 * min],
    ['deux heures et demie', 150 * min],
  ]
  it.each(spelled)('reads the spelled duration in minuteur %s', (line, ms) => {
    expect(parseTimer(`minuteur ${line}`)?.ms).toBe(ms)
  })

  it('needs a timer word for a lone article, so a phrase stays a phrase', () => {
    expect(parseTimer('une minute')).toBeUndefined()
    expect(parseTimer('wait a minute')).toBeUndefined()
    expect(parseTimer('minuteur d’une minute')?.ms).toBe(min)
    expect(parseTimer('set a timer for a minute')?.ms).toBe(min)
    expect(parseTimer('dix minutes')?.ms).toBe(10 * min)
  })

  it('is no timer when said in the negative', () => {
    expect(parseTimer('ne mets pas de minuteur de 10 min')).toBeUndefined()
    expect(parseTimer("don't set a timer for 5 minutes")).toBeUndefined()
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

  it('reads a bare name as typed: politeness only helps a verb', () => {
    for (const line of ['merci claude', 'dis-moi claude', 'sumi claude', 'est-ce que discord ?', 'claude stp'])
      expect(top(line)).toMatchObject({ kind: 'ask', label: 'Demander à Claude' })
    expect(top('stp ouvre claude')).toMatchObject({ kind: 'app', label: 'Ouvrir Claude' })
  })

  it('reads a verb said in the negative as a question', () => {
    for (const line of ['cherche pas', "n'ouvre pas discord", 'ne lance jamais steam', 'lance rien'])
      expect(top(line)).toMatchObject({ kind: 'ask', label: 'Demander à Claude' })
    for (const line of ["don't open spotify", 'do not launch steam', 'never open discord'])
      expect(top(line, en)).toMatchObject({ kind: 'ask', label: 'Claude · browser' })
  })

  it('asks an assistant by name, with the rest as the question', () => {
    expect(top('claude quoi de neuf')).toMatchObject({ kind: 'ask', to: 'claude', label: 'Demander à Claude', peek: 'Claude' })
    expect(top('demande à Claude: Quoi ?')).toMatchObject({ question: 'Quoi ?', web: false })
    expect(top('ask gpt hello', en)).toMatchObject({ to: 'chatgpt', question: 'hello', web: true })
    expect(top('gemini météo')).toMatchObject({ to: 'gemini', label: 'Gemini · navigateur' })
    expect(top('cherche chats')).toMatchObject({ to: 'search', label: 'Rechercher · navigateur' })
    expect(top('google chats', en)).toMatchObject({ to: 'search', label: 'Search · browser', peek: 'Google · browser' })
  })

  it('opens Claude on the web when its app is missing, and says so', () => {
    expect(top('claude hi', en)).toMatchObject({ web: true, label: 'Claude · browser', peek: 'Claude · browser' })
    expect(top('qui a écrit Candide')).toMatchObject({ question: 'qui a écrit Candide', web: false })
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
    expect(list[1]).toMatchObject({ to: 'claude', question: 'pourquoi le ciel est bleu', web: true })
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

describe('normalize', () => {
  it('drops politeness and punctuation, and keeps the letters as typed', () => {
    expect(normalize('Hey Sumi, peux-tu ouvrir Spotify stp ?').text).toBe('ouvrir Spotify')
    expect(normalize('Est-ce que tu peux ouvrir Discord, s’il te plaît !').text).toBe('ouvrir Discord')
    expect(normalize('1:30 ou 1,5h.').text).toBe('1:30 ou 1,5h')
    expect(normalize('merci').text).toBe('merci')
  })

  it('maps what it keeps back to the typed line', () => {
    const typed = 'stp, claude : quoi ?'
    const { text, at } = normalize(typed)
    expect(text).toBe('claude quoi')
    expect(typed.slice(at[text.indexOf('quoi')])).toBe('quoi ?')
  })
})

// Real phrasings, typos and missing accents included. Each gives one chip: [line, kind, what it targets].
describe('natural phrasing', () => {
  const now = new Date(2026, 10, 19, 11, 27).getTime()
  const options = { ...fr, now, locale: 'fr-FR' }
  const target = (c: Choice) =>
    c.kind === 'app' ? c.app.name : c.kind === 'ask' ? c.to : c.kind === 'timer' ? c.ms : c.kind === 'clock' ? c.what : ''
  const s = 1000
  const min = 60_000
  const table: [string, Choice['kind'], string | number][] = [
    // The maintainer's four.
    ['met un minuteur de 10s', 'timer', 10 * s],
    ["quelle heure est t'il", 'clock', 'time'],
    ['ouvre discord', 'app', 'Discord'],
    ['ouvre les parametre', 'app', 'Paramètres'],
    // Apps, with verbs, determiners, politeness and typos.
    ['ouvre dicord', 'app', 'Discord'],
    ['lance spotifi', 'app', 'Spotify'],
    ['Ouvre Discord !', 'app', 'Discord'],
    ['ouvrir discord stp', 'app', 'Discord'],
    ['tu peux ouvrir discord ?', 'app', 'Discord'],
    ['peux-tu lancer spotify', 'app', 'Spotify'],
    ['Hey Sumi, ouvre Spotify', 'app', 'Spotify'],
    ['sumi lance steam', 'app', 'Steam'],
    ['ouvrez les paramètres', 'app', 'Paramètres'],
    ['ouvre mes reglages', 'app', 'Paramètres'],
    ['ouvre les préférences', 'app', 'Paramètres'],
    ['open settings please', 'app', 'Paramètres'],
    ['open the options', 'app', 'Paramètres'],
    ['parametre', 'app', 'Paramètres'],
    ["ouvre l'explorateur", 'app', 'Explorateur de fichiers'],
    ['ouvre l’explorateur de fichier', 'app', 'Explorateur de fichiers'],
    ['ouvre mes fichiers', 'app', 'Explorateur de fichiers'],
    ['open file explorer', 'app', 'Explorateur de fichiers'],
    ['files', 'app', 'Explorateur de fichiers'],
    ['open the calculator', 'app', 'Calculatrice'],
    ['lance la calculatrice', 'app', 'Calculatrice'],
    ['calc', 'app', 'Calculatrice'],
    ['ouvre code', 'app', 'Visual Studio Code'],
    ['ouvre chorme', 'app', 'Google Chrome'],
    ['démarre steam', 'app', 'Steam'],
    ['start teams', 'app', 'Microsoft Teams'],
    ['launch discrod', 'app', 'Discord'],
    ['can you open spotify', 'app', 'Spotify'],
    ["i'd like to open discord", 'app', 'Discord'],
    ['affiche les notes', 'app', 'Notes'],
    ['show mail', 'app', 'Mail'],
    ['run spotify', 'app', 'Spotify'],
    ['ouvre teans', 'app', 'Microsoft Teams'],
    ['ouvre word', 'app', 'Word'],
    ['ouvre parametr', 'app', 'Paramètres'],
    ['ouvre prmtr', 'app', 'Paramètres'],
    ['ouvre vsc', 'app', 'Visual Studio Code'],
    ['open time doc', 'app', 'Time Doctor'],
    // Timers.
    ['mets un minuteur de 10 min', 'timer', 10 * min],
    ['mettre un minuteur de 5 minutes', 'timer', 5 * min],
    ['lance un minuteur de 25 min', 'timer', 25 * min],
    ['un minuteur de 10 min pour les pates', 'timer', 10 * min],
    ['un minuteur de 10 min pour les pâtes', 'timer', 10 * min],
    ['minuteur 10s', 'timer', 10 * s],
    ['programme une minuterie de 1h30', 'timer', 90 * min],
    ['regle un minuteur de 3 min stp', 'timer', 3 * min],
    ['set a timer for 5 minutes', 'timer', 5 * min],
    ['start a 5 minute timer', 'timer', 5 * min],
    ['timer for 20 minutes', 'timer', 20 * min],
    ['10 min timer', 'timer', 10 * min],
    ['make a 2 min timer please', 'timer', 2 * min],
    ['chrono 30 s', 'timer', 30 * s],
    ['25m', 'timer', 25 * min],
    // The time and the date.
    ['quelle heure est-il ?', 'clock', 'time'],
    ['Quelle heure il est', 'clock', 'time'],
    ['il est quelle heure', 'clock', 'time'],
    ["l'heure", 'clock', 'time'],
    ['heure', 'clock', 'time'],
    ['what time is it?', 'clock', 'time'],
    ["what's the time", 'clock', 'time'],
    ['time', 'clock', 'time'],
    ['quel jour sommes-nous ?', 'clock', 'date'],
    ['on est quel jour', 'clock', 'date'],
    ['quelle date', 'clock', 'date'],
    ['la date', 'clock', 'date'],
    ['what day is it', 'clock', 'date'],
    ["what's the date?", 'clock', 'date'],
    ['date', 'clock', 'date'],
    // Assistants and the search engine, by verb.
    ['demande à claude pourquoi le ciel est bleu', 'ask', 'claude'],
    ['demander a chatgpt une recette', 'ask', 'chatgpt'],
    ['pose la question à gemini : quoi de neuf', 'ask', 'gemini'],
    ['ask perplexity who won', 'ask', 'perplexity'],
    ['tell claude a joke', 'ask', 'claude'],
    ['cherche des chaussures', 'ask', 'search'],
    ['recherche météo lyon', 'ask', 'search'],
    ['trouve-moi un resto', 'ask', 'search'],
    ['look up the eiffel tower', 'ask', 'search'],
    ['google chats', 'ask', 'search'],
    // Questions that must stay questions.
    ['combien de temps pour cuire des pates ?', 'ask', 'claude'],
    ['pourquoi le ciel est bleu', 'ask', 'claude'],
    ['ouvre-moi ton coeur', 'ask', 'claude'],
    ['timer', 'ask', 'claude'],
    ['10 pates', 'ask', 'claude'],
    ['chrono 5', 'ask', 'claude'],
    ['lance le chrono', 'ask', 'claude'],
    ['quelle heure est-il à Tokyo ?', 'ask', 'claude'],
    ['what time is the match tonight', 'ask', 'claude'],
    ['show me how to cook rice', 'ask', 'claude'],
    ['set the volume to 10', 'ask', 'claude'],
    ['merci', 'ask', 'claude'],
    ['1:30', 'ask', 'claude'],
    ['à 18h30', 'ask', 'claude'],
    // One typo from a short word of a name, or its letters scattered inside a long one.
    ['start a timer', 'ask', 'claude'],
    ['ouvre world', 'ask', 'claude'],
    ['ouvre la porte', 'ask', 'claude'],
    ['ouvre la fenetre', 'ask', 'claude'],
    ['ouvre la ame', 'ask', 'claude'],
    ['open the door', 'ask', 'claude'],
  ]
  it.each(table)('%s → %s %s', (line, kind, to) => {
    const c = choices(line, options)[0]
    expect(c.kind).toBe(kind)
    expect(target(c)).toBe(to)
  })

  it('answers the time and the date on the chip, in the clock locale', () => {
    const en = { ...options, lang: 'en', locale: 'en-US' } as const
    expect(choices('quelle heure est-il', options)[0].label).toBe('Il est 11:27')
    expect(choices('what time is it', en)[0].label).toMatch(/^It's 11:27\sAM$/)
    expect(choices('quel jour on est', options)[0].label).toBe('Jeudi 19 novembre')
    expect(choices('date', en)[0].label).toBe('Thursday, November 19')
  })

  it('keeps the question one Tab away, as typed', () => {
    expect(choices('quelle heure est-il ?', options)[1]).toMatchObject({ to: 'claude', question: 'quelle heure est-il ?' })
    expect(choices('stp demande à claude : pourquoi ?', options)[0]).toMatchObject({ question: 'pourquoi ?' })
  })

  it('names what it could not find as it was read', () => {
    expect(choices('ouvre zzz stp', options)[0]).toMatchObject({ kind: 'ask', label: 'Aucune app « zzz »' })
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

  it('reads plurals, accents and typos, typos last', () => {
    const list = ['Paramètres', 'Spotify', 'Discord', 'Disco Elysium'].map((name) => ({ name }))
    expect(findApp('parametre', list)?.name).toBe('Paramètres')
    expect(findApp('spotifi', list)?.name).toBe('Spotify')
    expect(findApp('disco', list)?.name).toBe('Discord')
    expect(findApp('dicsord', list)?.name).toBe('Discord')
    // Too short to tell a typo from another name.
    expect(findApp('dsic', list)).toBeUndefined()
  })

  it('finds nothing on a tie among typos or shortenings, or from one letter', () => {
    const list = ['Paint', 'Point', 'Notepad', 'Notepad++', 'Steam', 'Spotify'].map((name) => ({ name }))
    expect(findApp('pxint', list)).toBeUndefined()
    expect(findApp('paimt', list)?.name).toBe('Paint')
    expect(findApp('ntpd', list)).toBeUndefined()
    expect(findApp('s', list)).toBeUndefined()
    expect(findApp('st', list)?.name).toBe('Steam')
  })

  it('never opens a look-alike of an app that is missing', () => {
    const list = ['Calendrier', 'Calendar', 'Windows 10'].map((name) => ({ name }))
    for (const q of ['calculatrice', 'calculator', 'calc', 'windows 11']) expect(findApp(q, list)).toBeUndefined()
    expect(choices('ouvre la calculatrice', { ...fr, apps: list })[0]).toMatchObject({ kind: 'ask', label: 'Aucune app « calculatrice »' })
  })

  it('reads a list once, and again when it changes', () => {
    const list = [{ name: 'Discord' }]
    expect(findApp('discord', list)?.name).toBe('Discord')
    expect(findApp('discord', [...list, { name: 'Discord' }])?.name).toBe('Discord')
    expect(findApp('spotify', [{ name: 'Spotify' }])?.name).toBe('Spotify')
  })
})

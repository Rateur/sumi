import { describe, expect, it } from 'vitest'
import { choices, findApp, formatDuration, langOf, normalize, parseTimer, type App, type Choice, type Timer } from './intent'
import { common, corpus, installed, type Row } from './intent.corpus'

const names = ['Discord', 'Spotify', 'Steam', 'Visual Studio Code', 'Google Chrome', 'Paramètres', 'Explorateur de fichiers']
// Word and Time Doctor sit one typo from 'world' and 'timer': they must not catch them.
const others = ['Calculatrice', 'Microsoft Teams', 'Claude', 'Notes', 'Mail', 'Word', 'Time Doctor']
const apps: App[] = [...names, ...others].map((name) => ({ name }))
const fr = { apps, lang: 'fr', claudeApp: true } as const
const en = { ...fr, lang: 'en', claudeApp: false } as const
const top = (line: string, options: Parameters<typeof choices>[1] = fr) => choices(line, options)[0]
const labels = (line: string, options: Parameters<typeof choices>[1] = fr) => choices(line, options).map((c) => c.label)

describe('langOf', () => {
  it("follows the browser's language", () => {
    expect(langOf('', 'fr-CA')).toBe('fr')
    expect(langOf('', 'en-GB')).toBe('en')
    expect(langOf('', 'de-DE')).toBe('en')
  })

  it("takes the page's language over the browser's", () => {
    expect(langOf('?lang=fr', 'en-US')).toBe('fr')
    expect(langOf('?lang=en&title=x', 'fr-FR')).toBe('en')
  })

  it('ignores a language it has no words for', () => {
    expect(langOf('?lang=de', 'fr-FR')).toBe('fr')
    expect(langOf('?lang=FR', 'en-US')).toBe('en')
  })
})

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
    // Glue and the words around the keyword are no name.
    ['minuteur dune demi heure', minutes(30)],
    ['minuteur 10 min pr les pates', minutes(10), 'pates'],
    ['met un minuteur de 1h pr reviser', minutes(60), 'reviser'],
    ['minuteur de5', minutes(5)],
    ['set me a timer for 10 min', minutes(10)],
    ['put a timer on for 10 minutes', minutes(10)],
    ['i need a 10 min timer', minutes(10)],
    ['gimme a 5 min timer', minutes(5)],
    ['make it a 10 min timer', minutes(10)],
    ['countdown 5 minutes', minutes(5)],
    ['pasta timer 12 min', minutes(12), 'pasta'],
    // Fillers and politeness are no name once a timer is asked for, nor is a slipped verb or keyword.
    ['minuteur 10 min stp pour les pates', minutes(10), 'pates'],
    ['pendant 10 min', minutes(10)],
    ['set the timer to 10 minutes', minutes(10)],
    ['set a timer for 10 more minutes', minutes(10)],
    ['timer 10 min asap', minutes(10)],
    ['set a tiemr for 10 minutes', minutes(10)],
    ['lacne un minuteur de 10', minutes(10)],
    // The clock's notation is a timer bare, or asked for: 'reveil 7h' alone is a time of day.
    ['minuteur reveil 7h', minutes(420), 'reveil'],
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

  it('opens the one app a word alone starts, from 4 letters, with no typo or shortening', () => {
    expect(top('disc')).toMatchObject({ kind: 'app', label: 'Ouvrir Discord' })
    expect(top('teams')).toMatchObject({ kind: 'app', label: 'Ouvrir Microsoft Teams' })
    for (const line of ['dis', 'dicsord', 'vsc', 'disc stp']) expect(top(line)).toMatchObject({ kind: 'ask' })
    expect(top('ouvre dicsord')).toMatchObject({ kind: 'app', label: 'Ouvrir Discord' })
  })

  it('opens nothing from a word alone once its app is gone', () => {
    expect(top('disc', { ...fr, apps: [{ name: 'Spotify' }] })).toMatchObject({ kind: 'ask' })
  })

  it('offers the apps that tie on Tab, right after the top guess, on a word alone and after a verb', () => {
    const list = ['Discord', 'Disco Elysium', 'Spotify'].map((name) => ({ name }))
    expect(labels('disco', { ...fr, apps: list }).slice(0, 4)).toEqual([
      'Demander à Claude',
      'Ouvrir Discord',
      'Ouvrir Disco Elysium',
      'ChatGPT · navigateur',
    ])
    expect(labels('ouvre disco', { ...fr, apps: list }).slice(0, 3)).toEqual([
      'Aucune app « disco »',
      'Ouvrir Discord',
      'Ouvrir Disco Elysium',
    ])
    // At most 3, the shorter name first, then alphabetical.
    const microsoft = ['Microsoft To Do', 'Microsoft Teams', 'Microsoft Store', 'Microsoft Edge'].map((name) => ({ name }))
    expect(labels('ouvre micr', { ...fr, apps: microsoft }).slice(0, 5)).toEqual([
      'Aucune app « micr »',
      'Ouvrir Microsoft Edge',
      'Ouvrir Microsoft Store',
      'Ouvrir Microsoft Teams',
      'ChatGPT · navigateur',
    ])
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

    it('stops a timer that ended, but never pauses it', () => {
      const done = { ...running, timers: [{ id: 'd', endsAt: 0, label: 'thé' }], now: 1000 }
      expect(top('pause', done)).toMatchObject({ kind: 'ask' })
      expect(top('stop', done)).toMatchObject({ kind: 'stop', id: 'd' })
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

describe('natural phrasing', () => {
  const now = new Date(2026, 10, 19, 11, 27).getTime()
  const options = { ...fr, now, locale: 'fr-FR' }
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

  it('holds the clock while its question is typed', () => {
    for (const [line, from, what] of [
      ['quelle heure est-il', 'quelle heure', 'time'],
      ['quel jour sommes-nous', 'quel jour', 'date'],
      ["what's the date today", "what's the date", 'date'],
      ["c'est quel jour aujourd'hui", "c'est quel jour", 'date'],
    ])
      for (let n = from.length; n <= line.length; n++)
        expect(choices(line.slice(0, n), options)[0], line.slice(0, n)).toMatchObject({ kind: 'clock', what })
  })

  it.each(['batterie', 'battery', 'autonomie', 'niveau de batterie', 'battery level'])(
    'answers %s with the battery on the chip',
    (line) => {
      const battery = { percent: 47, plugged: true, minutes: null, full: null, saver: false, devices: [] }
      expect(choices(line, { ...options, battery })[0]).toEqual({ kind: 'battery', label: '47\u202f% · sur secteur' })
      expect(choices(line, { ...options, battery, lang: 'en' })[0].label).toBe('47\u202f% · plugged in')
    },
  )

  it.each([
    ['bat', 'battery'],
    ['batte', 'battery'],
    ['autono', 'battery'],
    ['heu', 'clock'],
    ['tim', 'clock'],
    ['dat', 'clock'],
    ['mét', 'weather'],
    ['mete', 'weather'],
    ['météo', 'weather'],
    ['meteo', 'weather'],
    ['weat', 'weather'],
    ['pres', 'clipboard'],
    ['presse-pap', 'clipboard'],
    ['histo', 'clipboard'],
    ['cop', 'clipboard'],
    ['clip', 'clipboard'],
    ['cap', 'capture'],
    ['captu', 'capture'],
    ['pip', 'capture'],
    ['eyed', 'capture'],
  ] as const)('offers what %s is on its way to', (line, kind) => {
    expect(choices(line, options)[0].kind).toBe(kind)
  })

  it("offers the weather on its way, in the session's city or asking for one, but not « met »", () => {
    expect(choices('mét', options)[0]).toEqual({ kind: 'weather', day: 0, label: 'Météo · tapez une ville' })
    expect(choices('weat', { ...options, lang: 'en', city: 'Paris' })[0].label).toBe('Weather Paris')
    expect(choices('met', options)[0].kind).toBe('ask')
    expect(choices('met un minuteur de 10s', options)[0].kind).toBe('timer')
    const apps = [{ name: 'Météo' }]
    expect(choices('mete', { ...options, apps }).map((c) => c.label).slice(0, 2)).toEqual([
      'Météo · tapez une ville',
      'Ouvrir Météo',
    ])
  })

  it('puts the bar first, and an app the word also starts one Tab away', () => {
    const list = { ...options, apps: [{ name: 'Battle.net' }] }
    const shown = choices('batt', list).map((c) => (c.kind === 'app' ? c.app.name : c.kind))
    expect(shown.slice(0, 2)).toEqual(['battery', 'Battle.net'])
    expect(choices('battl', list)[0]).toMatchObject({ kind: 'app' })
  })

  it('keeps a longer word, a line or two letters a question', () => {
    for (const line of ['batman', 'timeline', 'ba', 'bat signal', 'database']) {
      expect(choices(line, options)[0].kind, line).toBe('ask')
    }
  })

  it.each([
    'presse',
    'presse-papiers',
    'Presse papier',
    'historique',
    'historique du presse-papiers',
    'copies',
    'clipboard',
    'Clipboard history',
  ])('opens the clipboard history on %s', (line) => {
    expect(choices(line, options)[0]).toEqual({ kind: 'clipboard', label: 'Presse-papiers' })
    expect(choices(line, { ...options, lang: 'en' })[0]).toEqual({ kind: 'clipboard', label: 'Clipboard' })
  })

  it('keeps a longer line about the clipboard a question, and an app it starts one Tab away', () => {
    for (const line of ['historique de la france', 'clipboard manager', 'copier coller', 'presse écrite']) {
      expect(choices(line, options)[0].kind, line).toBe('ask')
    }
    const list = { ...options, apps: [{ name: 'Copilot' }] }
    expect(choices('copi', list).map((c) => (c.kind === 'app' ? c.app.name : c.kind)).slice(0, 2)).toEqual([
      'clipboard',
      'Copilot',
    ])
    expect(choices('copil', list)[0]).toMatchObject({ kind: 'app' })
  })

  it.each(['capture', 'Capturer', 'pipette', 'eyedropper', 'color picker', 'Colour picker'])(
    'starts the screen capture on %s',
    (line) => {
      expect(choices(line, options)[0]).toEqual({ kind: 'capture', label: 'Capture' })
      expect(choices(line, { ...options, lang: 'en' })[0]).toEqual({ kind: 'capture', label: 'Capture' })
    },
  )

  it("keeps a screenshot a question, and an app 'cap' also starts one Tab away", () => {
    for (const line of ["capture d'écran", 'capture the flag', 'pipette graduée', 'color picker chrome']) {
      expect(choices(line, options)[0].kind, line).toBe('ask')
    }
    const list = { ...options, apps: [{ name: 'CapCut' }] }
    expect(choices('cap', list).map((c) => (c.kind === 'app' ? c.app.name : c.kind)).slice(0, 2)).toEqual([
      'capture',
      'CapCut',
    ])
    expect(choices('capc', list)[0]).toMatchObject({ kind: 'app' })
  })

  it('names the battery until Rust answers, and keeps its questions', () => {
    expect(choices('batterie', options)[0].label).toBe('Batterie')
    expect(choices('batterie faible que faire', options)[0].kind).toBe('ask')
  })

  it.each([
    ['météo', undefined, 0],
    ['meteo', undefined, 0],
    ['weather', undefined, 0],
    ['météo Lyon', 'Lyon', 0],
    ['météo à Lyon', 'Lyon', 0],
    ['weather in Paris', 'Paris', 0],
    ['météo Lyon demain', 'Lyon', 1],
    ['weather Paris tomorrow', 'Paris', 1],
    ['météo demain', undefined, 1],
    ["météo aujourd'hui", undefined, 0],
    ['météo Saint-Étienne', 'Saint-Étienne', 0],
  ] as const)('reads %s as the weather', (line, city, day) => {
    expect(choices(line, options)[0]).toMatchObject({ kind: 'weather', city, day })
  })

  it('names the weather on the chip, without a network request', () => {
    expect(choices('météo à Lyon demain', options)[0].label).toBe('Météo Lyon demain')
    expect(choices('weather in Paris tomorrow', { ...options, lang: 'en' })[0].label).toBe('Weather Paris tomorrow')
    expect(choices('météo', options)[0].label).toBe('Météo · tapez une ville')
    expect(choices('weather', { ...options, lang: 'en' })[0].label).toBe('Weather · type a city')
    expect(choices('météo', { ...options, city: 'Lyon' })[0].label).toBe('Météo Lyon')
  })

  it('keeps temps and weather questions as questions', () => {
    for (const line of ['temps', 'quel temps fait-il', 'temps à Lyon', 'weather forecast for next week', 'weather in 10 min'])
      expect(choices(line, options)[0].kind, line).toBe('ask')
  })

  it("puts the weather before Windows' own Météo app, which Tab and a verb still open", () => {
    const apps = [{ name: 'Météo' }]
    expect(choices('météo', { ...options, apps }).map((c) => c.label).slice(0, 2)).toEqual([
      'Météo · tapez une ville',
      'Ouvrir Météo',
    ])
    expect(choices('ouvre météo', { ...options, apps })[0].kind).toBe('app')
  })

  it('holds an app or the time while a tail is typed after it', () => {
    for (const [line, from] of [
      ['ouvre spotify maintenant', 'ouvre spotify'],
      ['ouvre discord stp', 'ouvre discord'],
      ['ouvre discord merci', 'ouvre discord'],
      ['open discord rn', 'open discord'],
      ['open discord please', 'open discord'],
      ['il est quelle heure stp', 'il est quelle heure'],
      ['launch vs code', 'launch vs'],
    ]) {
      const first = choices(from, options)[0]
      for (let n = from.length; n <= line.length; n++)
        expect(choices(line.slice(0, n), options)[0], line.slice(0, n)).toEqual(first)
    }
    // A bare name keeps its politeness: 'discord stp' is a question, so 'discord st' holds nothing.
    expect(choices('discord st', options)[0].kind).toBe('ask')
  })

  it('holds a spelled timer while its unit is typed', () => {
    for (const [line, from] of [
      ['minuteur de vingt minutes', 'minuteur de vingt'],
      ['timer twenty five minutes', 'timer twenty five'],
    ])
      for (let n = from.length; n <= line.length; n++)
        expect(parseTimer(line.slice(0, n)), line.slice(0, n)).toEqual(parseTimer(from))
  })

  it('arms no timer before the first digit: a masculine "un" is no minute', () => {
    for (const line of ['mets un minuteur de 25 minutes', 'lance un minuteur de 20 minutes'])
      for (let n = 1; n < line.indexOf('2'); n++) expect(choices(line.slice(0, n), options)[0].kind).toBe('ask')
    expect(choices('mets une minute', options)[0]).toMatchObject({ kind: 'timer', ms: 60_000 })
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
    // 'disco' could be either: nothing until it can't.
    expect(findApp('disco', list)).toBeUndefined()
    expect(findApp('discor', list)?.name).toBe('Discord')
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

  it('finds the built-in apps by their French or English name, whichever Windows has', () => {
    const french = ['Calendrier', 'Gestionnaire des tâches', 'Panneau de configuration', 'Bloc-notes']
      .concat(['Invite de commandes', 'Horloge'])
    const english = ['Calendar', 'Task Manager', 'Control Panel', 'Notepad', 'Command Prompt', 'Clock']
    english.forEach((en, i) => {
      expect(findApp(en, french.map((name) => ({ name })))?.name).toBe(french[i])
      expect(findApp(french[i], english.map((name) => ({ name })))?.name).toBe(en)
    })
    expect(findApp('cmd', english.map((name) => ({ name })))?.name).toBe('Command Prompt')
  })

  it('opens no app by the name of the system alone', () => {
    const list = ['Windows Terminal', 'Clock'].map((name) => ({ name }))
    expect(findApp('windows', list)).toBeUndefined()
    expect(top('open windows', { ...en, apps: list })).toMatchObject({ kind: 'ask' })
    expect(top('ouvre horloge', { ...fr, apps: list })).toMatchObject({ kind: 'app', app: { name: 'Clock' } })
  })

  it('reads the plural of Mail by its alias, not any plural: emails and codes stay questions', () => {
    expect(findApp('mails', apps)?.name).toBe('Mail')
    expect(findApp('emails', apps)).toBeUndefined()
    expect(findApp('codes', apps)).toBeUndefined()
  })

  it('reads a pronoun as a whole word, never the start of a name', () => {
    const list = [{ name: 'OneNote' }]
    for (const line of ['open one', 'ouvre one', 'ouvre ça']) expect(top(line, { ...fr, apps: list }).kind).toBe('ask')
    expect(top('open onenote', { ...fr, apps: list })).toMatchObject({ kind: 'app', app: { name: 'OneNote' } })
  })

  it('reads a list once, and again when it changes', () => {
    const list = [{ name: 'Discord' }]
    expect(findApp('discord', list)?.name).toBe('Discord')
    expect(findApp('discord', [...list, { name: 'Discord' }])?.name).toBe('Discord')
    expect(findApp('spotify', [{ name: 'Spotify' }])?.name).toBe('Spotify')
  })
})

// The corpus in intent.corpus.ts: each line gives its one chip, the same one every time.
describe('corpus', () => {
  const now = new Date(2026, 10, 19, 11, 27).getTime()
  const options = { apps: installed.map((name) => ({ name })), lang: 'fr', claudeApp: true, now, locale: 'fr-FR' } as const
  const options2 = { ...options, apps: [...options.apps] }
  const target = (c: Choice) =>
    c.kind === 'app'
      ? c.app.name
      : c.kind === 'ask'
        ? c.to
        : c.kind === 'timer'
          ? c.ms
          : c.kind === 'clock'
            ? c.what
            : c.kind === 'weather'
              ? (c.city ?? '')
              : ''
  const read = (line: string) => choices(line, options)[0]

  it('is mostly questions, French and English alike', () => {
    const count = (test: (row: Row) => boolean) => corpus.filter(test).length
    expect(corpus.length).toBeGreaterThanOrEqual(400)
    expect(count(([, , kind]) => kind === 'ask') * 2).toBeGreaterThanOrEqual(corpus.length)
    expect(count(([, lang]) => lang === 'fr')).toBe(count(([, lang]) => lang === 'en'))
    expect(new Set(corpus.map(([line]) => line)).size).toBe(corpus.length)
  })

  it.each(corpus)('%s (%s) → %s %s', (line, _, kind, to = 'claude') => {
    const c = read(line)
    expect(c.kind).toBe(kind)
    expect(target(c)).toBe(to)
  })

  // About 200 Start names, Windows' own and popular apps: questions stay questions on a fuller list too. A few rows
  // read differently there on purpose, as an app missing above is installed or a second one ties.
  it.each(corpus)('%s (%s) on a common Start list', (line, _, kind, to = 'claude') => {
    const repinned: Record<string, [Choice['kind'], string]> = {
      'ouvre paint': ['app', 'Paint'],
      'open paint': ['app', 'Paint'],
      // Visual Studio 2022 ties with Visual Studio Code.
      'open visual studio': ['ask', 'claude'],
    }
    const c = choices(line, { ...options, apps: common.map((name) => ({ name })) })[0]
    expect([c.kind, target(c)]).toEqual(repinned[line] ?? [kind, to])
  })

  // Each alone, as on a PC where no other app ties with it: 'start the car' is no Table des caractères.
  it.each(['open the fridge', 'start the car', 'ouvre world', 'open world', 'ouvre la cal', 'open the cal'])(
    '%s stays a question with any one common app',
    (line) => {
      for (const name of common) expect(choices(line, { ...options, apps: [{ name }] })[0].kind, name).toBe('ask')
    },
  )

  it('gives the same chip twice, from the same list or a copy', () => {
    for (const [line] of corpus) {
      expect(choices(line, options)).toEqual(choices(line, options))
      expect(choices(line, options2)).toEqual(choices(line, options))
    }
  })

  // While a command is typed, each prefix of 3 letters or more shows its chip or a question: never another app, nor
  // a timer of another length once the right one has shown. The time, the battery, the clipboard history and the
  // capture may show, as they only answer or open in the bar: 'time' is on the way to 'timer', 'batt' to 'Battle.net',
  // 'copi' to Copilot, 'cap' to CapCut.
  it.each(corpus.filter(([, , kind]) => kind !== 'ask'))('stays put while %s is typed', (line, _, kind, to) => {
    let shown = false
    for (let n = 3; n <= line.length; n++) {
      const c = read(line.slice(0, n))
      const answers = c.kind === 'clock' || c.kind === 'battery' || c.kind === 'clipboard' || c.kind === 'capture'
      if (c.kind === 'ask' || (answers && kind !== c.kind)) continue
      const where = `${line.slice(0, n)} → ${c.kind} ${target(c)}`
      expect(c.kind, where).toBe(kind)
      if (kind === 'timer' && !shown) shown = target(c) === to
      // A city grows letter by letter.
      else if (kind !== 'weather') expect(target(c), where).toBe(to)
    }
  })
})

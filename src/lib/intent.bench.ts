// One keystroke's reading against 500 apps, on 60-character lines: under 1 ms at p99. Not part of `npm test`, as
// the time depends on the PC: run it with `npx vitest bench --run`.

import { test } from 'vitest'
import { choices } from './intent'
import { installed } from './intent.corpus'

// Made-up names shaped like Start's, one to three words, the same on every run.
const parts = ['ka', 'lo', 'mi', 'ter', 'van', 'dro', 'pix', 'nor', 'sel', 'qua', 'zen', 'bri', 'tal', 'gor']
const word = (n: number) => parts[n % 14] + parts[Math.floor(n / 14) % 14] + parts[Math.floor(n / 196) % 14]
const fake = (i: number) => [word(i * 7 + 1), word(i * 13 + 5), word(i * 3)].slice(0, 1 + (i % 3)).join(' ')
const apps = [...installed, ...Array.from({ length: 500 - installed.length }, (_, i) => fake(i))].map((name) => ({
  name: name[0].toUpperCase() + name.slice(1),
}))
const options = { apps, lang: 'fr', claudeApp: true, now: 0 } as const

const lines = {
  // A verb and a name no tier finds: every tier runs, typos included.
  'verb, no app': 'ouvre le programme visual studio kode insiders du projet ok!',
  'verb, a typo': 'peux-tu ouvrir l’application microsft temas pour moi stp ?!!',
  question: 'quelle est la meilleure façon de cuire des pâtes al dente ??',
  timer: 'mets un minuteur de vingt-cinq minutes pour les pâtes stp !!',
}

test.for(Object.entries(lines))('choices, 500 apps: %s', async ([, line], { bench, expect, annotate }) => {
  expect(line).toHaveLength(60)
  const { latency } = await bench(line, () => void choices(line, options)).run()
  await annotate(`p50 ${latency.p50!.toFixed(4)} ms, p99 ${latency.p99!.toFixed(4)} ms`)
  expect(latency.p99).toBeLessThan(1)
})

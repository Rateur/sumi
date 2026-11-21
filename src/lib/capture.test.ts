import { describe, expect, it } from 'vitest'
import { CAPTURE_KEYS, result } from './capture'

describe('result', () => {
  it('says the colour copied, and drops a bead holding it', () => {
    expect(result({ kind: 'colour', hex: '#1E90FF' }, 'fr')).toEqual({
      parts: ['#1E90FF', 'Couleur copiée'],
      spoken: 'Couleur #1E90FF copiée.',
      bead: '#1E90FF',
    })
    expect(result({ kind: 'colour', hex: '#1E90FF' }, 'en')?.parts).toEqual(['#1E90FF', 'Colour copied'])
  })

  it('counts the words of the text copied, one word without an s, with a black bead', () => {
    expect(result({ kind: 'text', words: 42 }, 'fr')).toEqual({
      parts: ['Texte copié', '42 mots'],
      spoken: 'Texte copié, 42 mots.',
      bead: null,
    })
    expect(result({ kind: 'text', words: 1 }, 'fr')?.parts).toEqual(['Texte copié', '1 mot'])
    expect(result({ kind: 'text', words: 1 }, 'en')?.parts).toEqual(['Text copied', '1 word'])
    expect(result({ kind: 'text', words: 2 }, 'en')?.spoken).toBe('Text copied, 2 words.')
  })

  it("names a QR code's link by its site, and says anything else in one is copied", () => {
    expect(result({ kind: 'link', host: 'example.com' }, 'fr')).toEqual({
      parts: ['Lien copié', 'example.com'],
      spoken: 'Lien example.com copié.',
      bead: null,
    })
    expect(result({ kind: 'code' }, 'en')).toEqual({ parts: ['QR code copied'], spoken: 'QR code copied.', bead: null })
  })

  it('drops no bead when nothing was copied, and says why', () => {
    expect(result({ kind: 'empty' }, 'fr')).toEqual({ parts: ['Aucun texte trouvé'], spoken: 'Aucun texte trouvé.', bead: false })
    expect(result({ kind: 'unreadable' }, 'en')?.parts).toEqual(['No OCR language installed'])
    expect(result({ kind: 'failed' }, 'fr')?.bead).toBe(false)
  })

  it('shows nothing after Esc', () => {
    expect(result({ kind: 'cancelled' }, 'fr')).toBeUndefined()
  })
})

describe('CAPTURE_KEYS', () => {
  it('hands Rust Esc, the arrows and Shift, and nothing else', () => {
    expect(Object.values(CAPTURE_KEYS)).toEqual(['escape', 'left', 'right', 'up', 'down', 'shift'])
    expect(CAPTURE_KEYS.Enter).toBeUndefined()
  })
})

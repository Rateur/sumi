import { describe, expect, it } from 'vitest'
import { dominant, luminance } from './color'

const fill = (pixels: [number, number, number][]) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]))
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

describe('dominant', () => {
  it('finds the colour that covers most of the artwork', () => {
    const pixels = fill([...Array(70).fill([220, 40, 40]), ...Array(30).fill([40, 60, 220])])
    const [r, g, b] = rgb(dominant(pixels)!)
    expect(r).toBeGreaterThan(g + 80)
    expect(r).toBeGreaterThan(b + 80)
  })

  it('ignores the black, white and grey around a small coloured part', () => {
    const pixels = fill([...Array(60).fill([10, 10, 10]), ...Array(30).fill([250, 250, 250]), ...Array(10).fill([30, 200, 60])])
    const [r, g, b] = rgb(dominant(pixels)!)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('has no colour for grey artwork', () => {
    expect(dominant(fill(Array(100).fill([128, 128, 128])))).toBeUndefined()
    expect(dominant(new Uint8ClampedArray())).toBeUndefined()
  })

  it('lightens a dark colour until it shows on black', () => {
    const [r, g, b] = rgb(dominant(fill(Array(100).fill([20, 20, 90])))!)
    expect(luminance(r, g, b)).toBeGreaterThanOrEqual(0.2)
  })
})

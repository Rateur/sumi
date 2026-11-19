/**
 * The artwork's main colour as `#rrggbb`, from its RGBA pixels: the most present saturated hue, made light
 * enough to stand out on the black island. Artwork that is mostly grey, black or white has none.
 */
export function dominant(pixels: Uint8ClampedArray): string | undefined {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    count++
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
    const [h, s, l] = hsl(r, g, b)
    if (s < 0.25 || l < 0.12 || l > 0.92) continue
    const bin = bins[Math.floor(h / 30) % 12]
    bin.weight += s
    bin.r += r * s
    bin.g += g * s
    bin.b += b * s
  }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a))
  // Less than a twentieth of the picture in colour: grey artwork keeps the neutral tint.
  if (!count || best.weight < count * 0.05) return undefined
  const [h, s, l] = hsl(best.r / best.weight, best.g / best.weight, best.b / best.weight)
  return hex(...readable(h, s, l))
}

/** The artwork's main colour, read from a 16 px copy, once per picture. */
export async function tint(url: string): Promise<string | undefined> {
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const context = new OffscreenCanvas(16, 16).getContext('2d')
    context?.drawImage(image, 0, 0, 16, 16)
    return context ? dominant(context.getImageData(0, 0, 16, 16).data) : undefined
  } catch {
    return undefined
  }
}

/** Lightens a colour until it shows on black: a relative luminance of 0.2, about 5:1. */
export function readable(h: number, s: number, l: number): [number, number, number] {
  let rgb = fromHsl(h, s, l)
  while (luminance(...rgb) < 0.2 && l < 0.85) {
    l += 0.04
    rgb = fromHsl(h, s, l)
  }
  return rgb
}

export function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === rr ? ((gg - bb) / d + 6) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number]
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

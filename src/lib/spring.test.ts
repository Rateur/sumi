import { describe, expect, it } from 'vitest'
import { Spring } from './spring'

/** Steps `spring` every `dt` ms from `from` until it rests; returns the samples and when it settled. */
function run(spring: Spring, dt: number, from = 0) {
  const samples: { t: number; x: number; v: number }[] = []
  let t = from
  while (spring.update(t)) {
    samples.push({ t, x: spring.value, v: spring.velocity })
    t += dt
  }
  return { samples, settledAt: t }
}

describe('Spring', () => {
  it.each([0.15, 0.25, 0.3])('overshoots by the analytic amount for bounce %f', (bounce) => {
    const spring = new Spring(0)
    spring.to(100, 0.44, bounce, 0)
    const peak = Math.max(...run(spring, 0.1).samples.map((s) => s.x))
    const zeta = 1 - bounce
    const expected = 100 * Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta))
    expect(peak - 100).toBeCloseTo(expected, 3)
  })

  it('settles when a critically damped step is within 0.1 px, then snaps and stops', () => {
    // From rest, the offset is 100·e^-u·(1+u) with u = ωt; it reaches 0.1 px at u ≈ 9.2335.
    let lo = 0
    let hi = 20
    while (hi - lo > 1e-9) {
      const u = (lo + hi) / 2
      if (100 * Math.exp(-u) * (1 + u) > 0.1) lo = u
      else hi = u
    }
    const expected = (hi / (2 * Math.PI)) * 0.5 * 1000
    const spring = new Spring(0)
    spring.to(100, 0.5, 0, 0)
    const { settledAt } = run(spring, 1)
    expect(Math.abs(settledAt - expected)).toBeLessThanOrEqual(1)
    expect(spring.value).toBe(100)
    expect(spring.velocity).toBe(0)
    expect(spring.resting).toBe(true)
    expect(spring.update(settledAt + 1000)).toBe(false)
  })

  it('keeps position and velocity continuous through a retarget', () => {
    const spring = new Spring(0)
    spring.to(100, 0.4, 0.25, 0)
    spring.update(120)
    const [x, v] = [spring.value, spring.velocity]
    expect(v).toBeGreaterThan(100)
    spring.to(30, 0.3, 0, 120)
    spring.update(120)
    expect(spring.value).toBeCloseTo(x, 9)
    expect(spring.velocity).toBeCloseTo(v, 9)
    spring.update(120.001)
    expect(spring.value).toBeCloseTo(x + v * 1e-6, 4)
  })

  it('draws the same curve at 60 and 144 Hz', () => {
    const at = (hz: number) => {
      const spring = new Spring(34)
      spring.to(120, 0.46, 0.26, 0)
      const curve = new Map<number, number>()
      let retargeted = false
      for (let frame = 0; ; frame++) {
        const t = frame * (1000 / hz)
        if (!retargeted && t >= 150) {
          // Retarget at the same instant, between frames, as an input event would.
          spring.to(56, 0.4, 0, 150)
          retargeted = true
        }
        if (!spring.update(t)) break
        if (frame % (hz / 12) === 0) curve.set(Math.round(t), spring.value)
      }
      return curve
    }
    const [slow, fast] = [at(60), at(144)]
    const shared = [...slow.keys()].filter((t) => fast.has(t))
    expect(shared.length).toBeGreaterThan(5)
    for (const t of shared) expect(fast.get(t)).toBeCloseTo(slow.get(t)!, 9)
  })

  it('never overshoots with bounce 0, from rest or moving away from the target', () => {
    const fromRest = new Spring(152)
    fromRest.to(132, 0.34, 0, 0)
    expect(Math.min(...run(fromRest, 0.5).samples.map((s) => s.x))).toBeGreaterThanOrEqual(132)

    const growing = new Spring(132)
    growing.to(280, 0.46, 0.26, 0)
    growing.update(100)
    growing.to(132, 0.4, 0, 100)
    expect(Math.min(...run(growing, 0.5, 100).samples.map((s) => s.x))).toBeGreaterThanOrEqual(132)
  })

  it('pulses and comes back to its target on a kick', () => {
    // Spec: ΔvH +150 px/s on H (0.30, 0) peaks at 2.6 px after 48 ms.
    const spring = new Spring(34)
    spring.to(34, 0.3, 0, 0)
    spring.kick(150, 0)
    const { samples } = run(spring, 0.5)
    const peak = samples.reduce((a, b) => (b.x > a.x ? b : a))
    expect(peak.x - 34).toBeCloseTo(2.63, 2)
    expect(peak.t).toBeCloseTo(47.7, 0)
    expect(spring.value).toBe(34)
  })
})

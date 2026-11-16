/**
 * A damped spring in closed form, set the way SwiftUI sets one: `duration` in seconds and `bounce`
 * from 0 (critically damped, no overshoot from rest) up towards 1. Positions are in px, velocities
 * in px/s and times are rAF timestamps in ms. The curve depends only on those timestamps, so it is
 * the same at any refresh rate.
 */
export class Spring {
  /** Position at the last `update`. */
  value: number
  /** Velocity at the last `update`, in px/s. */
  velocity = 0
  target: number
  /** True once the spring has settled on its target: nothing left to draw. */
  resting = true
  #x0: number
  #v0 = 0
  #t0 = 0
  #omega = Math.PI
  #zeta = 1

  constructor(value: number) {
    this.value = this.target = this.#x0 = value
  }

  /** Heads for `target` from the current position, keeping the current velocity. */
  to(target: number, duration: number, bounce: number, now: number): void {
    this.#restart(now)
    this.target = target
    this.#omega = (2 * Math.PI) / duration
    this.#zeta = 1 - bounce
  }

  /** Adds `dv` px/s to the velocity without moving the target: a pulse. */
  kick(dv: number, now: number): void {
    this.#restart(now)
    this.#v0 += dv
  }

  /** Puts the spring at `value`, at rest. */
  jump(value: number): void {
    this.value = this.target = this.#x0 = value
    this.velocity = this.#v0 = 0
    this.resting = true
  }

  /** Samples the spring at `now`. Returns false once it has settled, after snapping to the target. */
  update(now: number): boolean {
    if (this.resting) return false
    const [x, v] = this.#at(now)
    if (Math.abs(x - this.target) < 0.1 && Math.abs(v) < 2) {
      this.jump(this.target)
      return false
    }
    this.value = x
    this.velocity = v
    return true
  }

  #restart(now: number): void {
    ;[this.#x0, this.#v0] = this.#at(now)
    this.#t0 = now
    this.resting = false
  }

  #at(now: number): [number, number] {
    // An event's timestamp can be later than the next frame's rAF timestamp.
    const t = Math.max(0, now - this.#t0) / 1000
    const [w, z, a, v0] = [this.#omega, this.#zeta, this.#x0 - this.target, this.#v0]
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z)
      const b = (v0 + z * w * a) / wd
      const [e, c, s] = [Math.exp(-z * w * t), Math.cos(wd * t), Math.sin(wd * t)]
      return [this.target + e * (a * c + b * s), e * ((b * wd - z * w * a) * c - (a * wd + z * w * b) * s)]
    }
    // Critically damped; a negative bounce counts as 0.
    const b = v0 + w * a
    const e = Math.exp(-w * t)
    return [this.target + e * (a + b * t), e * (b - w * (a + b * t))]
  }
}

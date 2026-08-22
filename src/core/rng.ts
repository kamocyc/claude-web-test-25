/** シード付き乱数（決定性のため sim では Math.random を使わない）。 */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % n
  }
  get state(): number {
    return this.s
  }
  set state(v: number) {
    this.s = v >>> 0
  }
}

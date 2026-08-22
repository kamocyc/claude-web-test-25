import { MAX_Z } from '../data/constants'

/**
 * 列(column)ベースのボクセルグリッド。
 *
 *   bed[i]  = ground[i] + barrier[i]   … 水の底面
 *   水は列ごとに 1 本の連続した水柱としてのみ存在する（Timberborn と同じ扱い）。
 *
 * ground は「地面から連続するソリッド」の高さ。natural（地形。掘削で減る）と
 * levee（その上に積まれた土手）の和。ceiling は地面から浮いたソリッドの下端で、
 * 水位の上限になるだけで底面は変えない。deck は橋の桁の高さで、歩ける面を
 * water の上に足すだけ。どちらも水の底面（bed）には触らない。
 */
export class Grid {
  readonly w: number
  readonly h: number
  readonly size: number
  readonly maxZ = MAX_Z

  /** 自然地形の高さ（掘削で減少） */
  readonly natural: Uint8Array
  /** 地形の上に積まれた土手ブロック数 */
  readonly levee: Uint8Array
  /** natural + levee（毎回足さずに済むようキャッシュ） */
  readonly ground: Uint8Array
  /** 堰/水門による堰高 */
  readonly barrier: Uint8Array
  /** 浮いたソリッドの下端（無ければ maxZ） */
  readonly ceiling: Uint8Array
  /** 通水抵抗 0..1 */
  readonly flowResist: Float64Array
  /** マップ端の排水口フラグ */
  readonly isDrain: Uint8Array
  /** 道が敷かれているか（荷運びが速くなる） */
  readonly road: Uint8Array
  /** 橋の桁の高さ（0 = 橋なし）。水の底面は変えず、その上を歩けるようにするだけ */
  readonly deck: Uint8Array

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.size = w * h
    this.natural = new Uint8Array(this.size)
    this.levee = new Uint8Array(this.size)
    this.ground = new Uint8Array(this.size)
    this.barrier = new Uint8Array(this.size)
    this.ceiling = new Uint8Array(this.size).fill(MAX_Z)
    this.flowResist = new Float64Array(this.size)
    this.isDrain = new Uint8Array(this.size)
    this.road = new Uint8Array(this.size)
    this.deck = new Uint8Array(this.size)
  }

  idx(x: number, y: number): number {
    return y * this.w + x
  }
  xOf(i: number): number {
    return i % this.w
  }
  yOf(i: number): number {
    return (i / this.w) | 0
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  /** 水の底面の高さ */
  bed(i: number): number {
    return this.ground[i] + this.barrier[i]
  }

  /** 人が立つ高さ。堰の上には乗れるし、橋があればその桁の上を歩く */
  walkTop(i: number): number {
    return this.deck[i] > 0 ? this.deck[i] : this.ground[i] + this.barrier[i]
  }

  refreshGround(i: number): void {
    this.ground[i] = this.natural[i] + this.levee[i]
  }
  refreshAllGround(): void {
    for (let i = 0; i < this.size; i++) this.ground[i] = this.natural[i] + this.levee[i]
  }

  /** 4 近傍の列番号を cb に渡す */
  forEachNeighbor(i: number, cb: (n: number) => void): void {
    const x = this.xOf(i)
    const y = this.yOf(i)
    if (x > 0) cb(i - 1)
    if (x < this.w - 1) cb(i + 1)
    if (y > 0) cb(i - this.w)
    if (y < this.h - 1) cb(i + this.w)
  }
}

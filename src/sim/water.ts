import { Grid } from '../core/grid'
import { CELL, DAMPING, DRY_EPSILON, G, MAX_FLUX } from '../data/constants'

/**
 * パイプ 1 本のフラックスを更新する。
 *
 *   Q = Q * 減衰 + dt * g * A * Δh / l * (1 - 通水抵抗)
 *   A（濡れ断面高）= 上流側の水面 - 高い方の河床
 *
 * A を挟むのが肝で、これが「堰を越える水の厚み」になる。堰の天端ぎりぎりでは
 * ほとんど流れず、頭が付くほど勢いよく流れる（＝実際の堰と同じ挙動）。滝でも
 * 上流側の水深がそのまま A になるので正しく落ちる。A <= 0 は堰・地形が両側の
 * 水面より高いということなので、慣性ごと 0 にして水が壁を登らないようにする。
 */
function pipeFlux(
  q: number,
  ha: number,
  hb: number,
  ba: number,
  bb: number,
  resist: number,
  k: number,
): number {
  const higherBed = ba > bb ? ba : bb
  const upper = ha > hb ? ha : hb
  const cross = upper - higherBed
  if (cross <= 0) return 0
  let next = q * DAMPING + k * cross * (ha - hb) * (1 - resist)
  if (next > MAX_FLUX) next = MAX_FLUX
  else if (next < -MAX_FLUX) next = -MAX_FLUX
  return next
}

/**
 * 水流ソルバ（バーチャルパイプ法 / Mei et al. の浅水近似）。
 *
 * 隣接する列の間に「仮想パイプ」を置き、その流量 Q を状態として保持する。
 * 単純な水位平均化 CA と違い流れの慣性が残るので、川は流れ続け、水門を開ければ
 * 勢いよく放流され、貯水池は波打ってから水平に落ち着く。
 *
 * 1 サブステップの流れ:
 *   1. updateFlux   上式で各パイプの流量を更新
 *   2. limitOutflow 列から出る量が保有水量を超えないよう流出パイプを一律に縮小
 *   3. applyFlux    depth += (流入 - 流出) * dt / セル面積
 *   4. evaporate / clampCeiling
 *
 * 「乾いた高い隣へは流れ込まない」「下流が高ければ遡上しない」は 1 の cross 判定と
 * 2 の縮小により自動的に満たされるので特別扱いは要らない。土手・堰・水門は
 * いずれも grid.bed()（= ground + barrier）を上げるだけで、越流も貯水も同じ式から出る。
 */
export class WaterSim {
  readonly grid: Grid
  /** 水深（bed より上）*/
  readonly depth: Float64Array
  /** 列 (x-1,y)→(x,y) 方向のフラックス。index = y*(w+1)+x */
  readonly fluxX: Float64Array
  /** 列 (x,y-1)→(x,y) 方向のフラックス。index = y*w+x */
  readonly fluxY: Float64Array

  constructor(grid: Grid) {
    this.grid = grid
    this.depth = new Float64Array(grid.size)
    this.fluxX = new Float64Array((grid.w + 1) * grid.h)
    this.fluxY = new Float64Array(grid.w * (grid.h + 1))
  }

  /** 水面の高さ */
  surface(i: number): number {
    return this.grid.bed(i) + this.depth[i]
  }
  isWet(i: number): boolean {
    return this.depth[i] > DRY_EPSILON
  }
  totalVolume(): number {
    let v = 0
    for (let i = 0; i < this.depth.length; i++) v += this.depth[i]
    return v * CELL * CELL
  }
  addWater(i: number, volume: number): void {
    this.depth[i] += volume / (CELL * CELL)
  }
  /** 実際に取り出せた量を返す */
  drawWater(i: number, volume: number): number {
    const take = Math.min(this.depth[i] * CELL * CELL, volume)
    if (take <= 0) return 0
    this.depth[i] -= take / (CELL * CELL)
    return take
  }
  /** 流速ベクトル（描画・水車判定用） */
  flowAt(i: number, out: { x: number; y: number }): void {
    const { grid } = this
    const x = grid.xOf(i)
    const y = grid.yOf(i)
    const p = y * (grid.w + 1) + x
    out.x = (this.fluxX[p] + this.fluxX[p + 1]) * 0.5
    out.y = (this.fluxY[i] + this.fluxY[i + grid.w]) * 0.5
  }

  step(dt: number, evaporation = 0): void {
    this.updateFlux(dt)
    this.limitOutflow(dt)
    this.applyFlux(dt)
    if (evaporation > 0) this.evaporate(dt, evaporation)
    this.clampCeiling()
  }

  private updateFlux(dt: number): void {
    const { grid, depth, fluxX, fluxY } = this
    const { w, h, isDrain, flowResist } = grid
    const k = (dt * G) / CELL

    // --- X 方向 ---
    for (let y = 0; y < h; y++) {
      const rowP = y * (w + 1)
      const rowC = y * w
      for (let x = 0; x <= w; x++) {
        const pi = rowP + x
        const ia = x > 0 ? rowC + x - 1 : -1
        const ib = x < w ? rowC + x : -1
        let ba: number
        let bb: number
        let resist: number
        if (ia < 0) {
          // 左端。排水口でなければ壁
          if (!isDrain[ib]) {
            fluxX[pi] = 0
            continue
          }
          bb = grid.bed(ib)
          ba = bb - 1
          resist = flowResist[ib]
          fluxX[pi] = pipeFlux(fluxX[pi], ba, bb + depth[ib], ba, bb, resist, k)
          continue
        }
        if (ib < 0) {
          if (!isDrain[ia]) {
            fluxX[pi] = 0
            continue
          }
          ba = grid.bed(ia)
          bb = ba - 1
          resist = flowResist[ia]
          fluxX[pi] = pipeFlux(fluxX[pi], ba + depth[ia], bb, ba, bb, resist, k)
          continue
        }
        ba = grid.bed(ia)
        bb = grid.bed(ib)
        resist = flowResist[ia] > flowResist[ib] ? flowResist[ia] : flowResist[ib]
        fluxX[pi] = pipeFlux(fluxX[pi], ba + depth[ia], bb + depth[ib], ba, bb, resist, k)
      }
    }

    // --- Y 方向 ---
    for (let y = 0; y <= h; y++) {
      const rowP = y * w
      for (let x = 0; x < w; x++) {
        const pi = rowP + x
        const ia = y > 0 ? (y - 1) * w + x : -1
        const ib = y < h ? y * w + x : -1
        let ba: number
        let bb: number
        let resist: number
        if (ia < 0) {
          if (!isDrain[ib]) {
            fluxY[pi] = 0
            continue
          }
          bb = grid.bed(ib)
          ba = bb - 1
          resist = flowResist[ib]
          fluxY[pi] = pipeFlux(fluxY[pi], ba, bb + depth[ib], ba, bb, resist, k)
          continue
        }
        if (ib < 0) {
          if (!isDrain[ia]) {
            fluxY[pi] = 0
            continue
          }
          ba = grid.bed(ia)
          bb = ba - 1
          resist = flowResist[ia]
          fluxY[pi] = pipeFlux(fluxY[pi], ba + depth[ia], bb, ba, bb, resist, k)
          continue
        }
        ba = grid.bed(ia)
        bb = grid.bed(ib)
        resist = flowResist[ia] > flowResist[ib] ? flowResist[ia] : flowResist[ib]
        fluxY[pi] = pipeFlux(fluxY[pi], ba + depth[ia], bb + depth[ib], ba, bb, resist, k)
      }
    }
  }

  /** 各列から出る総流量が保有水量を超えないよう、その列の流出パイプを一律に縮小する。 */
  private limitOutflow(dt: number): void {
    const { grid, depth, fluxX, fluxY } = this
    const { w, h } = grid
    const area = CELL * CELL
    for (let y = 0; y < h; y++) {
      const rowP = y * (w + 1)
      const rowC = y * w
      for (let x = 0; x < w; x++) {
        const i = rowC + x
        const li = rowP + x
        const ri = li + 1
        const bi = i
        const ti = i + w
        const L = fluxX[li]
        const R = fluxX[ri]
        const B = fluxY[bi]
        const T = fluxY[ti]
        let out = 0
        if (L < 0) out -= L
        if (R > 0) out += R
        if (B < 0) out -= B
        if (T > 0) out += T
        if (out <= 0) continue
        const avail = depth[i] * area
        const want = out * dt
        if (want <= avail) continue
        const kk = avail > 0 ? avail / want : 0
        if (L < 0) fluxX[li] = L * kk
        if (R > 0) fluxX[ri] = R * kk
        if (B < 0) fluxY[bi] = B * kk
        if (T > 0) fluxY[ti] = T * kk
      }
    }
  }

  private applyFlux(dt: number): void {
    const { grid, depth, fluxX, fluxY } = this
    const { w, h } = grid
    const invArea = dt / (CELL * CELL)
    for (let y = 0; y < h; y++) {
      const rowP = y * (w + 1)
      const rowC = y * w
      for (let x = 0; x < w; x++) {
        const i = rowC + x
        const net = fluxX[rowP + x] - fluxX[rowP + x + 1] + fluxY[i] - fluxY[i + w]
        const d = depth[i] + net * invArea
        depth[i] = d > 0 ? d : 0 // 数値誤差の保険（limitOutflow により本来起きない）
      }
    }
  }

  private evaporate(dt: number, rate: number): void {
    const { depth } = this
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i]
      if (d <= 0) continue
      // 蒸発は水面で起きるので、深さでそれほど変わらない。浅いほうがよく温まるぶん
      // 少しだけ速い、という程度にする。以前は深さ 0.5 で係数が下限に張り付いていて、
      // 貯めた水がいつまでも減らなかった。
      const f = 0.6 + 0.4 / (1 + d * 2)
      const nd = d - rate * f * dt
      depth[i] = nd > 0 ? nd : 0
    }
  }

  /** 浮いたソリッド（橋など）より上には水を溜めず、余りは空きのある隣へ回す。 */
  private clampCeiling(): void {
    const { grid, depth } = this
    for (let i = 0; i < depth.length; i++) {
      const cap = grid.ceiling[i] - grid.bed(i)
      const excess = depth[i] - cap
      if (excess <= 0) continue
      let moved = 0
      grid.forEachNeighbor(i, (n) => {
        if (moved >= excess) return
        const room = grid.ceiling[n] - grid.bed(n) - depth[n]
        if (room <= 0) return
        const give = Math.min(room, excess - moved)
        depth[n] += give
        moved += give
      })
      depth[i] -= moved
    }
  }
}

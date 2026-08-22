import { Grid } from '../core/grid'
import { WaterSim } from './water'
import {
  IRRIGATION_MIN_DEPTH,
  MOISTURE_RANGE,
  MOISTURE_UP_COST,
  SOIL_DRY_RATE,
  SOIL_WET_RATE,
} from '../data/constants'

export interface MoistureSource {
  i: number
  strength: number
}

/**
 * 土壌水分（灌漑）。
 *
 * 水辺と稼働中の灌漑塔を始点に、整数コストのダイクストラで「届く湿り気」を求める。
 * 斜面を登るほどコストが増えるので、高台は水辺のすぐ横でも乾いたままになる。
 * 実際の土壌 soilWet は目標値へ徐々に近づく（乾くのは遅い）ので、乾季に入っても
 * すぐには枯れず、灌漑塔を建てれば間に合う、という猶予が生まれる。
 */
export class Irrigation {
  readonly grid: Grid
  /** 到達した湿り気の強さ（0 = 乾燥） */
  readonly moisture: Float64Array
  /** 実際の土壌水分 0..1 */
  readonly soilWet: Float64Array

  private readonly best: Int32Array
  private readonly buckets: number[][]

  constructor(grid: Grid) {
    this.grid = grid
    this.moisture = new Float64Array(grid.size)
    this.soilWet = new Float64Array(grid.size)
    this.best = new Int32Array(grid.size)
    this.buckets = []
  }

  /** 湿り気の到達範囲を再計算する（数 tick に 1 回でよい） */
  recompute(water: WaterSim, extra: readonly MoistureSource[]): void {
    const { grid, best, moisture } = this
    let maxStrength = MOISTURE_RANGE
    for (const s of extra) if (s.strength > maxStrength) maxStrength = s.strength
    maxStrength = Math.ceil(maxStrength)

    best.fill(-1)
    const buckets = this.buckets
    buckets.length = maxStrength + 1
    for (let b = 0; b <= maxStrength; b++) buckets[b] = buckets[b] ? ((buckets[b].length = 0), buckets[b]) : []

    const push = (i: number, r: number) => {
      if (r <= 0 || r <= best[i]) return
      best[i] = r
      buckets[maxStrength - r].push(i)
    }
    for (let i = 0; i < grid.size; i++) {
      if (water.depth[i] >= IRRIGATION_MIN_DEPTH) push(i, MOISTURE_RANGE)
    }
    for (const s of extra) push(s.i, Math.ceil(s.strength))

    for (let b = 0; b <= maxStrength; b++) {
      const bucket = buckets[b]
      for (let qi = 0; qi < bucket.length; qi++) {
        const i = bucket[qi]
        const r = maxStrength - b
        if (best[i] !== r) continue // 後からより強い値が入った
        const gi = grid.ground[i]
        grid.forEachNeighbor(i, (n) => {
          const climb = grid.ground[n] - gi
          const cost = 1 + (climb > 0 ? climb * MOISTURE_UP_COST : 0)
          push(n, r - cost)
        })
      }
    }

    for (let i = 0; i < grid.size; i++) moisture[i] = best[i] > 0 ? best[i] : 0
  }

  /** 目標値に向けて土壌水分を緩やかに動かす（毎 tick） */
  advance(): void {
    const { moisture, soilWet } = this
    for (let i = 0; i < soilWet.length; i++) {
      const target = moisture[i] > 0 ? 1 : 0
      const cur = soilWet[i]
      if (cur < target) soilWet[i] = Math.min(target, cur + SOIL_WET_RATE)
      else if (cur > target) soilWet[i] = Math.max(target, cur - SOIL_DRY_RATE)
    }
  }
}

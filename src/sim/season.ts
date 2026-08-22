import {
  DROUGHT_DAYS_BASE,
  DROUGHT_DAYS_MAX,
  DROUGHT_DAYS_STEP,
  SEASON_RAMP_TICKS,
  TEMPERATE_DAYS,
  TICKS_PER_DAY,
} from '../data/constants'

export type SeasonKind = 'temperate' | 'drought'

/**
 * 季節。温暖期と乾季を繰り返し、サイクルごとに乾季が 1 日ずつ延びる。
 * 水源の流量は切替時に 1 日かけてランプするので、川は徐々に細っていく。
 */
export class Season {
  kind: SeasonKind = 'temperate'
  /** 現在の季節に入ってからの tick */
  elapsed = 0
  /** 通算日数 */
  day = 0
  dayTick = 0
  cycle = 0

  get lengthDays(): number {
    return this.kind === 'temperate' ? TEMPERATE_DAYS : this.droughtDays
  }
  get droughtDays(): number {
    return Math.min(DROUGHT_DAYS_MAX, DROUGHT_DAYS_BASE + this.cycle * DROUGHT_DAYS_STEP)
  }
  get daysLeft(): number {
    return Math.max(0, Math.ceil((this.lengthDays * TICKS_PER_DAY - this.elapsed) / TICKS_PER_DAY))
  }

  /** 1 tick 進め、日が変わったら true */
  advance(): boolean {
    this.elapsed++
    this.dayTick++
    let newDay = false
    if (this.dayTick >= TICKS_PER_DAY) {
      this.dayTick = 0
      this.day++
      newDay = true
    }
    if (this.elapsed >= this.lengthDays * TICKS_PER_DAY) {
      this.elapsed = 0
      if (this.kind === 'temperate') {
        this.kind = 'drought'
      } else {
        this.kind = 'temperate'
        this.cycle++
      }
    }
    return newDay
  }

  /** 水源の流量倍率 0..1 */
  get sourceStrength(): number {
    const ramp = Math.min(1, this.elapsed / SEASON_RAMP_TICKS)
    return this.kind === 'temperate' ? ramp : 1 - ramp
  }
}

import { Rng } from '../core/rng'
import {
  DROUGHT_DAYS_MAX,
  DROUGHT_DAYS_STEP,
  EVAP_MULT,
  IGNITE_MULT,
  RAIN_RATE,
  SEASON_DAYS,
  SEASON_OMEN_DAYS,
  SEASON_RAMP_TICKS,
  SEASON_WEIGHT,
  SOURCE_STRENGTH,
  TICKS_PER_DAY,
} from '../data/constants'

export type SeasonKind = 'normal' | 'rain' | 'drought'

export const SEASON_KINDS: readonly SeasonKind[] = ['normal', 'rain', 'drought']

export const SEASON_LABEL: Record<SeasonKind, string> = {
  normal: '平年',
  rain: '大雨',
  drought: '日照り',
}

/** 残り日数が少なくなったときに出す前触れ */
export const SEASON_OMEN: Record<SeasonKind, string> = {
  normal: '風が落ち着いてきた',
  rain: '雨の匂いがする',
  drought: '照りが続きそうだ',
}

/**
 * 季節。平年・大雨・日照りをランダムに引く。
 *
 * 抽選には World の Rng を使うので、セーブを跨いでも同じ並びになる。
 * 直前と同じ季節は引かない（16 日続く日照りのような理不尽を避ける）。
 * 次に来る季節は季節の開始時点で決まっているが、プレイヤーには残り
 * SEASON_OMEN_DAYS 日を切ってからしか見せない。備える猶予は必ず与えつつ、
 * 何が来るかは最後まで分からない、という緊張を残すため。
 */
export class Season {
  kind: SeasonKind = 'normal'
  /** 直前の季節。水源の強さをここから繋ぐ */
  prevKind: SeasonKind = 'normal'
  /** 次の季節（未抽選なら null）。forecast 越しにしか見せない */
  nextKind: SeasonKind | null = null
  /** 抽選済みの今の季節の長さ（0 = 未抽選） */
  lengthDays = 0
  /** 今の季節に入ってからの tick */
  elapsed = 0
  /** 通算日数 */
  day = 0
  dayTick = 0
  /** 通過した日照りの数。日照りはこれに比例して長くなる */
  cycle = 0

  get daysLeft(): number {
    if (this.lengthDays <= 0) return 0
    return Math.max(0, Math.ceil((this.lengthDays * TICKS_PER_DAY - this.elapsed) / TICKS_PER_DAY))
  }

  /** 前触れが出ていれば次の季節、まだなら null */
  get forecast(): SeasonKind | null {
    return this.daysLeft <= SEASON_OMEN_DAYS ? this.nextKind : null
  }

  /** 水源の流量倍率。季節の変わり目は 1 日かけて繋ぐ */
  get sourceStrength(): number {
    return this.blend(SOURCE_STRENGTH)
  }
  /** 蒸発の倍率 */
  get evapMult(): number {
    return this.blend(EVAP_MULT)
  }
  /** 降雨 [m/s]。平年と日照りは 0 */
  get rainRate(): number {
    return this.kind === 'rain' || this.prevKind === 'rain'
      ? this.blend({ normal: 0, rain: RAIN_RATE, drought: 0 })
      : 0
  }
  /** 出火のしやすさ。こちらは繋がずに切り替える */
  get igniteMult(): number {
    return IGNITE_MULT[this.kind]
  }

  private blend(table: Record<SeasonKind, number>): number {
    const t = Math.min(1, this.elapsed / SEASON_RAMP_TICKS)
    const from = table[this.prevKind]
    const to = table[this.kind]
    return from + (to - from) * t
  }

  /** 1 tick 進め、日が変わったら true */
  advance(rng: Rng): boolean {
    // 最初の季節ぶんもここで引く（World の構築時は rng をまだ触れないため）
    if (this.lengthDays <= 0) this.lengthDays = drawLength(this.kind, this.cycle, rng)
    if (this.nextKind === null) this.nextKind = drawKind(this.kind, rng)

    this.elapsed++
    this.dayTick++
    let newDay = false
    if (this.dayTick >= TICKS_PER_DAY) {
      this.dayTick = 0
      this.day++
      newDay = true
    }
    if (this.elapsed >= this.lengthDays * TICKS_PER_DAY) {
      if (this.kind === 'drought') this.cycle++
      this.prevKind = this.kind
      this.kind = this.nextKind
      this.elapsed = 0
      this.lengthDays = drawLength(this.kind, this.cycle, rng)
      this.nextKind = drawKind(this.kind, rng)
    }
    return newDay
  }
}

/** 直前と同じ季節は引かず、残りから重み付きで選ぶ */
function drawKind(current: SeasonKind, rng: Rng): SeasonKind {
  const pool = SEASON_KINDS.filter((k) => k !== current)
  let total = 0
  for (const k of pool) total += SEASON_WEIGHT[k]
  let r = rng.next() * total
  for (const k of pool) {
    r -= SEASON_WEIGHT[k]
    if (r < 0) return k
  }
  return pool[pool.length - 1]
}

function drawLength(kind: SeasonKind, cycle: number, rng: Rng): number {
  const [lo, hi] = SEASON_DAYS[kind]
  const base = kind === 'drought' ? lo + cycle * DROUGHT_DAYS_STEP : lo
  const days = base + rng.int(hi - lo + 1)
  return kind === 'drought' ? Math.min(DROUGHT_DAYS_MAX, days) : days
}

import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { Game } from '../src/core/game'
import { Season, SeasonKind } from '../src/sim/season'
import {
  DRY_EPSILON,
  DROUGHT_DAYS_MAX,
  SEASON_DAYS,
  SEASON_OMEN_DAYS,
  SEASON_RAMP_TICKS,
  SOURCE_STRENGTH,
  TICKS_PER_DAY,
} from '../src/data/constants'

/**
 * 季節が切り替わるたびに (種類, 長さ) を記録しながら days 日ぶん回す。
 * 切替の検出は「elapsed が 0 に戻ったこと」で行う。種類の変化で見ると、
 * 同じ季節を 2 回続けて引いてしまったときにそれを見逃す。
 */
function runSeasons(seed: number, days: number): { kind: SeasonKind; days: number }[] {
  const s = new Season()
  const rng = new Rng(seed)
  s.advance(rng) // 最初の季節の長さがここで引かれる
  const out: { kind: SeasonKind; days: number }[] = [{ kind: s.kind, days: s.lengthDays }]
  for (let t = 1; t < days * TICKS_PER_DAY; t++) {
    s.advance(rng)
    if (s.elapsed === 0) out.push({ kind: s.kind, days: s.lengthDays })
  }
  return out
}

describe('季節', () => {
  it('平年・大雨・日照りが出そろい、同じ季節は続かない', () => {
    const seq = runSeasons(7, 600)
    expect(seq.length).toBeGreaterThan(15)
    const kinds = new Set(seq.map((s) => s.kind))
    expect([...kinds].sort()).toEqual(['drought', 'normal', 'rain'])
    for (let i = 1; i < seq.length; i++) expect(seq[i].kind).not.toBe(seq[i - 1].kind)
  })

  it('季節の長さは決められた範囲に収まる', () => {
    const seq = runSeasons(11, 900)
    for (const s of seq) {
      const [lo, hi] = SEASON_DAYS[s.kind]
      expect(s.days).toBeGreaterThanOrEqual(lo)
      // 日照りだけは通過するたびに延びる（上限あり）
      expect(s.days).toBeLessThanOrEqual(s.kind === 'drought' ? DROUGHT_DAYS_MAX : hi)
    }
  })

  it('日照りは繰り返すほど長くなる', () => {
    const seq = runSeasons(3, 3000).filter((s) => s.kind === 'drought')
    expect(seq.length).toBeGreaterThan(8)
    const first = seq.slice(0, 3).reduce((a, s) => a + s.days, 0) / 3
    const later = seq.slice(-3).reduce((a, s) => a + s.days, 0) / 3
    expect(later).toBeGreaterThan(first + 2)
  })

  it('同じシードなら同じ並びになる', () => {
    expect(runSeasons(42, 400)).toEqual(runSeasons(42, 400))
    expect(runSeasons(42, 400)).not.toEqual(runSeasons(43, 400))
  })

  it('次の季節は残り 2 日を切ってからしか分からない', () => {
    const s = new Season()
    const rng = new Rng(5)
    let revealed = 0
    let hidden = 0
    for (let t = 0; t < 200 * TICKS_PER_DAY; t++) {
      s.advance(rng)
      if (s.forecast === null) {
        hidden++
        expect(s.daysLeft).toBeGreaterThan(SEASON_OMEN_DAYS)
      } else {
        revealed++
        expect(s.daysLeft).toBeLessThanOrEqual(SEASON_OMEN_DAYS)
        // 見えている前触れは、実際に次に来る季節と一致する
        expect(s.forecast).toBe(s.nextKind)
      }
    }
    expect(revealed).toBeGreaterThan(0)
    expect(hidden).toBeGreaterThan(revealed) // 伏せられている時間のほうが長い
  })

  it('季節の変わり目は水源の強さが繋がっていく', () => {
    const s = new Season()
    s.prevKind = 'drought'
    s.kind = 'rain'
    s.elapsed = 0
    expect(s.sourceStrength).toBeCloseTo(SOURCE_STRENGTH.drought, 5) // 日照りの流量から
    s.elapsed = SEASON_RAMP_TICKS / 2
    expect(s.sourceStrength).toBeCloseTo(SOURCE_STRENGTH.rain / 2, 5) // 半分まで来た
    s.elapsed = SEASON_RAMP_TICKS
    expect(s.sourceStrength).toBeCloseTo(SOURCE_STRENGTH.rain, 5) // 大雨の流量へ
    // 短い季節でも大半を本気の状態で過ごせるよう、繋ぎは 1 日より短い
    expect(SEASON_RAMP_TICKS).toBeLessThan(TICKS_PER_DAY)
  })
})

/** 季節をその場に固定して days 日ぶん回す */
function forceSeason(g: Game, kind: SeasonKind, days: number): void {
  const s = g.world.season
  s.kind = kind
  s.prevKind = kind // ランプを挟まず、その季節の効果だけを見る
  s.elapsed = 0
  s.lengthDays = days + 10
  for (let t = 0; t < days * TICKS_PER_DAY; t++) g.step()
}

describe('季節が水に及ぼす影響', () => {
  it('大雨で増水し、日照りで干上がる', () => {
    const g = new Game({ w: 60, h: 60, seed: 21 })
    forceSeason(g, 'normal', 3)
    const base = g.world.water.totalVolume()

    forceSeason(g, 'rain', 8)
    const wet = g.world.water.totalVolume()
    expect(wet).toBeGreaterThan(base * 2) // 実測 2.25 倍

    forceSeason(g, 'drought', 8)
    expect(g.world.water.totalVolume()).toBeLessThan(base * 0.4) // 実測 0.23 倍
  }, 60000)

  it('大雨では氾濫原が浸かり、微高地と段丘は残る', () => {
    const g = new Game({ w: 60, h: 60, seed: 21 })
    forceSeason(g, 'normal', 3)
    const { grid, water } = g.world

    /**
     * 行ごとの最低地面を基準に地形を段で分ける。
     * mapgen の断面が 水路(+0) → 浅瀬(+1) → 氾濫原(+2、たまに +3 の微高地) → 段丘(+4 以上)
     * なので、この段数がそのまま地形の種類になる。
     */
    const band = (step: number): { wet: number; depth: number } => {
      let n = 0
      let wet = 0
      let sum = 0
      for (let y = 2; y < grid.h - 2; y++) {
        let min = 99
        for (let x = 0; x < grid.w; x++) min = Math.min(min, grid.ground[grid.idx(x, y)])
        for (let x = 2; x < grid.w - 2; x++) {
          const i = grid.idx(x, y)
          if (grid.ground[i] - min !== step) continue
          n++
          if (water.depth[i] > 0.05) wet++
          sum += water.depth[i]
        }
      }
      return { wet: n > 0 ? wet / n : 0, depth: n > 0 ? sum / n : 0 }
    }

    // 平年は川筋だけが濡れている
    expect(band(2).wet).toBeLessThan(0.05)

    forceSeason(g, 'rain', 6)
    // 氾濫原は水を被る（実測 8 割、平均 0.2 m）。畑は流されるが逃げ場は残る
    expect(band(2).wet).toBeGreaterThan(0.6)
    expect(band(2).depth).toBeGreaterThan(0.12)
    // 一段高い微高地と段丘は浸からない
    expect(band(3).wet).toBeLessThan(0.05)
    expect(band(4).wet).toBe(0)
  }, 60000)

  it('雨は高台に抜けない水たまりを残さない', () => {
    const g = new Game({ w: 60, h: 60, seed: 21 })
    forceSeason(g, 'normal', 3)
    const { grid, water } = g.world
    const flooded = (): number => {
      let n = 0
      // 段丘の上（川床より 5 段以上高い）に水が乗っている列
      for (let i = 0; i < grid.size; i++) if (grid.ground[i] >= 12 && water.depth[i] > DRY_EPSILON) n++
      return n
    }
    expect(flooded()).toBe(0)
    forceSeason(g, 'rain', 8)
    expect(flooded()).toBe(0)
  }, 60000)
})

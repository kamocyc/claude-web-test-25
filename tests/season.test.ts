import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { Game } from '../src/core/game'
import { Season, SeasonKind } from '../src/sim/season'
import {
  DRY_EPSILON,
  DROUGHT_DAYS_MAX,
  SEASON_DAYS,
  SEASON_OMEN_DAYS,
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

  it('季節の変わり目は水源の強さが 1 日かけて繋がる', () => {
    const s = new Season()
    s.prevKind = 'drought'
    s.kind = 'rain'
    s.elapsed = 0
    expect(s.sourceStrength).toBeCloseTo(0, 5) // 日照りの流量から
    s.elapsed = TICKS_PER_DAY / 2
    expect(s.sourceStrength).toBeCloseTo(1.1, 5)
    s.elapsed = TICKS_PER_DAY
    expect(s.sourceStrength).toBeCloseTo(2.2, 5) // 大雨の流量へ
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

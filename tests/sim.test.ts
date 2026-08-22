import { describe, expect, it } from 'vitest'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, place } from '../src/sim/structures'
import { TICKS_PER_DAY } from '../src/data/constants'
import { deserializeInto, serialize } from '../src/save/save'

function hash(game: Game): number {
  const w = game.world
  let s = w.citizens.length * 31 + w.buildings.length * 7
  for (let i = 0; i < w.water.depth.length; i += 37) s = (s * 31 + w.water.depth[i] * 1000) % 1e9
  s += w.stock.water * 13 + w.stock.log * 17 + w.stock.bread * 19
  for (const c of w.citizens) s += c.i * 3 + c.needs.water * 100
  return Math.round(s * 1000)
}

describe('ワールド', () => {
  it('生成直後に川と入植者がいる', () => {
    const g = new Game({ w: 48, h: 48, seed: 7 })
    expect(g.world.citizens.length).toBe(5)
    expect(g.world.water.totalVolume()).toBeGreaterThan(50)
    expect(g.world.buildings.length).toBe(1)
  })

  it('長時間回しても破綻しない', () => {
    const g = new Game({ w: 48, h: 48, seed: 7 })
    for (let t = 0; t < TICKS_PER_DAY * 4; t++) g.step()
    for (let i = 0; i < g.world.water.depth.length; i++) {
      expect(Number.isFinite(g.world.water.depth[i])).toBe(true)
      expect(g.world.water.depth[i]).toBeGreaterThanOrEqual(0)
    }
    // 川は流れ続けている
    expect(g.world.water.totalVolume()).toBeGreaterThan(20)
    // 初期資源がある間は誰も死なない
    expect(g.world.citizens.length).toBe(5)
  })

  it('同じシードなら完全に同じ結果になる', () => {
    const a = new Game({ w: 40, h: 40, seed: 99 })
    const b = new Game({ w: 40, h: 40, seed: 99 })
    for (let t = 0; t < 600; t++) {
      a.step()
      b.step()
    }
    expect(hash(a)).toBe(hash(b))
  })

  it('乾季になると水源が止まり貯水が減る', () => {
    const g = new Game({ w: 40, h: 40, seed: 5 })
    while (g.world.season.kind === 'temperate') g.step()
    const atStart = g.world.water.totalVolume()
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()
    expect(g.world.season.kind).toBe('drought')
    expect(g.world.water.totalVolume()).toBeLessThan(atStart * 0.9)
  })

  it('揚水ポンプは水辺にしか建てられない', () => {
    const g = new Game({ w: 48, h: 48, seed: 3 })
    const pump = defOf('pump')
    const dry = g.world.startI
    expect(canPlace(g.world, pump, dry).ok).toBe(false)
    // 川沿いを探す
    let shore = -1
    for (let i = 0; i < g.world.grid.size && shore < 0; i++) {
      if (canPlace(g.world, pump, i).ok) shore = i
    }
    expect(shore).toBeGreaterThanOrEqual(0)
  })

  it('堤防を水中に建てても総水量は保存される', () => {
    const g = new Game({ w: 40, h: 40, seed: 11 })
    for (let t = 0; t < 100; t++) g.step()
    let wet = -1
    for (let i = 0; i < g.world.grid.size; i++) {
      if (g.world.water.depth[i] > 0.5) {
        wet = i
        break
      }
    }
    expect(wet).toBeGreaterThanOrEqual(0)
    const before = g.world.water.totalVolume()
    const b = place(g.world, defOf('levee'), wet)
    expect(b).not.toBeNull()
    // 建設完了を強制
    completeBuild(g.world, b!)
    expect(g.world.water.totalVolume()).toBeCloseTo(before, 8)
    expect(g.world.grid.ground[wet]).toBe(g.world.grid.natural[wet] + 1)
  })

  it('揚水ポンプを建てて人を配属すると水が増える', () => {
    const g = new Game({ w: 48, h: 48, seed: 3 })
    for (let t = 0; t < 100; t++) g.step()
    // 入植地から一番近い岸を選ぶ（遠すぎる岸だと働き手が通えない）
    const grid = g.world.grid
    const sx = grid.xOf(g.world.startI)
    const sy = grid.yOf(g.world.startI)
    let shore = -1
    let bestD = Infinity
    for (let i = 0; i < grid.size; i++) {
      if (!canPlace(g.world, defOf('pump'), i).ok) continue
      const d = Math.abs(grid.xOf(i) - sx) + Math.abs(grid.yOf(i) - sy)
      if (d < bestD) {
        bestD = d
        shore = i
      }
    }
    expect(shore).toBeGreaterThanOrEqual(0)
    const pump = place(g.world, defOf('pump'), shore)!
    completeBuild(g.world, pump)
    g.world.stock.water = 0
    for (let t = 0; t < 400; t++) g.step()
    expect(pump.workers.length).toBe(1)
    expect(g.world.stock.water).toBeGreaterThan(0)
  })

  it('資材が足りなければ建設できない', () => {
    const g = new Game({ w: 40, h: 40, seed: 13 })
    g.world.stock.log = 0
    const spot = g.world.startI + g.world.grid.w * 2
    expect(canPlace(g.world, defOf('house'), spot).ok).toBe(false)
  })
})

describe('セーブ／ロード', () => {
  it('保存して復元すると以降の進行まで一致する', () => {
    const a = new Game({ w: 40, h: 40, seed: 42 })
    for (let t = 0; t < 300; t++) a.step()
    const json = serialize(a.world)

    const b = new Game({ w: 40, h: 40, seed: 999 })
    expect(deserializeInto(b.world, json)).toBe(true)
    b.path.refresh(b.world.water)
    expect(hash(b)).toBe(hash(a))

    for (let t = 0; t < 200; t++) {
      a.step()
      b.step()
    }
    expect(hash(b)).toBe(hash(a))
  })

  it('マップの大きさが違うセーブは拒否する', () => {
    const a = new Game({ w: 40, h: 40, seed: 1 })
    const json = serialize(a.world)
    const b = new Game({ w: 48, h: 48, seed: 1 })
    expect(deserializeInto(b.world, json)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { createSampleGame } from '../src/data/sampleTown'
import { defOf } from '../src/data/buildings'
import { TICKS_PER_DAY } from '../src/data/constants'
import { Game } from '../src/core/game'

function countOf(g: Game, defId: string): number {
  return g.world.buildings.filter((b) => b.defId === defId).length
}

describe('サンプルの町', () => {
  it('主要な建物が揃っていて、全部完成している', () => {
    const g = createSampleGame(64, 64)
    expect(g.world.buildings.filter((b) => !b.built)).toEqual([])
    for (const id of ['pump', 'house', 'storage', 'lumberjack', 'sawmill', 'bakery', 'farm', 'irrigation', 'dam', 'floodgate']) {
      expect(countOf(g, id), `${defOf(id).name} が無い`).toBeGreaterThan(0)
    }
    expect(countOf(g, 'farm')).toBeGreaterThanOrEqual(4)
    expect(g.world.citizens.length).toBeGreaterThanOrEqual(14)
  }, 60000)

  it('職場に働き手が付いて町が回っている', () => {
    const g = createSampleGame(64, 64)
    const w = g.world
    const staffed = w.buildings.filter((b) => defOf(b.defId).workers > 0 && b.workers.length > 0)
    expect(staffed.length).toBeGreaterThanOrEqual(5)

    // さらに数日回しても人が減らず、水と食料が尽きない
    const pop = w.citizens.length
    w.stock.water = 0
    w.stock.bread = 0
    w.stock.wheat = 0
    for (let t = 0; t < TICKS_PER_DAY * 4; t++) g.step()
    expect(w.citizens.length).toBeGreaterThanOrEqual(pop)
    expect(w.stock.water).toBeGreaterThan(0)
    expect(w.stock.wheat + w.stock.bread).toBeGreaterThan(0)
  }, 60000)

  it('堰の上流に貯水池ができている', () => {
    const g = createSampleGame(64, 64)
    const w = g.world
    const weir = w.buildings.find((b) => b.defId === 'dam')!
    const row = w.grid.yOf(weir.i)
    let up = 0
    for (let y = 0; y < row; y++) {
      for (let x = 0; x < w.grid.w; x++) up += w.water.depth[w.grid.idx(x, y)]
    }
    expect(up).toBeGreaterThan(50)
    // 堰の直上流の流路はしっかり水を湛えている（両端は岸なので最大値で見る）
    let deepest = 0
    for (let x = 0; x < w.grid.w; x++) {
      deepest = Math.max(deepest, w.water.depth[w.grid.idx(x, row - 1)])
    }
    expect(deepest).toBeGreaterThan(0.5)
  }, 60000)

  it('同じシードなので毎回同じ町になる', () => {
    const a = createSampleGame(64, 64)
    const b = createSampleGame(64, 64)
    expect(b.world.buildings.map((x) => `${x.defId}@${x.i}`)).toEqual(
      a.world.buildings.map((x) => `${x.defId}@${x.i}`),
    )
    expect(b.world.stock).toEqual(a.world.stock)
  }, 60000)
})

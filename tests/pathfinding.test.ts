import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { WaterSim } from '../src/sim/water'
import { PathFinder } from '../src/sim/pathfinding'

function make(w: number, h: number): { grid: Grid; water: WaterSim; pf: PathFinder } {
  const grid = new Grid(w, h)
  grid.natural.fill(2)
  grid.refreshAllGround()
  const water = new WaterSim(grid)
  const pf = new PathFinder(grid)
  pf.refresh(water)
  return { grid, water, pf }
}

describe('経路探索', () => {
  it('平地では最短距離で歩く', () => {
    const { grid, pf } = make(10, 10)
    const p = pf.find(grid.idx(0, 0), grid.idx(4, 3))
    expect(p).not.toBeNull()
    expect(p!.length).toBe(7)
  })

  it('2 段の段差は登れないがテラスなら登れる', () => {
    const { grid, water, pf } = make(10, 3)
    for (let y = 0; y < 3; y++) {
      grid.natural[grid.idx(5, y)] = 4 // 2 段上がる壁
      grid.natural[grid.idx(6, y)] = 4
    }
    grid.refreshAllGround()
    pf.refresh(water)
    expect(pf.find(grid.idx(0, 1), grid.idx(7, 1))).toBeNull()
    grid.natural[grid.idx(5, 1)] = 3 // 1 段ずつのテラスにする
    grid.refreshAllGround()
    pf.refresh(water)
    expect(pf.find(grid.idx(0, 1), grid.idx(7, 1))).not.toBeNull()
  })

  it('深い水は通れない', () => {
    const { grid, water, pf } = make(9, 3)
    for (let y = 0; y < 3; y++) water.depth[grid.idx(4, y)] = 2
    pf.refresh(water)
    expect(pf.find(grid.idx(0, 1), grid.idx(8, 1))).toBeNull()
    for (let y = 0; y < 3; y++) water.depth[grid.idx(4, y)] = 0.4 // 浅瀬なら渡れる
    pf.refresh(water)
    expect(pf.find(grid.idx(0, 1), grid.idx(8, 1))).not.toBeNull()
  })

  it('到達不能なら null を返す（無限に探し続けない）', () => {
    const { grid, water, pf } = make(8, 8)
    for (let y = 0; y < 8; y++) {
      grid.natural[grid.idx(4, y)] = 9
    }
    grid.refreshAllGround()
    pf.refresh(water)
    expect(pf.find(grid.idx(0, 0), grid.idx(7, 7))).toBeNull()
  })
})

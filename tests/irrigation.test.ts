import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { WaterSim } from '../src/sim/water'
import { Irrigation } from '../src/sim/irrigation'
import { MOISTURE_RANGE } from '../src/data/constants'

function setup(): { grid: Grid; water: WaterSim; irr: Irrigation } {
  const grid = new Grid(40, 5)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const water = new WaterSim(grid)
  const irr = new Irrigation(grid)
  return { grid, water, irr }
}

describe('灌漑', () => {
  it('水辺から離れるほど湿り気が下がり、射程を超えると乾く', () => {
    const { grid, water, irr } = setup()
    const src = grid.idx(0, 2)
    water.depth[src] = 1
    irr.recompute(water, [])
    expect(irr.moisture[grid.idx(1, 2)]).toBeGreaterThan(irr.moisture[grid.idx(5, 2)])
    expect(irr.moisture[grid.idx(5, 2)]).toBeGreaterThan(0)
    expect(irr.moisture[grid.idx(MOISTURE_RANGE + 2, 2)]).toBe(0)
  })

  it('斜面を登るほど届きにくい', () => {
    const { grid, water, irr } = setup()
    const src = grid.idx(0, 2)
    water.depth[src] = 1
    // y=1 の列だけ 1 段高くする
    for (let x = 0; x < grid.w; x++) {
      const i = grid.idx(x, 1)
      grid.natural[i] = 5
      grid.refreshGround(i)
    }
    irr.recompute(water, [])
    expect(irr.moisture[grid.idx(3, 1)]).toBeLessThan(irr.moisture[grid.idx(3, 2)])
  })

  it('灌漑塔は水が無い場所にも湿り気を供給する', () => {
    const { grid, water, irr } = setup()
    const tower = grid.idx(30, 2)
    irr.recompute(water, [])
    expect(irr.moisture[tower]).toBe(0)
    irr.recompute(water, [{ i: tower, strength: 8 }])
    expect(irr.moisture[tower]).toBe(8)
    expect(irr.moisture[grid.idx(34, 2)]).toBeGreaterThan(0)
    expect(irr.moisture[grid.idx(39, 2)]).toBe(0)
  })

  it('土壌水分はゆっくり乾く', () => {
    const { grid, water, irr } = setup()
    water.depth[grid.idx(0, 2)] = 1
    irr.recompute(water, [])
    for (let t = 0; t < 200; t++) irr.advance()
    const near = grid.idx(2, 2)
    expect(irr.soilWet[near]).toBeCloseTo(1, 5)
    water.depth[grid.idx(0, 2)] = 0
    irr.recompute(water, [])
    irr.advance()
    expect(irr.soilWet[near]).toBeGreaterThan(0.9) // 1 tick では枯れない
    for (let t = 0; t < 300; t++) irr.advance()
    expect(irr.soilWet[near]).toBe(0)
  })
})

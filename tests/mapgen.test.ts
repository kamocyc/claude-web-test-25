import { describe, expect, it } from 'vitest'
import { Game } from '../src/core/game'
import { World } from '../src/core/world'
import { SOIL_GROW_THRESHOLD, TICKS_PER_DAY } from '../src/data/constants'

const run = (g: Game, ticks: number) => {
  for (let t = 0; t < ticks; t++) g.step()
}

/** その行にある「同じ高さで水没していない列」の最長の連なり */
function longestFlatRun(w: World, y: number): number {
  const { grid, water } = w
  let best = 0
  let len = 0
  let prev = -1
  for (let x = 0; x < grid.w; x++) {
    const i = grid.idx(x, y)
    const ok = water.depth[i] < 0.05
    if (ok && grid.ground[i] === prev) len++
    else len = ok ? 1 : 0
    prev = ok ? grid.ground[i] : -1
    if (len > best) best = len
  }
  return best
}

describe('地形', () => {
  it('川の両側にまとまった平地がある', () => {
    const g = new Game({ w: 64, h: 64, seed: 5 })
    run(g, TICKS_PER_DAY) // 水位を落ち着かせてから測る
    const w = g.world
    let wide = 0
    let rows = 0
    for (let y = 6; y < w.grid.h - 6; y++) {
      rows++
      if (longestFlatRun(w, y) >= 8) wide++
    }
    // ほとんどの行に、8 マス以上つながった平地がある
    expect(wide / rows).toBeGreaterThan(0.9)
  }, 60000)

  it('平地は水没しておらず、川は水路に収まっている', () => {
    const g = new Game({ w: 64, h: 64, seed: 5 })
    run(g, TICKS_PER_DAY * 2)
    const w = g.world
    let wet = 0
    for (let i = 0; i < w.grid.size; i++) if (w.water.depth[i] > 0.05) wet++
    // 川は谷底の一部だけを占め、盤面を覆い尽くさない
    expect(wet / w.grid.size).toBeLessThan(0.2)
    // それでいて揚水できる深さはある
    let deep = 0
    for (let i = 0; i < w.grid.size; i++) if (w.water.depth[i] >= 0.5) deep++
    expect(deep).toBeGreaterThan(100)
  }, 60000)

  it('川沿いにそのまま耕せる土地が広がっている', () => {
    const g = new Game({ w: 64, h: 64, seed: 5 })
    run(g, TICKS_PER_DAY)
    const w = g.world
    let farmable = 0
    for (let i = 0; i < w.grid.size; i++) {
      if (w.water.depth[i] === 0 && w.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD) farmable++
    }
    // 灌漑塔を建てるまでもなく、開始直後から数百マスは耕せる
    expect(farmable).toBeGreaterThan(400)
  }, 60000)
})

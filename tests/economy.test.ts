import { describe, expect, it } from 'vitest'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canPlace, place } from '../src/sim/structures'
import { SOIL_GROW_THRESHOLD, TICKS_PER_DAY } from '../src/data/constants'

/** 入植地の近くで条件に合う空き地を探す */
function spotNear(g: Game, defId: string, extra?: (i: number) => boolean): number {
  const { grid } = g.world
  const sx = grid.xOf(g.world.startI)
  const sy = grid.yOf(g.world.startI)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < grid.size; i++) {
    if (!canPlace(g.world, defOf(defId), i).ok) continue
    if (extra && !extra(i)) continue
    const d = Math.abs(grid.xOf(i) - sx) + Math.abs(grid.yOf(i) - sy)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function run(g: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) g.step()
}

describe('経済のひと回り', () => {
  it('水汲み・伐採・製材・畑がつながって人口が維持できる', () => {
    const g = new Game({ w: 48, h: 48, seed: 21 })
    const w = g.world
    run(g, 60)

    const order = ['pump', 'house', 'lumberjack', 'farm', 'sawmill', 'mill']
    const placed: string[] = []
    for (const id of order) {
      const i =
        id === 'farm'
          ? spotNear(g, id, (n) => w.irrigation.soilWet[n] >= SOIL_GROW_THRESHOLD)
          : spotNear(g, id)
      if (i < 0) continue
      if (place(w, defOf(id), i)) placed.push(id)
      // 建設要員が建て終わるまで進める
      run(g, TICKS_PER_DAY)
    }
    expect(placed).toEqual(order)

    // 全部完成していること
    run(g, TICKS_PER_DAY * 2)
    const unbuilt = w.buildings.filter((b) => !b.built)
    expect(unbuilt.map((b) => b.defId)).toEqual([])

    // さらに数日回して生産がつながるか見る
    w.stock.water = 0
    w.stock.log = 0
    w.stock.plank = 0
    w.stock.wheat = 0
    run(g, TICKS_PER_DAY * 8)

    expect(w.stock.water).toBeGreaterThan(0) // 揚水ポンプ
    expect(w.stock.log + w.stock.plank).toBeGreaterThan(0) // 伐採 → 製材
    expect(w.stock.wheat).toBeGreaterThan(0) // 畑（麦は日照りの備えになる副食）
    expect(w.citizens.length).toBeGreaterThanOrEqual(5) // 誰も飢えていない
  }, 60000)

})

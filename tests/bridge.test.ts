import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Citizen } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, deckHeightFor, place } from '../src/sim/structures'
import { PathFinder, wadeCost } from '../src/sim/pathfinding'
import { updateCitizens } from '../src/sim/citizens'
import { WADE_COST_MAX, WALKABLE_MAX_DEPTH } from '../src/data/constants'

/** 平らな土地。水深は試験ごとに直に与える */
function flat(w = 20, h = 9): World {
  const grid = new Grid(w, h)
  grid.natural.fill(5)
  grid.refreshAllGround()
  const world = new World(grid, 1)
  world.stock.log = 999
  world.stock.plank = 999
  return world
}

/** その列に立たせた住民に道順を渡し、渡りきるまでの tick を数える */
function crossing(world: World, route: number[]): number {
  const path = new PathFinder(world.grid)
  path.refresh(world.water)
  const store = world.createBuilding(defOf('storage'), route[route.length - 1], true)
  const c: Citizen = world.spawnCitizen(route[0])
  c.task = 'work'
  c.taskTarget = store.id
  c.path = route.slice(1)
  c.pathPos = 0
  for (let t = 0; t < 4000; t++) {
    // 途中で腹が減って引き返さないよう、需要は満たしておく
    c.needs.water = 1
    c.needs.food = 1
    c.needs.sleep = 1
    updateCitizens(world, path)
    if (!c.path) return t
  }
  return -1
}

describe('水の中の移動', () => {
  it('深いほど歩みが遅くなる', () => {
    expect(wadeCost(0)).toBe(1)
    expect(wadeCost(0.1)).toBe(1) // くるぶし程度は変わらない
    expect(wadeCost(WALKABLE_MAX_DEPTH)).toBeCloseTo(WADE_COST_MAX, 10)
    expect(wadeCost(0.5)).toBeGreaterThan(wadeCost(0.3))
    expect(wadeCost(9)).toBeCloseTo(WADE_COST_MAX, 10) // 頭打ち
  })

  it('水を渡ると陸を歩くよりずっと時間がかかる', () => {
    const route = (w: World) => {
      const { grid } = w
      const out: number[] = []
      for (let x = 2; x <= 16; x++) out.push(grid.idx(x, 4))
      return out
    }
    const dry = flat()
    const dryTicks = crossing(dry, route(dry))

    const wet = flat()
    for (let x = 6; x <= 12; x++) wet.water.depth[wet.grid.idx(x, 4)] = 0.9
    const wetTicks = crossing(wet, route(wet))

    expect(dryTicks).toBeGreaterThan(0)
    expect(wetTicks).toBeGreaterThan(dryTicks * 2)
  })

  it('浅瀬を回れるなら住民は水を避けて歩く', () => {
    const w = flat(20, 9)
    // 4 行目を横切る深い水。5 行目は浅い（回り道のほうが速い）
    for (let x = 6; x <= 12; x++) {
      w.water.depth[w.grid.idx(x, 4)] = 0.95
      w.water.depth[w.grid.idx(x, 5)] = 0.1
    }
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    const route = path.find(w.grid.idx(2, 4), w.grid.idx(16, 4))
    expect(route).not.toBeNull()
    // まっすぐ突っ切れば 14 マス。避けて通ると遠回りになる
    expect(route!.length).toBeGreaterThan(14)
    for (const i of route!) expect(w.water.depth[i]).toBeLessThan(0.9)
  })
})

describe('橋', () => {
  /** 真ん中に深い堀のある盤面 */
  function moat(): World {
    const w = flat(20, 9)
    for (let y = 0; y < w.grid.h; y++) {
      for (let x = 8; x <= 10; x++) {
        w.grid.natural[w.grid.idx(x, y)] = 2
      }
    }
    w.grid.refreshAllGround()
    for (let y = 0; y < w.grid.h; y++) {
      for (let x = 8; x <= 10; x++) w.water.depth[w.grid.idx(x, y)] = 2.5
    }
    return w
  }

  it('岸から離れた水の上には架けられない', () => {
    const w = moat()
    const middle = w.grid.idx(9, 4)
    expect(canPlace(w, defOf('bridge'), middle).ok).toBe(false)
    expect(canPlace(w, defOf('bridge'), middle).reason).toContain('継ぎ足す')
    // 岸の隣なら架かる
    expect(canPlace(w, defOf('bridge'), w.grid.idx(8, 4)).ok).toBe(true)
  })

  it('岸から継ぎ足して渡ると、桁の高さは岸のまま', () => {
    const w = moat()
    const bankTop = w.grid.walkTop(w.grid.idx(7, 4))
    for (const x of [8, 9, 10]) {
      const i = w.grid.idx(x, 4)
      expect(deckHeightFor(w, i), `x=${x}`).toBe(bankTop)
      const b = place(w, defOf('bridge'), i)
      expect(b, `x=${x}`).not.toBeNull()
      completeBuild(w, b!)
      expect(w.grid.walkTop(i)).toBe(bankTop)
    }
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    const route = path.find(w.grid.idx(5, 4), w.grid.idx(13, 4))
    expect(route).not.toBeNull()
    expect(route!.length).toBe(8) // まっすぐ渡れる
  })

  it('橋は水を止めない', () => {
    const w = moat()
    const i = w.grid.idx(8, 4)
    const before = w.water.depth[i]
    const b = place(w, defOf('bridge'), i)!
    completeBuild(w, b)
    expect(w.water.depth[i]).toBe(before)
    expect(w.grid.bed(i)).toBe(2) // 河床は変わらない
    expect(w.grid.barrier[i]).toBe(0)
  })

  it('橋が無ければ深い堀は渡れない', () => {
    const w = moat()
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    expect(path.find(w.grid.idx(5, 4), w.grid.idx(13, 4))).toBeNull()
  })

  it('桁を越えて水が来ると橋の上も歩きにくくなる', () => {
    const w = moat()
    const i = w.grid.idx(8, 4)
    const b = place(w, defOf('bridge'), i)!
    completeBuild(w, b)
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    expect(path.costAt(i)).toBe(1) // 桁の上は乾いた地面と同じ

    // 桁を 0.4 越えるまで増水させる
    w.water.depth[i] = b.deck - w.grid.bed(i) + 0.4
    path.refresh(w.water)
    expect(path.costAt(i)).toBeGreaterThan(1)
    expect(path.costAt(i)).toBeCloseTo(wadeCost(0.4), 6)
  })
})

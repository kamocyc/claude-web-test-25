import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { Logistics } from '../src/sim/logistics'
import { PathFinder } from '../src/sim/pathfinding'
import { moveLoads, updateProduction } from '../src/sim/production'
import { BOAT_MIN_DEPTH, LOAD_CAP, ROUTE_RATE } from '../src/data/constants'

/**
 * 平らな土地に、左端（x=0 付近）の蔵と右へ伸びる水路だけを置いた盤面。
 * 水路は y=4 の行で、舟が通れる深さを直に与える（水流ソルバは回さない）。
 */
function valley(opts: { canalTo: number; gapAt?: number } = { canalTo: 0 }) {
  const grid = new Grid(60, 9)
  grid.natural.fill(4)
  for (let x = 0; x <= opts.canalTo; x++) grid.natural[grid.idx(x, 4)] = 2
  grid.refreshAllGround()
  const world = new World(grid, 1)
  world.irrigation.soilWet.fill(1) // 畑が育つよう土は湿らせておく（物流だけを見る）
  for (let x = 0; x <= opts.canalTo; x++) {
    // 掘った溝を舟が通れる深さまで満たす。途中に浅い区間を作ると水路は分断される
    const shallow = opts.gapAt !== undefined && Math.abs(x - opts.gapAt) <= 1
    world.water.depth[grid.idx(x, 4)] = shallow ? BOAT_MIN_DEPTH / 2 : 1.2
  }
  const path = new PathFinder(grid)
  path.refresh(world.water)
  const logistics = new Logistics(grid.size)

  world.createBuilding(defOf('storage'), grid.idx(1, 2), true)
  const recompute = () => {
    path.refresh(world.water)
    logistics.recompute(world, path)
  }
  return { grid, world, path, logistics, recompute }
}

/** 働き手が出勤している前提で生産と搬出を回す */
function work(world: World, logistics: Logistics, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    for (const b of world.buildings) b.staffPresent = 1
    updateProduction(world)
    moveLoads(world, logistics)
  }
}

describe('荷捌き', () => {
  it('蔵から遠いほど荷が捌けなくなる', () => {
    const { grid, world, logistics, recompute } = valley()
    const near = world.createBuilding(defOf('farm'), grid.idx(6, 2), true)
    const mid = world.createBuilding(defOf('farm'), grid.idx(25, 2), true)
    const far = world.createBuilding(defOf('farm'), grid.idx(50, 2), true)
    recompute()
    expect(logistics.routeOf(near.id)).toBe('near')
    expect(logistics.routeOf(mid.id)).toBe('cart')
    expect(logistics.routeOf(far.id)).toBe('foot')
    expect(logistics.rateOf(near.id)).toBeGreaterThan(logistics.rateOf(mid.id))
    expect(logistics.rateOf(mid.id)).toBeGreaterThan(logistics.rateOf(far.id))
  })

  it('道を敷くと「村の中」の範囲が伸びる', () => {
    const { grid, world, logistics, recompute } = valley()
    const b = world.createBuilding(defOf('farm'), grid.idx(26, 2), true)
    recompute()
    expect(logistics.routeOf(b.id)).toBe('cart')

    for (let x = 1; x <= 26; x++) grid.road[grid.idx(x, 2)] = 1
    recompute()
    expect(logistics.routeOf(b.id)).toBe('near')
  })

  it('荷置き場が埋まると建物は止まる', () => {
    const { grid, world, logistics, recompute } = valley()
    const far = world.createBuilding(defOf('farm'), grid.idx(50, 2), true)
    recompute()
    work(world, logistics, 2000)
    expect(far.load).toBeGreaterThanOrEqual(LOAD_CAP)
    expect(far.status).toBe('荷が捌けない')
    // 人が背負う分だけは届いている
    expect(world.stock.wheat).toBeGreaterThan(0)
  })
})

describe('運河と舟運', () => {
  /** 右端の畑を、運河と船着場でつなぐ／つながない で比べる */
  function farField(opts: { wharves: boolean; gapAt?: number }) {
    const v = valley({ canalTo: 55, gapAt: opts.gapAt })
    const { grid, world, logistics, recompute } = v
    const field = world.createBuilding(defOf('farm'), grid.idx(50, 3), true)
    if (opts.wharves) {
      world.createBuilding(defOf('wharf'), grid.idx(1, 3), true) // 蔵のそば
      world.createBuilding(defOf('wharf'), grid.idx(52, 3), true) // 畑のそば
    }
    recompute()
    work(world, logistics, 2000)
    return { route: logistics.routeOf(field.id), field, delivered: world.stock.wheat }
  }

  it('運河と船着場でつなぐと、遠い畑の荷が一気に捌ける', () => {
    const linked = farField({ wharves: true })
    const alone = farField({ wharves: false })

    expect(alone.route).toBe('foot')
    expect(linked.route).toBe('boat')
    // 舟運なら作った端から届く（2000 tick で 66 個 ＝ 畑の生産量そのもの）。
    // 陸路だけだと人が背負える 1 日 2 個に絞られ、16 個しか届かない。
    expect(linked.delivered).toBeGreaterThan(alone.delivered * 3)
    expect(linked.field.load).toBeLessThan(LOAD_CAP) // 荷が溜まっていない
    expect(alone.field.load).toBeGreaterThanOrEqual(LOAD_CAP)
  })

  it('水路が途切れていれば舟は通らない', () => {
    const broken = farField({ wharves: true, gapAt: 30 })
    expect(broken.route).toBe('foot')
    expect(broken.field.load).toBeGreaterThanOrEqual(LOAD_CAP)
  })

  it('舟運は陸路よりずっと太い', () => {
    expect(ROUTE_RATE.boat).toBeGreaterThan(ROUTE_RATE.near)
    expect(ROUTE_RATE.near).toBeGreaterThan(ROUTE_RATE.cart)
    expect(ROUTE_RATE.cart).toBeGreaterThan(ROUTE_RATE.foot)
  })
})

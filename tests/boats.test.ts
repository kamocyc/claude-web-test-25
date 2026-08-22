import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { boatRoutes } from '../src/sim/boats'
import { Logistics } from '../src/sim/logistics'
import { PathFinder } from '../src/sim/pathfinding'
import { BOAT_MIN_DEPTH } from '../src/data/constants'

/**
 * 平らな土地に、左端の蔵と右へ伸びる水路だけを置いた盤面（logistics の試験と同じ作り）。
 * 水路は y=4 の行。gapAt を与えるとそこだけ浅くなり、舟は通れなくなる。
 */
function valley(opts: { canalTo: number; gapAt?: number }) {
  const grid = new Grid(60, 9)
  grid.natural.fill(4)
  for (let x = 0; x <= opts.canalTo; x++) grid.natural[grid.idx(x, 4)] = 2
  grid.refreshAllGround()
  const world = new World(grid, 1)
  world.irrigation.soilWet.fill(1)
  for (let x = 0; x <= opts.canalTo; x++) {
    const shallow = opts.gapAt !== undefined && Math.abs(x - opts.gapAt) <= 1
    world.water.depth[grid.idx(x, 4)] = shallow ? BOAT_MIN_DEPTH / 2 : 1.2
  }
  const path = new PathFinder(grid)
  const logistics = new Logistics(grid.size)
  world.createBuilding(defOf('storage'), grid.idx(1, 2), true)
  const recompute = () => {
    path.refresh(world.water)
    logistics.recompute(world, path)
  }
  return { grid, world, logistics, recompute }
}

describe('舟の航路', () => {
  it('蔵のそばの船着場と出先の船着場が水路で結ばれる', () => {
    const { grid, world, logistics, recompute } = valley({ canalTo: 50 })
    const hub = world.createBuilding(defOf('wharf'), grid.idx(2, 3), true)
    const far = world.createBuilding(defOf('wharf'), grid.idx(48, 3), true)
    recompute()

    const routes = boatRoutes(world, logistics)
    expect(routes.length).toBe(1)
    const r = routes[0]
    expect(r.fromId).toBe(far.id) // 荷を積むのは出先
    expect(r.toId).toBe(hub.id) // 下ろすのは蔵のそば
    // 通り道は水路の上を切れ目なく続いている
    expect(r.path.length).toBeGreaterThan(40)
    for (const i of r.path) expect(world.water.depth[i]).toBeGreaterThanOrEqual(BOAT_MIN_DEPTH)
    for (let k = 1; k < r.path.length; k++) {
      const dx = Math.abs(grid.xOf(r.path[k]) - grid.xOf(r.path[k - 1]))
      const dy = Math.abs(grid.yOf(r.path[k]) - grid.yOf(r.path[k - 1]))
      expect(dx + dy).toBe(1)
    }
    // 両端はそれぞれの船着場に横付けできる
    const touches = (tile: number, wharfI: number) => {
      let ok = false
      grid.forEachNeighbor(wharfI, (n) => {
        if (n === tile) ok = true
      })
      return ok
    }
    expect(touches(r.path[0], far.i)).toBe(true)
    expect(touches(r.path[r.path.length - 1], hub.i)).toBe(true)
  })

  it('どちらも蔵の近くなら、より近いほうが荷揚げ場になる', () => {
    // サンプルの村がこれ。運河の船着場も蔵から歩ける距離にあるが、
    // 荷を下ろすのは蔵のすぐ脇のほう。ここで舟を出さないと運河が死ぬ
    const { grid, world, logistics, recompute } = valley({ canalTo: 50 })
    const beside = world.createBuilding(defOf('wharf'), grid.idx(2, 3), true)
    const downstream = world.createBuilding(defOf('wharf'), grid.idx(10, 3), true)
    recompute()
    expect(logistics.wharves().every((w) => w.hub)).toBe(true) // どちらも蔵のそば

    const routes = boatRoutes(world, logistics)
    expect(routes.length).toBe(1)
    expect(routes[0].fromId).toBe(downstream.id)
    expect(routes[0].toId).toBe(beside.id)
  })

  it('水路が切れていれば舟は出ない', () => {
    const { grid, world, logistics, recompute } = valley({ canalTo: 50, gapAt: 25 })
    world.createBuilding(defOf('wharf'), grid.idx(2, 3), true)
    world.createBuilding(defOf('wharf'), grid.idx(48, 3), true)
    recompute()
    expect(boatRoutes(world, logistics)).toEqual([])
  })

  it('蔵のそばに船着場が無ければ舟は出ない', () => {
    const { grid, world, logistics, recompute } = valley({ canalTo: 50 })
    // 出先の船着場だけ。荷を下ろす先が無いので航路にならない
    world.createBuilding(defOf('wharf'), grid.idx(48, 3), true)
    world.createBuilding(defOf('wharf'), grid.idx(40, 3), true)
    recompute()
    expect(boatRoutes(world, logistics)).toEqual([])
  })

  it('荷が溜まっている船着場ほど積荷が多い', () => {
    const { grid, world, logistics, recompute } = valley({ canalTo: 50 })
    world.createBuilding(defOf('wharf'), grid.idx(2, 3), true)
    world.createBuilding(defOf('wharf'), grid.idx(48, 3), true)
    const farm = world.createBuilding(defOf('farm'), grid.idx(46, 2), true)
    recompute()
    expect(logistics.routeOf(farm.id)).toBe('boat')
    expect(boatRoutes(world, logistics)[0].cargo).toBe(0)

    farm.load = 18
    expect(boatRoutes(world, logistics)[0].cargo).toBe(18)
    // 船着場から遠い建物の荷は、この舟には積まれない
    const near = world.createBuilding(defOf('farm'), grid.idx(3, 2), true)
    recompute()
    near.load = 20
    expect(boatRoutes(world, logistics)[0].cargo).toBe(18)
  })

  it('浅い近道は通らず、深い水路を回っていく', () => {
    // 上下の水路が右端でつながった「コ」の字。左側は浅くて舟は渡れない
    const grid = new Grid(40, 24)
    grid.natural.fill(4)
    const deep: number[] = []
    for (let x = 2; x <= 37; x++) deep.push(grid.idx(x, 4), grid.idx(x, 20))
    for (let y = 4; y <= 20; y++) deep.push(grid.idx(37, y))
    const shallow: number[] = []
    for (let y = 5; y <= 19; y++) shallow.push(grid.idx(3, y))
    for (const i of [...deep, ...shallow]) grid.natural[i] = 2
    grid.refreshAllGround()
    const world = new World(grid, 1)
    world.irrigation.soilWet.fill(1)
    for (const i of deep) world.water.depth[i] = 1.2
    for (const i of shallow) world.water.depth[i] = BOAT_MIN_DEPTH / 2
    const path = new PathFinder(grid)
    const logistics = new Logistics(grid.size)
    world.createBuilding(defOf('storage'), grid.idx(2, 3), true)
    world.createBuilding(defOf('wharf'), grid.idx(3, 3), true) // 蔵のそば（上の水路）
    world.createBuilding(defOf('wharf'), grid.idx(3, 21), true) // 出先（下の水路）
    path.refresh(world.water)
    logistics.recompute(world, path)

    const routes = boatRoutes(world, logistics)
    expect(routes.length).toBe(1)
    // 浅瀬を突っ切れば 17 マスほど。右端まで回れば 80 マス以上になる
    expect(routes[0].path.length).toBeGreaterThan(60)
    for (const i of routes[0].path) expect(world.water.depth[i]).toBeGreaterThanOrEqual(BOAT_MIN_DEPTH)
  })

  it('水位が下がって水路が浅くなると舟は消える', () => {
    const { grid, world, logistics, recompute } = valley({ canalTo: 50 })
    world.createBuilding(defOf('wharf'), grid.idx(2, 3), true)
    world.createBuilding(defOf('wharf'), grid.idx(48, 3), true)
    recompute()
    expect(boatRoutes(world, logistics).length).toBe(1)

    for (let x = 20; x <= 24; x++) world.water.depth[grid.idx(x, 4)] = 0.2
    recompute()
    expect(boatRoutes(world, logistics)).toEqual([])
  })
})

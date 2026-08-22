import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { Logistics } from '../src/sim/logistics'
import { PathFinder } from '../src/sim/pathfinding'
import { moveLoads, updateProduction, updateVegetation } from '../src/sim/production'
import { PLANT_DIE_TICKS, TREE_GROW_TICKS } from '../src/data/constants'

/** 平らな土地。土は湿らせてあるので、乾きは試験ごとに指定する */
function woods(seed = 1): World {
  const grid = new Grid(24, 11)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const world = new World(grid, seed)
  world.irrigation.soilWet.fill(1)
  world.createBuilding(defOf('storage'), grid.idx(1, 1), true)
  return world
}

function tree(w: World, x: number, y: number, growth: number, dead = false): number {
  const i = w.grid.idx(x, y)
  w.hasTree[i] = 1
  w.treeGrowth[i] = growth
  w.treeDead[i] = dead ? 1 : 0
  return i
}

/** 樹木の成長・枯死だけを回す */
function grow(w: World, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    w.tick++
    updateVegetation(w)
  }
}

/** 働き手が出勤している前提で生産と搬出を回す */
function work(w: World, ticks: number): void {
  const path = new PathFinder(w.grid)
  path.refresh(w.water)
  const logistics = new Logistics(w.grid.size)
  logistics.recompute(w, path)
  for (let t = 0; t < ticks; t++) {
    for (const b of w.buildings) b.staffPresent = 1
    updateProduction(w)
    moveLoads(w, logistics)
  }
}

describe('枯れ木', () => {
  it('育ち切った木は枯れると立ち枯れて残り、若木は枯れて消える', () => {
    const w = woods()
    const grown = tree(w, 10, 5, 1)
    const young = tree(w, 12, 5, 0.5)
    w.irrigation.soilWet.fill(0) // 日照り
    grow(w, PLANT_DIE_TICKS * 2)
    expect(w.hasTree[grown]).toBe(1)
    expect(w.treeDead[grown]).toBe(1)
    // 若木には伐り出すものが残らない
    expect(w.hasTree[young]).toBe(0)
  })

  it('枯れ木は水が戻っても生き返らない', () => {
    const w = woods()
    const i = tree(w, 10, 5, 1, true)
    const sapling = tree(w, 12, 5, 0)
    grow(w, TREE_GROW_TICKS + 100)
    // 隣の苗は育ち切ったのに、枯れ木は枯れ木のまま
    expect(w.treeGrowth[sapling]).toBe(1)
    expect(w.treeDead[i]).toBe(1)
  })

  it('杣小屋は枯れ木を伐って丸太にし、跡地に苗を残す', () => {
    const w = woods()
    const hut = w.createBuilding(defOf('lumberjack'), w.grid.idx(4, 5), true)
    const dead = tree(w, 6, 5, 1, true)
    work(w, 300)
    // 枯れ木は丸太になり、跡地には生きた苗が残る
    expect(w.stock.log + hut.load).toBeGreaterThan(0)
    expect(w.treeDead[dead]).toBe(0)
    expect(w.hasTree[dead]).toBe(1)
    expect(w.treeGrowth[dead]).toBe(0)
  })

  it('杣小屋は生きた成木より枯れ木を先に片づける', () => {
    const w = woods()
    w.createBuilding(defOf('lumberjack'), w.grid.idx(4, 5), true)
    const near = tree(w, 5, 5, 1) // すぐ隣の成木
    const dead = tree(w, 10, 5, 1, true) // 離れた枯れ木
    // 一本目を伐り出したところで止める
    for (let t = 0; t < 400 && w.treeDead[dead] === 1 && w.treeGrowth[near] === 1; t++) work(w, 1)
    expect(w.treeDead[dead]).toBe(0) // 先に片づいた
    expect(w.treeGrowth[near]).toBe(1) // 隣の成木にはまだ手を付けていない
  })

  it('日照りのあいだ、枯れ木から丸太が湧き続けたりはしない', () => {
    // 伐った跡の苗はまた枯れるが、若木は枯れ木にならないので二度目は取れない。
    // 枯れるほうが育つより速いので、ここを閉じておかないと日照りが丸太の泉になる
    const w = woods()
    const hut = w.createBuilding(defOf('lumberjack'), w.grid.idx(4, 5), true)
    const i = tree(w, 6, 5, 1, true)
    w.irrigation.soilWet.fill(0) // 日照り
    for (let t = 0; t < 40; t++) {
      work(w, 25)
      grow(w, 25)
    }
    const first = w.stock.log + hut.load
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThanOrEqual(2) // 一度きり（杣小屋の一回ぶん）
    expect(w.hasTree[i]).toBe(0) // 跡地の苗も枯れて消えた
  })
})

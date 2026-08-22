import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, place } from '../src/sim/structures'
import { moveLoads, updateProduction } from '../src/sim/production'
import { Logistics } from '../src/sim/logistics'
import { PathFinder } from '../src/sim/pathfinding'
import { SeasonKind } from '../src/sim/season'
import {
  CROP_GROW_TICKS,
  PADDY_MAX_DEPTH,
  PADDY_MIN_DEPTH,
  TICKS_PER_DAY,
} from '../src/data/constants'

/** 平らな土地に水田ひとつだけを置いた盤面。水深は呼び出し側で決める */
function paddyWorld(depth: number) {
  const grid = new Grid(9, 9)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const world = new World(grid, 1)
  const i = grid.idx(4, 4)
  world.createBuilding(defOf('storage'), grid.idx(0, 0), true) // 在庫の置き場
  const b = world.createBuilding(defOf('paddy'), i, true)
  world.water.depth[i] = depth
  return { world, b, i }
}

/**
 * 働き手が出勤している前提で生産だけを n tick 進める。
 * 出来高は荷置き場に積まれるので、蔵への搬出（moveLoads）も回す。
 */
function work(world: World, ticks: number, depth?: number): void {
  const path = new PathFinder(world.grid)
  path.refresh(world.water)
  const logistics = new Logistics(world.grid.size)
  for (let t = 0; t < ticks; t++) {
    for (const b of world.buildings) b.staffPresent = 1
    if (depth !== undefined) {
      for (const b of world.buildings) {
        if (b.defId === 'paddy') world.water.depth[b.i] = depth
      }
    }
    if (t % 30 === 0) {
      path.refresh(world.water)
      logistics.recompute(world, path)
    }
    updateProduction(world)
    moveLoads(world, logistics)
  }
}

describe('水田', () => {
  it('水を張っていれば稲が実る', () => {
    const { world, b } = paddyWorld(0.4)
    work(world, CROP_GROW_TICKS + 5)
    expect(b.status).toBe('稼働中')
    expect(world.stock.rice).toBeGreaterThan(0)
  })

  it('水が涸れると育たず、育ちかけの稲は枯れていく', () => {
    const { world, b, i } = paddyWorld(0.4)
    work(world, 40) // 実り切る前（1 期は 90 tick）
    const grown = b.progress
    expect(grown).toBeGreaterThan(0)

    world.water.depth[i] = PADDY_MIN_DEPTH / 2
    work(world, 60, PADDY_MIN_DEPTH / 2)
    expect(b.status).toBe('田の水が涸れた')
    expect(b.progress).toBeLessThan(grown)
    expect(world.stock.rice).toBe(0)
  })

  it('深く浸かると育たないが、枯れもしない（引けば続きから育つ）', () => {
    const { world, b } = paddyWorld(0.4)
    work(world, 40)
    const grown = b.progress
    expect(grown).toBeGreaterThan(0)

    work(world, 100, PADDY_MAX_DEPTH + 0.5)
    expect(b.status).toBe('水に浸かっている')
    expect(b.progress).toBe(grown) // 冠水しても稲は失われない

    work(world, CROP_GROW_TICKS, 0.4)
    expect(world.stock.rice).toBeGreaterThan(0)
  })

  it('土が湿っているだけでは実らない（湛水が要る）', () => {
    const { world, b, i } = paddyWorld(0)
    world.irrigation.soilWet.fill(1) // 用水櫓で潤っている状態
    world.water.depth[i] = 0
    work(world, CROP_GROW_TICKS + 5, 0)
    expect(b.status).toBe('田の水が涸れた')
    expect(world.stock.rice).toBe(0)
  })

  it('籾は精米所で米になる（村の主食）', () => {
    const { world } = paddyWorld(0.4)
    world.createBuilding(defOf('mill'), world.grid.idx(6, 4), true)
    world.stock.water = 50 // 精米には水が要る
    work(world, 600, 0.4)
    expect(world.stock.rice).toBeGreaterThan(0)
    expect(world.stock.meal).toBeGreaterThan(0)
  })

  it('生育は季節に依らない（効くのは水位だけ）', () => {
    // updateProduction は world.season を参照できる位置にいる。季節で生育に
    // 下駄を履かせる実装に変わったら、この試験が落ちる。
    const kinds: SeasonKind[] = ['normal', 'rain', 'drought']
    const yields = kinds.map((kind) => {
      const { world } = paddyWorld(0.4)
      world.season.kind = kind
      world.season.prevKind = kind
      work(world, 400, 0.4)
      return world.stock.rice
    })
    expect(yields[0]).toBeGreaterThan(0)
    expect(yields[1]).toBe(yields[0])
    expect(yields[2]).toBe(yields[0])
  })
})

/**
 * 用水路を掘って田に水を引く。掘った場合と掘らない場合を突き合わせる。
 * 「灌漑（用水路）で稲を作れる土地が広がる」ことを盤面ごと確かめる試験。
 */
function canalScenario(dig: boolean): {
  site: number
  depth: number
  canPlace: boolean
  status: string
  rice: number
} {
  const g = new Game({ w: 50, h: 50, seed: 21 })
  const w = g.world
  w.stock.log = 999
  w.stock.soil = 999
  for (let t = 0; t < TICKS_PER_DAY; t++) g.step() // 川を落ち着かせる

  const { grid, water } = w
  // 川岸（水深 0.5 以上）から東へ 5 マス離れた、乾いた氾濫原を田の予定地にする
  const y = Math.floor(grid.h / 2)
  let bank = -1
  for (let x = grid.w - 1; x >= 0; x--) {
    if (water.depth[grid.idx(x, y)] >= 0.5) {
      bank = x
      break
    }
  }
  const LEN = 5
  const site = grid.idx(bank + LEN, y)

  if (dig) {
    // 川から予定地まで 2 段掘り下げて水路を通す
    for (let x = bank + 1; x <= bank + LEN; x++) {
      const i = grid.idx(x, y)
      for (let n = 0; n < 2; n++) {
        const b = place(w, defOf('dig'), i)
        if (b) completeBuild(w, b)
      }
    }
  }
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()

  const canPlaceHere = canPlace(w, defOf('paddy'), site).ok
  const paddy = canPlaceHere ? place(w, defOf('paddy'), site) : null
  if (paddy) completeBuild(w, paddy)
  // 住民の通勤事情に左右されないよう、働き手は出勤している前提で生産だけ回す
  for (let t = 0; t < 400; t++) {
    for (const b of w.buildings) b.staffPresent = 1
    if (t % 30 === 0) g.logistics.recompute(w, g.path)
    updateProduction(w)
    moveLoads(w, g.logistics)
  }
  return {
    site,
    depth: water.depth[site],
    canPlace: canPlaceHere,
    status: paddy?.status ?? '（置けない）',
    rice: w.stock.rice,
  }
}

describe('用水路で稲を作れる土地が広がる', () => {
  it('掘って水を引けば田になり、掘らなければ乾いたまま', () => {
    const dug = canalScenario(true)
    const dry = canalScenario(false)
    expect(dug.site).toBe(dry.site) // 同じ場所で比べている

    // 掘らなければ水は来ず、稲は実らない
    expect(dry.depth).toBeLessThan(PADDY_MIN_DEPTH)
    expect(dry.rice).toBe(0)

    // 水路を通せば湛水し、稲が実る
    expect(dug.depth).toBeGreaterThanOrEqual(PADDY_MIN_DEPTH)
    expect(dug.depth).toBeLessThanOrEqual(PADDY_MAX_DEPTH)
    expect(dug.status).toBe('稼働中')
    expect(dug.rice).toBeGreaterThan(0)
  }, 60000)
})

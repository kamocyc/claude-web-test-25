import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Building } from '../src/core/world'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, place } from '../src/sim/structures'
import { floodDamage, isSwamped } from '../src/sim/flood'
import { Logistics } from '../src/sim/logistics'
import { PathFinder } from '../src/sim/pathfinding'
import { idleByWater, moveLoads, updateProduction, updateVegetation } from '../src/sim/production'
import { assignJobs } from '../src/sim/citizens'
import {
  FLOOD_CROP_DEPTH,
  FLOOD_DAMAGE_DEPTH,
  FLOOD_STOP_DEPTH,
  FLOOD_TREE_DEPTH,
  PADDY_MAX_DEPTH,
  PLANT_DIE_TICKS,
  SOIL_GROW_THRESHOLD,
  TICKS_PER_DAY,
} from '../src/data/constants'

/** 平らな土地。水深は試験ごとに直に与える */
function town(seed = 1): World {
  const grid = new Grid(24, 11)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const world = new World(grid, seed)
  world.irrigation.soilWet.fill(1) // 乾きでは止まらないようにしておく
  world.createBuilding(defOf('storage'), grid.idx(1, 1), true)
  return world
}

const put = (w: World, id: string, x: number, y: number): Building =>
  w.createBuilding(defOf(id), w.grid.idx(x, y), true)

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

/** 日替わりの災いを days 回まわす */
function days(w: World, n: number): void {
  for (let d = 0; d < n; d++) floodDamage(w)
}

describe('浸水', () => {
  it('冠水した畑は作物が流され、水田は流されない', () => {
    const w = town()
    const field = put(w, 'farm', 10, 5)
    const paddy = put(w, 'paddy', 12, 5)
    w.water.depth[paddy.i] = 0.4
    work(w, 40)
    const grown = field.progress
    expect(grown).toBeGreaterThan(0)
    expect(paddy.progress).toBeGreaterThan(0)

    // 水が上がってくる
    w.water.depth[field.i] = FLOOD_CROP_DEPTH + 0.05
    w.water.depth[paddy.i] = 0.5
    work(w, 10)
    expect(field.status).toBe('水に浸かった')
    expect(field.progress).toBe(0) // 育ちかけの麦ごと流された
    expect(paddy.progress).toBeGreaterThan(grown) // 稲は水の中で育ち続ける
  })

  it('床上まで水が来た建物は止まり、引けばそのまま戻る', () => {
    const w = town()
    const mill = put(w, 'mill', 10, 5)
    w.stock.rice = 200
    w.stock.water = 200
    work(w, 200)
    const made = w.stock.meal
    expect(made).toBeGreaterThan(0)

    w.water.depth[mill.i] = FLOOD_STOP_DEPTH + 0.05
    expect(isSwamped(w, mill)).toBe(true)
    work(w, 200)
    expect(mill.status).toBe('床上まで水が来ている')
    expect(w.stock.meal).toBe(made) // 止まっている

    w.water.depth[mill.i] = 0
    work(w, 200)
    expect(w.stock.meal).toBeGreaterThan(made) // 水が引けば元通り
  })

  it('水に足を突っ込んで建てるものは浸水しても平気', () => {
    const w = town()
    for (const id of ['pump', 'wharf', 'dump', 'paddy']) {
      const b = put(w, id, 10, 5)
      w.water.depth[b.i] = 1.5
      expect(isSwamped(w, b), `${defOf(id).name}`).toBe(false)
      w.removeBuilding(b)
    }
  })

  it('浸かった蔵は蓄えが傷み、土蔵は無事', () => {
    const spoiled = (id: string): number => {
      const w = town()
      const store = w.buildings[0]
      w.removeBuilding(store) // 既定の蔵を外し、試したいものだけにする
      const b = put(w, id, 10, 5)
      w.stock.meal = 100
      w.water.depth[b.i] = FLOOD_STOP_DEPTH + 0.1
      days(w, 3)
      return 100 - w.stock.meal
    }
    expect(spoiled('storage')).toBeGreaterThan(10)
    expect(spoiled('dozo')).toBe(0)
  })

  it('深く浸かった建物は一定の確率で傷み、全部が一斉には壊れない', () => {
    const w = town(3)
    const houses: Building[] = []
    for (let x = 4; x < 20; x++) houses.push(put(w, 'house', x, 5))
    for (const b of houses) w.water.depth[b.i] = FLOOD_DAMAGE_DEPTH + 0.3
    days(w, 3)
    const broken = houses.filter((b) => b.damaged).length
    expect(broken).toBeGreaterThan(0)
    expect(broken).toBeLessThan(houses.length)
    // 浅い浸水では傷まない
    const w2 = town(3)
    const dry = put(w2, 'house', 10, 5)
    w2.water.depth[dry.i] = FLOOD_DAMAGE_DEPTH - 0.1
    days(w2, 20)
    expect(dry.damaged).toBe(false)
  })

  it('土蔵と庄屋は傷まない', () => {
    const w = town(5)
    const dozo = put(w, 'dozo', 8, 5)
    const seat = w.createBuilding(defOf('district'), w.grid.idx(12, 5), true)
    w.water.depth[dozo.i] = 1.5
    w.water.depth[seat.i] = 1.5
    days(w, 30)
    expect(dozo.damaged).toBe(false)
    expect(seat.damaged).toBe(false)
  })

  it('水に浸かり続けた木は枯れる', () => {
    const w = town()
    const i = w.grid.idx(10, 5)
    w.hasTree[i] = 1
    w.treeGrowth[i] = 1
    w.water.depth[i] = FLOOD_TREE_DEPTH + 0.1
    for (let t = 0; t < PLANT_DIE_TICKS * 2; t++) {
      w.tick++
      updateVegetation(w)
    }
    expect(w.treeDead[i]).toBe(1) // 立ち枯れて残る

    // 浸かっていなければ枯れない
    const w2 = town()
    const j = w2.grid.idx(10, 5)
    w2.hasTree[j] = 1
    w2.treeGrowth[j] = 1
    for (let t = 0; t < PLANT_DIE_TICKS * 2; t++) {
      w2.tick++
      updateVegetation(w2)
    }
    expect(w2.hasTree[j]).toBe(1)
    expect(w2.treeDead[j]).toBe(0)
  })

  it('膝までの浸水では木は枯れない', () => {
    const alive = (depth: number): boolean => {
      const w = town()
      const i = w.grid.idx(10, 5)
      w.hasTree[i] = 1
      w.treeGrowth[i] = 1
      w.water.depth[i] = depth
      for (let t = 0; t < PLANT_DIE_TICKS * 3; t++) {
        w.tick++
        updateVegetation(w)
      }
      return w.hasTree[i] === 1 && w.treeDead[i] === 0
    }
    // 人が歩ける深さ（〜1.0）では根まで沈まない。大雨のたびに山が丸裸にならない
    expect(alive(0.5)).toBe(true)
    expect(alive(1.0)).toBe(true)
    expect(alive(FLOOD_TREE_DEPTH - 0.1)).toBe(true)
    expect(alive(FLOOD_TREE_DEPTH + 0.1)).toBe(false)
  })

  it('水に沈んだ田や畑からは働き手が離れる', () => {
    const w = town()
    const paddy = put(w, 'paddy', 10, 5)
    const field = put(w, 'farm', 12, 5)
    w.water.depth[paddy.i] = 0.4
    for (let i = 0; i < 3; i++) w.spawnCitizen(w.grid.idx(2, 5))
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    for (let t = 0; t < 40; t++) {
      w.tick++
      assignJobs(w)
    }
    expect(paddy.workers.length).toBe(1)
    expect(field.workers.length).toBe(1)
    expect(idleByWater(w, paddy)).toBe(false)

    // 大水が出れば田は深すぎ、畑は水を被る
    w.water.depth[paddy.i] = PADDY_MAX_DEPTH + 0.5
    w.water.depth[field.i] = FLOOD_CROP_DEPTH + 0.1
    expect(idleByWater(w, paddy)).toBe(true)
    expect(idleByWater(w, field)).toBe(true)
    for (let t = 0; t < 40; t++) {
      w.tick++
      assignJobs(w)
    }
    expect(paddy.workers).toEqual([])
    expect(field.workers).toEqual([])
    expect(w.citizens.filter((c) => c.jobId >= 0)).toEqual([])
  })

  it('水に浸かった道は流される', () => {
    const w = town(7)
    for (let x = 4; x < 20; x++) {
      w.grid.road[w.grid.idx(x, 5)] = 1
      w.water.depth[w.grid.idx(x, 5)] = FLOOD_TREE_DEPTH + 0.1
      w.grid.road[w.grid.idx(x, 8)] = 1 // 乾いた道
    }
    days(w, 5)
    let wet = 0
    let dry = 0
    for (let x = 4; x < 20; x++) {
      if (w.grid.road[w.grid.idx(x, 5)]) wet++
      if (w.grid.road[w.grid.idx(x, 8)]) dry++
    }
    expect(wet).toBeLessThan(4) // ほとんど流された
    expect(dry).toBe(16) // 乾いた道は無事
  })
})

describe('浸水と村', () => {
  it('傷んだ建物は住民が直しに来る', () => {
    const g = new Game({ w: 40, h: 40, seed: 21 })
    const w = g.world
    w.stock.log = 999
    w.stock.plank = 999
    for (let t = 0; t < TICKS_PER_DAY; t++) g.step()

    // 庄屋の近くに民家を建て、水没させて傷ませる
    const { grid, startI } = w
    let spot = -1
    let bestD = Infinity
    for (let i = 0; i < grid.size; i++) {
      if (!canPlace(w, defOf('house'), i).ok || !g.path.find(startI, i)) continue
      const d = Math.abs(grid.xOf(i) - grid.xOf(startI)) + Math.abs(grid.yOf(i) - grid.yOf(startI))
      if (d >= bestD || d < 2) continue
      bestD = d
      spot = i
    }
    const home = place(w, defOf('house'), spot)!
    completeBuild(w, home)

    w.water.depth[home.i] = 1.5
    for (let n = 0; n < 40 && !home.damaged; n++) floodDamage(w)
    expect(home.damaged).toBe(true)
    expect(home.built).toBe(false)

    // 水が引けば住民が直す
    w.water.depth[home.i] = 0
    for (let t = 0; t < TICKS_PER_DAY * 3; t++) g.step()
    expect(home.built).toBe(true)
    expect(home.damaged).toBe(false)
  }, 60000)

  it('土手で囲えば大雨でも村は浸からない', () => {
    /** 村の予定地を土手で囲う／囲わないで、大雨のあとの水深を比べる */
    const run = (walled: boolean): { depth: number; arable: number } => {
      const g = new Game({ w: 48, h: 48, seed: 21 })
      const w = g.world
      w.stock.log = 9999
      for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()

      // 氾濫原の一角（川岸から 6 マス）を村の予定地にする
      const { grid } = w
      const row = grid.yOf(w.startI)
      let bank = -1
      for (let x = grid.w - 1; x >= 0; x--) {
        if (w.water.depth[grid.idx(x, row)] > 0.3) {
          bank = x
          break
        }
      }
      const cx = bank + 6
      const inside: number[] = []
      for (let y = row - 1; y <= row + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) inside.push(grid.idx(x, y))
      }
      if (walled) {
        // 予定地をぐるりと土手で囲む（2 段積んで越えられないようにする）
        for (let y = row - 2; y <= row + 2; y++) {
          for (let x = cx - 2; x <= cx + 2; x++) {
            if (Math.abs(y - row) !== 2 && Math.abs(x - cx) !== 2) continue
            const i = grid.idx(x, y)
            for (let n = 0; n < 2; n++) {
              const b = place(w, defOf('levee'), i)
              if (b) completeBuild(w, b)
            }
          }
        }
      }

      const s = w.season
      s.kind = 'rain'
      s.prevKind = 'rain'
      s.elapsed = 0
      s.lengthDays = 99
      for (let t = 0; t < TICKS_PER_DAY * 8; t++) g.step()

      let depth = 0
      let arable = 0
      for (const i of inside) {
        depth = Math.max(depth, w.water.depth[i])
        if (w.water.depth[i] < FLOOD_CROP_DEPTH && w.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD) {
          arable++
        }
      }
      return { depth, arable }
    }

    const open = run(false)
    const walled = run(true)
    // 囲わなければ氾濫原は水を被り、畑は作れない
    expect(open.depth).toBeGreaterThan(FLOOD_CROP_DEPTH)
    expect(open.arable).toBe(0)
    // 土手で囲えば水は入ってこない
    expect(walled.depth).toBeLessThan(FLOOD_CROP_DEPTH)
    expect(walled.arable).toBe(9)
  }, 120000)
})

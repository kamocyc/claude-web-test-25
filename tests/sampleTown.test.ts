import { describe, expect, it } from 'vitest'
import { createSampleGame } from '../src/data/sampleTown'
import { defOf } from '../src/data/buildings'
import {
  BOAT_MIN_DEPTH,
  FLOOD_CROP_DEPTH,
  SOIL_GROW_THRESHOLD,
  PADDY_MAX_DEPTH,
  PADDY_MIN_DEPTH,
  TICKS_PER_DAY,
} from '../src/data/constants'
import { Game } from '../src/core/game'

/**
 * サンプルの村は地形に合わせて掘って建てるので、盤面の大きさで出来上がりが変わる。
 * 実際に配られるのと同じ 80x80 で試す（main.ts は生成した盤面と同じ寸法を渡す）。
 */
const SIZE = 80

function countOf(g: Game, defId: string): number {
  return g.world.buildings.filter((b) => b.defId === defId).length
}

describe('サンプルの村', () => {
  it('主要な建物が揃っていて、全部完成している', () => {
    const g = createSampleGame(SIZE, SIZE)
    expect(g.world.buildings.filter((b) => !b.built)).toEqual([])
    const wanted = [
      'pump', 'house', 'storage', 'dozo', 'lumberjack', 'sawmill', 'mill',
      'paddy', 'farm', 'irrigation', 'dam', 'floodgate',
      'wharf', 'firetower', 'firehouse', 'barrel',
    ]
    for (const id of wanted) {
      expect(countOf(g, id), `${defOf(id).name} が無い`).toBeGreaterThan(0)
    }
    expect(countOf(g, 'wharf')).toBeGreaterThanOrEqual(2) // 蔵のそばと運河の先
    expect(countOf(g, 'levee')).toBeGreaterThan(20) // 村を囲う堤防
    expect(countOf(g, 'bridge')).toBeGreaterThan(0) // 運河を渡る橋
    expect(g.world.citizens.length).toBeGreaterThanOrEqual(16)

    let roads = 0
    for (let i = 0; i < g.world.grid.size; i++) if (g.world.grid.road[i]) roads++
    expect(roads).toBeGreaterThan(10)
  }, 60000)

  it('職場に働き手が付いて町が回っている', () => {
    const g = createSampleGame(SIZE, SIZE)
    const w = g.world
    const staffed = w.buildings.filter((b) => defOf(b.defId).workers > 0 && b.workers.length > 0)
    expect(staffed.length).toBeGreaterThanOrEqual(5)

    // さらに数日回しても人が減らず、水と食料が尽きない
    const pop = w.citizens.length
    w.stock.water = 0
    w.stock.meal = 0
    w.stock.wheat = 0
    for (let t = 0; t < TICKS_PER_DAY * 4; t++) g.step()
    expect(w.citizens.length).toBeGreaterThanOrEqual(pop)
    expect(w.stock.water).toBeGreaterThan(0)
    expect(w.stock.wheat + w.stock.meal).toBeGreaterThan(0)
  }, 60000)

  it('畑は段丘にも置いてあり、大雨でも段丘のぶんは水を被らない', () => {
    const g = createSampleGame(SIZE, SIZE)
    const w = g.world
    const high = w.grid.ground[w.startI]
    const farms = w.buildings.filter((b) => b.defId === 'farm')
    const paddies = w.buildings.filter((b) => b.defId === 'paddy')
    expect(farms.length).toBeGreaterThanOrEqual(4)
    // 稲は湛水がいるので川端の低いところ
    for (const b of paddies) expect(w.grid.ground[b.i]).toBeLessThanOrEqual(high)

    const s = w.season
    s.kind = 'rain'
    s.prevKind = 'rain'
    s.elapsed = 0
    s.lengthDays = 99
    for (let t = 0; t < TICKS_PER_DAY * 10; t++) g.step()
    // 村のそばの畑は水を被るが、段丘の畑は残る
    const dry = farms.filter((b) => w.water.depth[b.i] < FLOOD_CROP_DEPTH)
    expect(dry.length).toBeGreaterThanOrEqual(2)
    for (const b of dry) expect(w.grid.ground[b.i]).toBeGreaterThan(high)
    expect(farms.filter((b) => w.water.depth[b.i] >= FLOOD_CROP_DEPTH).length).toBeGreaterThan(0)

    // 段丘の畑は麦を抱えたまま残る。ただし村から通う道が水に浸かるので、
    // 大雨のあいだ実際に穫れるかは通えるかどうか次第（そこはプレイヤーの仕事）
    for (const b of dry) expect(w.irrigation.soilWet[b.i]).toBeGreaterThan(SOIL_GROW_THRESHOLD)
  }, 120000)

  it('読み込んだ村には大雨が来て、その次に日照りが来る', () => {
    const g = createSampleGame(SIZE, SIZE)
    const s = g.world.season
    expect(s.kind).toBe('normal')
    expect(s.nextKind).toBe('rain') // まず大雨
    expect(s.daysLeft).toBeLessThanOrEqual(3) // 見て回る猶予だけ置いてある

    const seen: string[] = []
    for (let t = 0; t < TICKS_PER_DAY * 60; t++) {
      g.step()
      const k = g.world.season.kind
      if (seen[seen.length - 1] !== k) seen.push(k)
      if (seen.length >= 3) break
    }
    expect(seen.slice(0, 3)).toEqual(['normal', 'rain', 'drought'])
  }, 120000)

  it('用水路の水が田に来ていて、稲が育っている', () => {
    const g = createSampleGame(SIZE, SIZE)
    const w = g.world
    const paddies = w.buildings.filter((b) => b.defId === 'paddy')
    expect(paddies.length).toBeGreaterThanOrEqual(3)
    for (const b of paddies) {
      expect(w.water.depth[b.i]).toBeGreaterThanOrEqual(PADDY_MIN_DEPTH)
      expect(w.water.depth[b.i]).toBeLessThanOrEqual(PADDY_MAX_DEPTH)
    }
    // 何日か回せば籾が穫れる
    w.stock.rice = 0
    for (let t = 0; t < TICKS_PER_DAY * 4; t++) g.step()
    expect(w.stock.rice + w.stock.meal).toBeGreaterThan(0)
  }, 60000)

  it('掘った運河が川とつながっていて、二つの船着場を舟が行き来できる', () => {
    const g = createSampleGame(SIZE, SIZE)
    const w = g.world
    const wharves = w.buildings.filter((b) => b.defId === 'wharf')
    expect(wharves.length).toBeGreaterThanOrEqual(2)

    // 舟が通れる水域（水深 BOAT_MIN_DEPTH 以上）を、片方の船着場から塗る
    const seen = new Uint8Array(w.grid.size)
    const queue: number[] = []
    const push = (i: number) => {
      if (seen[i] || w.water.depth[i] < BOAT_MIN_DEPTH) return
      seen[i] = 1
      queue.push(i)
    }
    w.grid.forEachNeighbor(wharves[0].i, push)
    for (let qi = 0; qi < queue.length; qi++) w.grid.forEachNeighbor(queue[qi], push)

    // もう一方の船着場にも同じ水域が届いている ＝ 運河が川につながっている
    let linked = false
    w.grid.forEachNeighbor(wharves[1].i, (n) => {
      if (seen[n]) linked = true
    })
    expect(linked).toBe(true)

    // 舟で荷を捌いている建物がある
    expect(w.buildings.filter((b) => g.logistics.routeOf(b.id) === 'boat').length).toBeGreaterThan(0)
  }, 60000)

  it('堰の上流に貯水池ができている', () => {
    const g = createSampleGame(SIZE, SIZE)
    const w = g.world
    const weir = w.buildings.find((b) => b.defId === 'dam')!
    const row = w.grid.yOf(weir.i)
    let up = 0
    for (let y = 0; y < row; y++) {
      for (let x = 0; x < w.grid.w; x++) up += w.water.depth[w.grid.idx(x, y)]
    }
    expect(up).toBeGreaterThan(50)
    // 堰の直上流の流路はしっかり水を湛えている（両端は岸なので最大値で見る）
    let deepest = 0
    for (let x = 0; x < w.grid.w; x++) {
      deepest = Math.max(deepest, w.water.depth[w.grid.idx(x, row - 1)])
    }
    expect(deepest).toBeGreaterThan(0.5)
  }, 60000)

  it('同じシードなので毎回同じ町になる', () => {
    const a = createSampleGame(SIZE, SIZE)
    const b = createSampleGame(SIZE, SIZE)
    expect(b.world.buildings.map((x) => `${x.defId}@${x.i}`)).toEqual(
      a.world.buildings.map((x) => `${x.defId}@${x.i}`),
    )
    expect(b.world.stock).toEqual(a.world.stock)
  }, 60000)
})

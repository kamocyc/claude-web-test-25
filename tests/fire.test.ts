import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Building } from '../src/core/world'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, place } from '../src/sim/structures'
import { extinguishPower, fightFire, igniteDaily, updateFire } from '../src/sim/fire'
import { SeasonKind } from '../src/sim/season'
import {
  EXTINGUISH_DRY_FACTOR,
  FIRE_BURN_TICKS,
  FIRE_WATER_DEPTH,
  TICKS_PER_DAY,
} from '../src/data/constants'

/** 平らな土地の小さな町。seed を変えると出火・延焼の目が変わる */
function town(seed = 1): World {
  const grid = new Grid(24, 11)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const world = new World(grid, seed)
  world.createBuilding(defOf('storage'), grid.idx(1, 1), true)
  return world
}

const house = (w: World, x: number, y: number): Building =>
  w.createBuilding(defOf('house'), w.grid.idx(x, y), true)

/** 火事だけを n tick 進める */
function burn(w: World, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    w.tick++
    updateFire(w)
  }
}

describe('火事', () => {
  it('放っておくと建物は焼け落ちる', () => {
    const w = town()
    const h = house(w, 10, 5)
    h.fire = 0.2
    burn(w, 400 + FIRE_BURN_TICKS)
    expect(w.buildings.some((b) => b.id === h.id)).toBe(false)
    expect(w.log.some((l) => l.includes('焼け落ちた'))).toBe(true)
  })

  it('隣の家へ燃え移る', () => {
    let spread = 0
    for (let seed = 1; seed <= 20; seed++) {
      const w = town(seed)
      const a = house(w, 10, 5)
      const b = house(w, 11, 5)
      a.fire = 0.6
      burn(w, 300)
      if (b.fire > 0 || !w.buildings.includes(b)) spread++
    }
    expect(spread).toBeGreaterThan(10) // 20 回中の過半で燃え移る
  })

  it('間に水路があると延焼が止まる', () => {
    const count = (canal: boolean): number => {
      let spread = 0
      for (let seed = 1; seed <= 20; seed++) {
        const w = town(seed)
        const a = house(w, 10, 5)
        const b = house(w, 12, 5)
        if (canal) {
          for (let y = 0; y < w.grid.h; y++) w.water.depth[w.grid.idx(11, y)] = FIRE_WATER_DEPTH + 0.2
        }
        a.fire = 0.6
        burn(w, 300)
        if (b.fire > 0 || !w.buildings.includes(b)) spread++
      }
      return spread
    }
    const open = count(false)
    const cut = count(true)
    expect(open).toBeGreaterThan(10)
    expect(cut).toBeLessThan(open / 3)
  })

  it('土蔵には燃え移らない', () => {
    const w = town()
    const a = house(w, 10, 5)
    const dozo = w.createBuilding(defOf('dozo'), w.grid.idx(11, 5), true)
    a.fire = 0.9
    burn(w, 600)
    expect(dozo.fire).toBe(0)
    expect(w.buildings.includes(dozo)).toBe(true)
  })

  it('大雨は火を消していく', () => {
    const w = town()
    const h = house(w, 10, 5)
    h.fire = 0.6
    w.season.kind = 'rain'
    w.season.prevKind = 'rain'
    burn(w, 200)
    expect(h.fire).toBe(0)
    expect(w.buildings.includes(h)).toBe(true)
  })

  it('日照りは平年より火が出やすく、大雨はほとんど出ない', () => {
    const ignitions = (kind: SeasonKind): number => {
      const w = town(7)
      w.season.kind = kind
      w.season.prevKind = kind
      for (let x = 4; x < 20; x += 2) house(w, x, 5)
      let n = 0
      for (let d = 0; d < 400; d++) {
        for (const b of w.buildings) b.fire = 0 // 数えたら消して次の日へ
        igniteDaily(w)
        n += w.buildings.filter((b) => b.fire > 0).length
      }
      return n
    }
    const dry = ignitions('drought')
    const normal = ignitions('normal')
    const rain = ignitions('rain')
    expect(dry).toBeGreaterThan(normal * 2)
    expect(rain).toBeLessThan(normal / 2)
  })
})

describe('消防', () => {
  it('防火用水が近くにあると消火が速い', () => {
    const w = town()
    const h = house(w, 10, 5)
    const dryPower = extinguishPower(w, h.i)
    w.water.depth[w.grid.idx(13, 5)] = FIRE_WATER_DEPTH + 0.1 // 火元から 3 マスの水路
    const wetPower = extinguishPower(w, h.i)
    expect(dryPower).toBeCloseTo(wetPower * EXTINGUISH_DRY_FACTOR, 10)
    expect(wetPower).toBeGreaterThan(dryPower)
  })

  it('天水桶も防火用水になる', () => {
    const w = town()
    const h = house(w, 10, 5)
    const before = extinguishPower(w, h.i)
    w.createBuilding(defOf('barrel'), w.grid.idx(12, 5), true)
    expect(extinguishPower(w, h.i)).toBeGreaterThan(before)
  })

  it('火消しが駆けつければ消し止められ、水が無ければ間に合わない', () => {
    /** 火消し 3 人で消しにかかり、消し止まるまでの tick 数（-1 = 焼失） */
    const fight = (water: boolean): number => {
      const w = town()
      const h = house(w, 10, 5)
      if (water) w.water.depth[w.grid.idx(13, 5)] = FIRE_WATER_DEPTH + 0.1
      h.fire = 0.5
      h.detected = true
      for (let t = 0; t < 2000; t++) {
        w.tick++
        for (let n = 0; n < 3; n++) if (h.fire > 0) fightFire(w, h)
        updateFire(w)
        if (!w.buildings.includes(h)) return -1
        if (h.fire <= 0) return t
      }
      return -1
    }
    const withWater = fight(true)
    const without = fight(false)
    expect(withWater).toBeGreaterThan(0)
    expect(without).toBeGreaterThan(withWater * 3) // 桶で運ぶぶん手間取る
  })

  it('火の見櫓の範囲内なら火事はすぐ知れる', () => {
    const w = town()
    const tower = w.createBuilding(defOf('firetower'), w.grid.idx(10, 5), true)
    tower.staffPresent = 1
    const near = house(w, 14, 5) // 櫓から 4 マス（範囲 14 の内側）
    near.fire = 0.2
    w.tick++
    updateFire(w)
    expect(near.detected).toBe(true)

    // 番人がいなければ見張れない
    const w2 = town()
    const t2 = w2.createBuilding(defOf('firetower'), w2.grid.idx(10, 5), true)
    t2.staffPresent = 0
    const h2 = house(w2, 14, 5)
    h2.fire = 0.2
    w2.tick++
    updateFire(w2)
    expect(h2.detected).toBe(false)
  })

  it('火の見櫓が無ければ発見が遅れる', () => {
    const w = town()
    const h = house(w, 10, 5)
    h.fire = 0.2
    burn(w, 30)
    expect(h.detected).toBe(false)
    burn(w, TICKS_PER_DAY)
    expect(h.detected).toBe(true) // いずれは誰かが気づく
  })
})

/** 入植地の近くで条件に合う空き地を探して即完成させる */
function build(g: Game, id: string): Building {
  const { grid, startI } = g.world
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < grid.size; i++) {
    if (!canPlace(g.world, defOf(id), i).ok) continue
    const d = Math.abs(grid.xOf(i) - grid.xOf(startI)) + Math.abs(grid.yOf(i) - grid.yOf(startI))
    if (d >= bestD || d < 2) continue
    if (!g.path.find(startI, i)) continue
    bestD = d
    best = i
  }
  const b = place(g.world, defOf(id), best)
  if (!b) throw new Error(`置けない: ${id}`)
  completeBuild(g.world, b)
  return b
}

describe('町ぐるみの火事', () => {
  /** 火消し詰所と火の見櫓を建てる／建てないで、民家が助かるか比べる */
  function villageFire(guarded: boolean): { survived: boolean; fire: number } {
    const g = new Game({ w: 40, h: 40, seed: 21 })
    const w = g.world
    w.stock.log = 999
    w.stock.soil = 999
    w.stock.plank = 999
    for (let t = 0; t < TICKS_PER_DAY; t++) g.step()
    if (guarded) {
      build(g, 'firetower')
      build(g, 'firehouse')
    }
    const home = build(g, 'house')
    // 火消しが配属されるまで回す
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()

    home.fire = 0.3
    for (let t = 0; t < TICKS_PER_DAY * 3; t++) g.step()
    return { survived: w.buildings.includes(home), fire: home.fire }
  }

  it('火消しがいれば家は焼けずに済み、いなければ焼け落ちる', () => {
    const guarded = villageFire(true)
    const alone = villageFire(false)
    expect(guarded.survived).toBe(true)
    expect(guarded.fire).toBe(0)
    expect(alone.survived).toBe(false)
  }, 60000)
})

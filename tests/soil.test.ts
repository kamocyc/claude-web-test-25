import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { DIG_SOIL_YIELD, FLOOD_STOP_DEPTH } from '../src/data/constants'
import { canPlace, completeBuild, demolish, place } from '../src/sim/structures'
import { floodDamage } from '../src/sim/flood'

/** 平らな土地と蔵ひとつ。掘る前の土は 0 */
function ground(natural = 4): World {
  const grid = new Grid(16, 9)
  grid.natural.fill(natural)
  grid.refreshAllGround()
  const world = new World(grid, 1)
  world.createBuilding(defOf('storage'), grid.idx(1, 1), true)
  return world
}

/** その列を 1 段掘り終える */
function dig(world: World, i: number): boolean {
  const b = place(world, defOf('dig'), i)
  if (!b) return false
  completeBuild(world, b)
  return true
}

describe('掘った土で堤を築く', () => {
  it('1 段掘るごとに土が出る', () => {
    const w = ground()
    const i = w.grid.idx(6, 4)
    expect(w.stock.soil).toBe(0)

    expect(dig(w, i)).toBe(true)
    expect(w.stock.soil).toBe(DIG_SOIL_YIELD)
    expect(w.grid.natural[i]).toBe(3)

    expect(dig(w, i)).toBe(true)
    expect(w.stock.soil).toBe(DIG_SOIL_YIELD * 2)
  })

  it('掘り切った岩盤からは土が出ない', () => {
    const w = ground(1)
    const i = w.grid.idx(6, 4)
    expect(dig(w, i)).toBe(true)
    expect(w.grid.natural[i]).toBe(0)
    const had = w.stock.soil

    // もう掘れない。土も増えない
    expect(canPlace(w, defOf('dig'), i).reason).toBe('これ以上掘れない')
    expect(dig(w, i)).toBe(false)
    expect(w.stock.soil).toBe(had)
  })

  it('土が無ければ土手は築けず、掘れば築ける', () => {
    const w = ground()
    const spot = w.grid.idx(8, 4)
    expect(canPlace(w, defOf('levee'), spot).reason).toBe('資材が足りない')

    // 隣を掘れば、その土で 1 マスぶんの堤が積める
    dig(w, w.grid.idx(9, 4))
    expect(canPlace(w, defOf('levee'), spot).ok).toBe(true)
    const b = place(w, defOf('levee'), spot)!
    completeBuild(w, b)
    expect(w.grid.ground[spot]).toBe(5)
    expect(w.stock.soil).toBe(0) // 出た土をそのまま積んだ
  })

  it('堰も土で築く（丸太は要らない）', () => {
    const w = ground()
    const spot = w.grid.idx(8, 4)
    w.stock.log = 999
    expect(canPlace(w, defOf('dam'), spot).reason).toBe('資材が足りない')
    w.stock.soil = defOf('dam').cost.soil!
    expect(canPlace(w, defOf('dam'), spot).ok).toBe(true)
  })

  it('撤去すれば積んだ段数ぶんの土が戻る', () => {
    const w = ground()
    const spot = w.grid.idx(8, 4)
    w.stock.soil = 40 // 蔵の容量に余裕を持たせる（満杯だと戻り分が入らない）
    const before = w.stock.soil

    let b = place(w, defOf('levee'), spot)!
    completeBuild(w, b)
    b = place(w, defOf('levee'), spot)! // 2 段目を積む
    completeBuild(w, b)
    expect(b.stack).toBe(2)
    expect(w.stock.soil).toBe(before - 8)

    demolish(w, b)
    expect(w.stock.soil).toBe(before) // 払った分だけが戻る（増えない）
    expect(w.grid.ground[spot]).toBe(4)
  })

  it('蔵が浸かっても土は傷まない', () => {
    const w = ground()
    const shed = w.buildings[0]
    w.water.depth[shed.i] = FLOOD_STOP_DEPTH + 0.2
    w.stock.soil = 100
    w.stock.meal = 100

    for (let d = 0; d < 3; d++) floodDamage(w)
    expect(w.stock.meal).toBeLessThan(100) // 米は傷む
    expect(w.stock.soil).toBe(100) // 土は濡れても土のまま
  })

  it('掘った土は蔵に収まる分しか残らない', () => {
    // 蔵の容量を超えて掘っても、土だけが無尽蔵に積み上がったりはしない
    const w = ground()
    const cap = w.capacity
    for (let x = 2; x < 15; x++) {
      for (let n = 0; n < 4; n++) dig(w, w.grid.idx(x, 4))
    }
    expect(w.stock.soil).toBe(cap)
  })
})

describe('掘って積む往復', () => {
  it('初期在庫の土は数マスぶんで、それ以上の堤は掘って賄う', () => {
    // ゲーム開始時の在庫（mapgen）に合わせた見立て。ここでは 12 を置く
    const w = ground()
    w.stock.soil = 12
    let built = 0
    for (let x = 2; x < 10; x++) {
      const i = w.grid.idx(x, 4)
      if (!canPlace(w, defOf('levee'), i).ok) break
      completeBuild(w, place(w, defOf('levee'), i)!)
      built++
    }
    expect(built).toBe(3) // 12 / 4
    expect(w.stock.soil).toBe(0)

    // 続きを積むには掘るしかない
    const next = w.grid.idx(2 + built, 4)
    expect(canPlace(w, defOf('levee'), next).ok).toBe(false)
    dig(w, w.grid.idx(12, 6))
    expect(canPlace(w, defOf('levee'), next).ok).toBe(true)
  })
})

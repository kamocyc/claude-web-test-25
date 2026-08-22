import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Citizen } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { PathFinder } from '../src/sim/pathfinding'
import { updateCitizens } from '../src/sim/citizens'
import {
  ailmentsOf,
  daysText,
  deathLog,
  jobNameOf,
  shortageOf,
  summarize,
  ticksToDeath,
} from '../src/sim/people'
import { NEED_SEEK_THRESHOLD, STARVE_TICKS, TICKS_PER_DAY } from '../src/data/constants'
import { warnShortage } from '../src/sim/step'

function town(): World {
  const grid = new Grid(16, 9)
  grid.natural.fill(4)
  grid.refreshAllGround()
  return new World(grid, 1)
}

const person = (w: World, needs: Partial<Citizen['needs']>): Citizen => {
  const c = w.spawnCitizen(w.grid.idx(2, 4))
  Object.assign(c.needs, needs)
  return c
}

describe('住民の様子', () => {
  it('尽きた需要と減ってきた需要を見分ける', () => {
    const w = town()
    const fine = person(w, {})
    expect(ailmentsOf(fine)).toEqual([])

    const tired = person(w, { sleep: NEED_SEEK_THRESHOLD - 0.01 })
    expect(ailmentsOf(tired)).toEqual([{ kind: 'sleep', severe: false }])

    const dying = person(w, { food: 0, water: 0.2 })
    expect(ailmentsOf(dying)).toEqual([
      { kind: 'water', severe: false },
      { kind: 'food', severe: true },
    ])
  })

  it('村ぜんたいの人数をまとめる', () => {
    const w = town()
    person(w, {})
    person(w, { food: 0 })
    person(w, { food: 0 })
    person(w, { water: 0.1 })
    const s = summarize(w)
    expect(s.total).toBe(4)
    expect(s.severe.food).toBe(2)
    expect(s.warn.water).toBe(1)
    expect(s.severe.water).toBe(0)
    expect(s.jobless).toBe(4) // 職場がまだ無い
    expect(s.idle).toBe(4)
    expect(s.dying).toBe(0) // 判定は 1 tick 回してから付く
  })

  it('尽きかけている人だけ余命が出る', () => {
    const w = town()
    const c = person(w, {})
    expect(ticksToDeath(c)).toBeNull()
    c.starveKind = 'food'
    c.starveTicks = STARVE_TICKS - TICKS_PER_DAY
    expect(ticksToDeath(c)).toBe(TICKS_PER_DAY)
    expect(daysText(TICKS_PER_DAY)).toBe('1.0日')
    expect(daysText(TICKS_PER_DAY / 2)).toBe('12時間')
  })

  it('肩書きは職場の名前になり、無役なら何をしているかで代わる', () => {
    const w = town()
    const c = person(w, {})
    expect(jobNameOf(w, c)).toBe('手間')
    c.task = 'build'
    expect(jobNameOf(w, c)).toBe('普請')
    const mill = w.createBuilding(defOf('mill'), w.grid.idx(5, 4), true)
    c.jobId = mill.id
    expect(jobNameOf(w, c)).toBe('精米所')
  })
})

describe('力尽きる', () => {
  /** 蓄えを与えずに回し、最初の一人が消えるまでのログを返す */
  function starve(stockWater: number): string {
    const w = town()
    const store = w.createBuilding(defOf('storage'), w.grid.idx(8, 4), true)
    expect(store.built).toBe(true)
    w.stock.water = stockWater
    w.spawnCitizen(w.grid.idx(2, 4))
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    for (let t = 0; t < TICKS_PER_DAY * 30; t++) {
      w.tick++
      updateCitizens(w, path)
      if (w.citizens.length === 0) return w.log[w.log.length - 1]
    }
    return ''
  }

  it('渇きで死んだのか飢えで死んだのかが分かる', () => {
    expect(starve(0)).toContain('渇きで力尽きた')
    // 水はあるが食べ物が無ければ、飢えのほうが先に来る
    expect(starve(9999)).toContain('飢えで力尽きた')
  })

  it('需要が戻れば理由の記録も消える', () => {
    const w = town()
    const c = person(w, { water: 0 })
    const path = new PathFinder(w.grid)
    path.refresh(w.water)
    w.tick++
    updateCitizens(w, path)
    expect(c.starveKind).toBe('water')
    expect(c.starveTicks).toBeGreaterThan(0)

    c.needs.water = 1
    c.needs.food = 1
    w.tick++
    updateCitizens(w, path)
    expect(c.starveKind).toBe('')
    expect(c.starveTicks).toBe(0)
    expect(deathLog(c)).toBe(`${c.name} が力尽きた…`)
  })
})

describe('村として切らしているもの', () => {
  it('蔵が空なら、水も食べ物も「尽きた」として立つ', () => {
    const w = town()
    expect(shortageOf(w)).toEqual({ water: true, food: true })

    w.stock.water = 1
    w.stock.wheat = 1
    expect(shortageOf(w)).toEqual({ water: false, food: false })

    // 米が切れても麦が残っていれば食べ物はある
    w.stock.wheat = 0
    w.stock.meal = 3
    expect(shortageOf(w).food).toBe(false)

    // 1 杯に足りない端数は、飲めないので「尽きた」扱い
    w.stock.water = 0.4
    expect(shortageOf(w).water).toBe(true)
  })

  it('蔵に水が無ければ、喉が渇いていても飲みに行かない', () => {
    const w = town()
    w.createBuilding(defOf('storage'), w.grid.idx(1, 1), true)
    const c = person(w, { water: 0.1 })
    const path = new PathFinder(w.grid)
    path.refresh(w.water)

    w.tick++
    updateCitizens(w, path)
    expect(c.task).not.toBe('drink')

    // 水が入れば、そのまま飲みに向かう
    w.stock.water = 5
    c.task = 'idle'
    w.tick++
    updateCitizens(w, path)
    expect(c.task).toBe('drink')
  })

  it('尽きているあいだログは一度だけで、いったん戻ればまた出る', () => {
    const w = town()
    w.stock.meal = 99 // 食べ物の警告は混ぜない
    person(w, { water: 0.1 })
    const dryLogs = (): number => w.log.filter((l) => l.includes('蔵の水が尽きた')).length

    for (let d = 0; d < 3; d++) warnShortage(w) // 3 日ぶん
    expect(dryLogs()).toBe(1)

    // 水が戻れば黙り、また尽きればもう一度言う
    w.stock.water = 10
    warnShortage(w)
    expect(dryLogs()).toBe(1)
    w.stock.water = 0
    warnShortage(w)
    expect(dryLogs()).toBe(2)
  })

  it('欲しがっている人がいなければ黙っている', () => {
    const w = town()
    w.stock.meal = 99
    person(w, { water: 1 }) // まだ喉は渇いていない
    for (let d = 0; d < 3; d++) warnShortage(w) // 3 日ぶん
    expect(w.log.some((l) => l.includes('蔵の水が尽きた'))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Building } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { assignJobs, jobRank } from '../src/sim/citizens'

/**
 * 平らな土地。建物は完成済みで置き、住民は蔵の脇に湧かせる。
 * assignJobs は 10 tick ごとにしか動かないので、tick は 10 の倍数にしておく。
 */
function village(): World {
  const grid = new Grid(20, 9)
  grid.natural.fill(4)
  grid.refreshAllGround()
  const world = new World(grid, 1)
  world.irrigation.soilWet.fill(1)
  world.startI = grid.idx(1, 1)
  world.createBuilding(defOf('storage'), world.startI, true)
  world.tick = 10
  return world
}

const put = (w: World, id: string, x: number): Building =>
  w.createBuilding(defOf(id), w.grid.idx(x, 4), true)

const jobOf = (w: World, b: Building): string[] =>
  b.workers.map((id) => w.citizens.find((c) => c.id === id)!.name)

describe('働き手の割り当て', () => {
  it('既定（みな「並」）では建物の種類ごとの順に埋まる', () => {
    const w = village()
    const saw = put(w, 'sawmill', 4) // jobPriority 4
    const pump = put(w, 'pump', 6) // jobPriority 10
    const paddy = put(w, 'paddy', 8) // jobPriority 8
    w.spawnCitizen(w.startI)
    assignJobs(w)

    expect(pump.workers.length).toBe(1) // 水がいちばん先
    expect(paddy.workers.length).toBe(0)
    expect(saw.workers.length).toBe(0)
  })

  it('「高」にした職場が先に埋まる', () => {
    const w = village()
    const saw = put(w, 'sawmill', 4)
    const pump = put(w, 'pump', 6)
    saw.priority = 2 // 高
    w.spawnCitizen(w.startI)
    assignJobs(w)

    // 建物ごとの指定が、種類ごとの既定より先に効く
    expect(saw.workers.length).toBe(1)
    expect(pump.workers.length).toBe(0)
  })

  it('みなが職に就いたあとで「高」に上げると、低い職場から人が移る', () => {
    const w = village()
    const saw = put(w, 'sawmill', 4)
    const pump = put(w, 'pump', 6)
    w.spawnCitizen(w.startI)
    w.spawnCitizen(w.startI)
    assignJobs(w)
    expect(saw.workers.length).toBe(1)
    expect(pump.workers.length).toBe(1)
    const moved = jobOf(w, saw)[0]

    // 新しく建てた踏車。手はもう空いていない
    const pump2 = put(w, 'pump', 10)
    w.tick += 10
    assignJobs(w)

    expect(pump2.workers.length).toBe(1)
    expect(saw.workers.length).toBe(0) // いちばん弱い職場から出た
    expect(pump.workers.length).toBe(1) // 強い職場はそのまま
    expect(jobOf(w, pump2)).toEqual([moved])
    expect(w.citizens.find((c) => c.name === moved)!.jobId).toBe(pump2.id)
  })

  it('弱い職場の空きのために、強い職場から人は抜けない', () => {
    const w = village()
    const pump = put(w, 'pump', 6)
    const saw = put(w, 'sawmill', 4)
    w.spawnCitizen(w.startI)
    assignJobs(w)
    expect(pump.workers.length).toBe(1)
    expect(saw.workers.length).toBe(0)

    for (let n = 0; n < 5; n++) {
      w.tick += 10
      assignJobs(w)
    }
    expect(pump.workers.length).toBe(1)
    expect(saw.workers.length).toBe(0)
  })

  it('同じ優先度どうしでは人が行き来しない', () => {
    // 木挽小屋は 2 人まで。片方に 1 人だけ入れて、往復が起きないか見る
    const w = village()
    const a = put(w, 'sawmill', 4)
    const b = put(w, 'sawmill', 8)
    w.spawnCitizen(w.startI)
    assignJobs(w)
    const first = a.workers.length > 0 ? a : b
    expect(first.workers.length).toBe(1)

    for (let n = 0; n < 5; n++) {
      w.tick += 10
      assignJobs(w)
      expect(first.workers.length).toBe(1) // 同じ人が同じ職場に居続ける
    }
  })

  it('「低」に落とせば、その職場の人はほかへ回る', () => {
    const w = village()
    const saw = put(w, 'sawmill', 4)
    const farm = put(w, 'farm', 8) // jobPriority 6（既定では木挽より強い）
    w.spawnCitizen(w.startI)
    assignJobs(w)
    expect(farm.workers.length).toBe(1)

    farm.priority = 0 // 低
    w.tick += 10
    assignJobs(w)
    expect(saw.workers.length).toBe(1)
    expect(farm.workers.length).toBe(0)
  })

  it('優先度の段は種類ごとの既定より強い', () => {
    const w = village()
    const pump = put(w, 'pump', 6) // 既定は最強（10）
    const saw = put(w, 'sawmill', 4) // 既定は弱い（4）
    saw.priority = 2
    pump.priority = 1
    expect(jobRank(saw)).toBeGreaterThan(jobRank(pump))
  })
})

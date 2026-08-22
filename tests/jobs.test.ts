import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import type { Building } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { assignJobs, jobRank } from '../src/sim/citizens'
import { gapsText, staffingOf } from '../src/sim/people'

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

describe('人手の過不足', () => {
  it('持ち場が埋まっていれば不足は無い', () => {
    const w = village()
    put(w, 'pump', 6) // 1 人
    put(w, 'sawmill', 4) // 2 人
    for (let n = 0; n < 3; n++) w.spawnCitizen(w.startI)
    assignJobs(w)

    const s = staffingOf(w)
    expect(s.slots).toBe(3)
    expect(s.filled).toBe(3)
    expect(s.missing).toBe(0)
    expect(s.gaps).toEqual([])
  })

  it('人が足りなければ、足りない人数とその職場が出る', () => {
    const w = village()
    put(w, 'pump', 6)
    const saw = put(w, 'sawmill', 4)
    w.spawnCitizen(w.startI) // 1 人しかいない。踏車が先に埋まる
    assignJobs(w)

    const s = staffingOf(w)
    expect(s.missing).toBe(2)
    expect(s.gaps).toEqual([{ id: saw.id, i: saw.i, name: '木挽小屋', missing: 2 }])
    expect(gapsText(s.gaps)).toBe('木挽小屋 2')
  })

  it('足りない数の多い職場が先に並ぶ', () => {
    const w = village()
    const pump = put(w, 'pump', 6)
    const saw = put(w, 'sawmill', 4)
    const house = put(w, 'firehouse', 8) // 3 人
    const s = staffingOf(w) // 誰も配属していない

    expect(s.missing).toBe(6)
    expect(s.gaps.map((g) => g.id)).toEqual([house.id, saw.id, pump.id])
    expect(gapsText(s.gaps)).toBe('火消し詰所 3・木挽小屋 2・踏車 1')
  })

  it('建設中の建物は人手不足に数えない', () => {
    const w = village()
    w.createBuilding(defOf('sawmill'), w.grid.idx(4, 4), false)
    expect(staffingOf(w).missing).toBe(0)
    expect(staffingOf(w).slots).toBe(0)
  })

  it('水の合わない職場は数えない（人ではなく水が足りていない）', () => {
    const w = village()
    put(w, 'paddy', 6) // 水の無い田。assignJobs は承知の上で人を置かない
    const farm = put(w, 'farm', 8)
    const s = staffingOf(w)

    expect(s.missing).toBe(1)
    expect(s.gaps.map((g) => g.id)).toEqual([farm.id])
  })

  it('人を増やせば不足はその分だけ減る', () => {
    const w = village()
    put(w, 'pump', 6)
    put(w, 'sawmill', 4)
    expect(staffingOf(w).missing).toBe(3)

    for (let n = 0; n < 2; n++) {
      w.spawnCitizen(w.startI)
      w.tick += 10
      assignJobs(w)
    }
    expect(staffingOf(w).missing).toBe(1)
  })

  it('同じ種類の職場は一行にまとめて言う', () => {
    const w = village()
    put(w, 'wharf', 4)
    put(w, 'wharf', 6)
    put(w, 'pump', 8)
    // 一覧は職場ごとに分かれているが、一行の要約では足し合わせる
    expect(staffingOf(w).gaps.length).toBe(3)
    expect(gapsText(staffingOf(w).gaps)).toBe('船着場 2・踏車 1')
  })

  it('「無役」と「人手不足」は別のものを数えている', () => {
    // 職場が無いのに人だけいる村。持ち場は余っていないので人手は足りている
    const w = village()
    w.spawnCitizen(w.startI)
    assignJobs(w)

    expect(w.citizens[0].jobId).toBe(-1) // 無役
    expect(staffingOf(w).missing).toBe(0) // でも人手不足ではない
  })
})

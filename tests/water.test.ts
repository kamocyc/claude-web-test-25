import { describe, expect, it } from 'vitest'
import { Grid } from '../src/core/grid'
import { WaterSim } from '../src/sim/water'
import {
  CELL,
  EVAP_MULT,
  EVAP_RATE,
  TICKS_PER_DAY,
  TICK_DT,
  WATER_SUBSTEPS,
} from '../src/data/constants'

const SUB_DT = TICK_DT / WATER_SUBSTEPS

function flat(w: number, h: number, height: number): Grid {
  const g = new Grid(w, h)
  g.natural.fill(height)
  g.refreshAllGround()
  return g
}

function run(sim: WaterSim, ticks: number, evap = 0): void {
  for (let t = 0; t < ticks; t++) {
    for (let s = 0; s < WATER_SUBSTEPS; s++) sim.step(SUB_DT, evap)
  }
}

describe('水流ソルバ', () => {
  it('閉じた領域では総水量が保存される', () => {
    const g = flat(16, 16, 4)
    const sim = new WaterSim(g)
    sim.addWater(g.idx(8, 8), 40)
    sim.addWater(g.idx(3, 12), 15)
    const before = sim.totalVolume()
    run(sim, 300)
    expect(sim.totalVolume()).toBeCloseTo(before, 8)
  })

  it('負の水深が生じない', () => {
    const g = flat(12, 12, 2)
    // 起伏を付けて急勾配を作る
    for (let i = 0; i < g.size; i++) g.natural[i] = (g.xOf(i) * 7 + g.yOf(i) * 3) % 9
    g.refreshAllGround()
    const sim = new WaterSim(g)
    sim.addWater(g.idx(6, 6), 200)
    run(sim, 400)
    for (let i = 0; i < g.size; i++) {
      expect(Number.isFinite(sim.depth[i])).toBe(true)
      expect(sim.depth[i]).toBeGreaterThanOrEqual(0)
    }
  })

  it('凹地に注いだ水は水平な水面に収束する', () => {
    const g = new Grid(20, 20)
    for (let i = 0; i < g.size; i++) {
      const x = g.xOf(i)
      const y = g.yOf(i)
      const inner = x > 2 && x < 17 && y > 2 && y < 17
      g.natural[i] = inner ? 2 + ((x + y) % 3) : 10
    }
    g.refreshAllGround()
    const sim = new WaterSim(g)
    sim.addWater(g.idx(5, 5), 300)
    run(sim, 1200)
    const levels: number[] = []
    for (let i = 0; i < g.size; i++) if (sim.depth[i] > 0.05) levels.push(sim.surface(i))
    expect(levels.length).toBeGreaterThan(50)
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length
    const variance = levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length
    expect(variance).toBeLessThan(1e-3)
  })

  it('ダムは天端まで貯水し、超えた分だけ越流する', () => {
    // 緩やかに下る 1 マス幅の水路。ダムの有無だけを変えて比較する。
    const build = (withDam: boolean) => {
      const g = new Grid(1, 40)
      for (let y = 0; y < 40; y++) g.natural[g.idx(0, y)] = Math.max(0, 6 - ((y / 6) | 0))
      g.refreshAllGround()
      g.isDrain[g.idx(0, 39)] = 1
      if (withDam) {
        g.barrier[g.idx(0, 20)] = 1
        g.flowResist[g.idx(0, 20)] = 0.3
      }
      const sim = new WaterSim(g)
      for (let t = 0; t < 2500; t++) {
        sim.addWater(g.idx(0, 0), 0.05)
        for (let s = 0; s < WATER_SUBSTEPS; s++) sim.step(SUB_DT)
      }
      return { g, sim }
    }
    const dammed = build(true)
    const free = build(false)
    const probe = dammed.g.idx(0, 19)
    // ダムの直上流では水位が 1 ブロック近く持ち上がっている
    const rise = dammed.sim.surface(probe) - free.sim.surface(probe)
    expect(rise).toBeGreaterThan(0.7)
    // 天端を越えた分は下流へ流れ続けている
    expect(dammed.sim.depth[dammed.g.idx(0, 30)]).toBeGreaterThan(0.02)
    // 越流しているので上流が無限に溜まり続けることはない（天端 + 頭の範囲）
    const head = dammed.sim.surface(probe) - dammed.g.bed(dammed.g.idx(0, 20))
    expect(head).toBeGreaterThan(0)
    expect(head).toBeLessThan(1.0)
  })

  it('水門を開けると貯水が放流される', () => {
    const g = flat(1, 40, 0)
    g.isDrain[g.idx(0, 39)] = 1
    const gate = g.idx(0, 20)
    g.barrier[gate] = 3
    g.flowResist[gate] = 0.3
    const sim = new WaterSim(g)
    for (let t = 0; t < 1200; t++) {
      sim.addWater(g.idx(0, 1), 0.08)
      for (let s = 0; s < WATER_SUBSTEPS; s++) sim.step(SUB_DT)
    }
    const stored = sim.surface(g.idx(0, 10))
    expect(stored).toBeGreaterThan(2.0) // 高さ 3 の水門で貯水できている
    g.barrier[gate] = 0 // 全開
    run(sim, 900)
    expect(sim.surface(g.idx(0, 10))).toBeLessThan(stored - 1.0)
  })

  it('下流の河床が高ければ遡上しない', () => {
    const g = flat(1, 20, 0)
    for (let y = 10; y < 20; y++) g.natural[g.idx(0, y)] = 5
    g.refreshAllGround()
    const sim = new WaterSim(g)
    sim.addWater(g.idx(0, 2), 8)
    run(sim, 500)
    for (let y = 10; y < 20; y++) expect(sim.depth[g.idx(0, y)]).toBeLessThan(1e-9)
  })

  it('排水口からは水が抜け、壁からは抜けない', () => {
    const closed = flat(8, 8, 0)
    const simA = new WaterSim(closed)
    simA.addWater(closed.idx(4, 4), 20)
    run(simA, 200)
    expect(simA.totalVolume()).toBeCloseTo(20, 8)

    const open = flat(8, 8, 0)
    for (let x = 0; x < 8; x++) open.isDrain[open.idx(x, 7)] = 1
    const simB = new WaterSim(open)
    simB.addWater(open.idx(4, 4), 20)
    run(simB, 1000)
    // 薄い水膜は断面が小さく抜けが遅い（実際の挙動）ので 1 割程度まで減ればよい
    expect(simB.totalVolume()).toBeLessThan(2)
  })

  it('深い水でも蒸発が止まらない', () => {
    // 以前は水深 0.5 以上で係数が下限に張り付き、貯めた水がいつまでも減らなかった。
    // 2 m の貯水池が空になるのに 340 日かかる計算で、日照りに何の意味も無かった。
    const day = TICKS_PER_DAY
    // 盤面いっぱいに同じ深さで張る（水面が水平なので流れは起きず、減るのは蒸発の分だけ）
    const pond = (depth: number, evap: number): number => {
      const g = flat(4, 4, 4)
      const sim = new WaterSim(g)
      sim.depth.fill(depth)
      run(sim, day * 10, evap)
      return depth - sim.depth[g.idx(2, 2)]
    }
    const droughtRate = EVAP_RATE * EVAP_MULT.drought
    // 日照りが 10 日続けば、2 m の貯水池でも 0.3 m 以上は減る（実測 0.49）
    expect(pond(2, droughtRate)).toBeGreaterThan(0.3)
    // ただし浅い水のほうが速い（水面はよく温まる）
    expect(pond(0.1, droughtRate)).toBeGreaterThan(0)
    const shallow = pond(0.3, droughtRate) / 0.3
    const deep = pond(2, droughtRate) / 2
    expect(shallow).toBeGreaterThan(deep)
    // 平年は日照りの 1/3 の速さ
    expect(pond(2, EVAP_RATE * EVAP_MULT.normal)).toBeLessThan(pond(2, droughtRate) * 0.4)
  })

  it('セル面積の定義と体積が整合する', () => {
    const g = flat(4, 4, 0)
    const sim = new WaterSim(g)
    sim.addWater(g.idx(1, 1), 3)
    expect(sim.depth[g.idx(1, 1)]).toBeCloseTo(3 / (CELL * CELL), 10)
  })
})

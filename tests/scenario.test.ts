import { describe, expect, it } from 'vitest'
import { Game } from '../src/core/game'
import { World } from '../src/core/world'
import { defOf } from '../src/data/buildings'
import { canPlace, completeBuild, intakeOf, place, setGateHeight } from '../src/sim/structures'
import { PUMP_MIN_DEPTH, SOIL_GROW_THRESHOLD, TICKS_PER_DAY } from '../src/data/constants'

const run = (g: Game, ticks: number): void => {
  for (let t = 0; t < ticks; t++) g.step()
}

/**
 * 耕作できる土地の広さ。判定は生産側（production.ts の農地）と同じ条件にする:
 * 水没しておらず、土壌水分が SOIL_GROW_THRESHOLD 以上の列。
 */
function arable(w: World): number {
  let n = 0
  for (let i = 0; i < w.grid.size; i++) {
    if (w.water.depth[i] === 0 && w.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD) n++
  }
  return n
}

/** 入植地に一番近い、条件を満たす列 */
function nearestSpot(g: Game, ok: (i: number) => boolean): number {
  const { grid, startI } = g.world
  const sx = grid.xOf(startI)
  const sy = grid.yOf(startI)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < grid.size; i++) {
    const d = Math.abs(grid.xOf(i) - sx) + Math.abs(grid.yOf(i) - sy)
    if (d >= bestD) continue
    if (!ok(i)) continue
    bestD = d
    best = i
  }
  return best
}

describe('灌漑で耕作できる土地が広がる', () => {
  it('灌漑塔を建てると乾いた土地が耕せるようになり、止めると元に戻る', () => {
    const g = new Game({ w: 48, h: 48, seed: 21 })
    const w = g.world
    w.stock.log = 999
    w.stock.plank = 999
    w.stock.water = 999 // 塔の水切れで話がぶれないようにする
    run(g, 120)

    const before = arable(w)
    expect(before).toBeGreaterThan(0) // 川沿いは最初から耕せる

    // 乾いていて（moisture 0）、働き手が歩いて行ける塔の建設地
    const tower = nearestSpot(
      g,
      (i) => w.irrigation.moisture[i] === 0 && canPlace(w, defOf('irrigation'), i).ok && !!g.path.find(w.startI, i),
    )
    expect(tower).toBeGreaterThanOrEqual(0)
    expect(w.irrigation.soilWet[tower]).toBeLessThan(SOIL_GROW_THRESHOLD)

    const b = place(w, defOf('irrigation'), tower)
    expect(b).not.toBeNull()
    completeBuild(w, b!)
    run(g, TICKS_PER_DAY * 2)

    const after = arable(w)
    // 射程 8 の塔ひとつで、段差の分を差し引いても数十マスは増える（計測時 172 → 201）
    expect(after).toBeGreaterThan(before + 20)
    expect(w.irrigation.soilWet[tower]).toBeGreaterThanOrEqual(SOIL_GROW_THRESHOLD)

    // 水を切らすと塔は止まり、土は乾いて元の広さに戻る
    w.stock.water = 0
    run(g, TICKS_PER_DAY * 3)
    expect(arable(w)).toBeLessThan(after - 20)
    expect(w.irrigation.soilWet[tower]).toBeLessThan(SOIL_GROW_THRESHOLD)
  }, 60000)

  it('乾いた土地の農地は灌漑してはじめて実る', () => {
    const g = new Game({ w: 48, h: 48, seed: 21 })
    const w = g.world
    w.stock.log = 999
    w.stock.plank = 999
    w.stock.water = 999
    run(g, 120)

    // 乾いた農地の候補と、その隣に建てられる塔の候補を同時に探す
    let towerI = -1
    const farmI = nearestSpot(g, (i) => {
      if (w.irrigation.moisture[i] !== 0) return false
      if (!canPlace(w, defOf('farm'), i).ok) return false
      if (!g.path.find(w.startI, i)) return false
      let t = -1
      w.grid.forEachNeighbor(i, (n) => {
        if (t < 0 && w.irrigation.moisture[n] === 0 && canPlace(w, defOf('irrigation'), n).ok) t = n
      })
      if (t < 0) return false
      towerI = t
      return true
    })
    expect(farmI).toBeGreaterThanOrEqual(0)

    const farm = place(w, defOf('farm'), farmI)!
    completeBuild(w, farm)
    run(g, TICKS_PER_DAY * 2)
    // 灌漑前は乾いていて何も育たない
    expect(farm.status).toBe('土が乾いている')
    expect(farm.progress).toBe(0)
    expect(w.stock.wheat).toBe(0)

    const tower = place(w, defOf('irrigation'), towerI)!
    completeBuild(w, tower)
    run(g, TICKS_PER_DAY * 3)
    // 灌漑が届けば同じ畑が実る
    expect(w.irrigation.soilWet[farmI]).toBeGreaterThanOrEqual(SOIL_GROW_THRESHOLD)
    expect(w.stock.wheat).toBeGreaterThan(0)

    // 塔を止めれば土は乾き、収穫も止まる
    w.stock.water = 0
    run(g, TICKS_PER_DAY * 3)
    expect(w.irrigation.soilWet[farmI]).toBeLessThan(SOIL_GROW_THRESHOLD)
    const harvested = w.stock.wheat
    run(g, TICKS_PER_DAY * 2)
    expect(w.stock.wheat).toBe(harvested)
  }, 60000)
})

type Weir = 'none' | 'dam' | 'floodgate'

interface DroughtResult {
  pumpI: number
  /** 堰の列。上流の貯水量を測る境界にも使う */
  weirRow: number
  filled: number
  upstream: number
  intakeDepth: number
  stockWater: number
  population: number
  pumpStatus: string
}

/** 堰より上流に溜まっている水の総量 */
function upstreamVolume(w: World, row: number): number {
  let v = 0
  for (let y = 0; y < row; y++) {
    for (let x = 0; x < w.grid.w; x++) v += w.water.depth[w.grid.idx(x, y)]
  }
  return v
}

/**
 * 揚水ポンプを 1 基置き、川に堰を架けてから長い渇水を起こす。
 * ポンプの位置は堰を建てる前に決めるので、どの条件でも同じ列になる（設備の差だけを見る）。
 */
function droughtScenario(opts: {
  weir: Weir
  rowOffset?: number
  fillDays?: number
  openGatesAtDrought?: boolean
}): DroughtResult {
  const g = new Game({ w: 48, h: 48, seed: 31 })
  const w = g.world
  w.stock.log = 999
  w.stock.plank = 999
  run(g, 120)

  const pumpI = nearestSpot(g, (i) => canPlace(w, defOf('pump'), i).ok)
  const pump = place(w, defOf('pump'), pumpI)!
  completeBuild(w, pump)

  const weirRow = w.grid.yOf(pumpI) + (opts.rowOffset ?? 2)
  const gates = []
  if (opts.weir !== 'none') {
    // 川幅（濡れている列）の両端 +1 まで塞ぐ
    const xs: number[] = []
    for (let x = 0; x < w.grid.w; x++) if (w.water.depth[w.grid.idx(x, weirRow)] > 0.2) xs.push(x)
    expect(xs.length).toBeGreaterThan(2)
    for (let x = xs[0] - 1; x <= xs[xs.length - 1] + 1; x++) {
      const b = place(w, defOf(opts.weir), w.grid.idx(x, weirRow))
      if (b) {
        completeBuild(w, b)
        gates.push(b)
      }
    }
    expect(gates.length).toBeGreaterThan(2)
  }
  run(g, TICKS_PER_DAY * (opts.fillDays ?? 2))
  const filled = upstreamVolume(w, weirRow)

  // 人口が増えた集落が長い渇水（12 日）に入る場面にする。
  // 食料は十分に持たせ、水だけが生死を分けるようにする。
  w.season.kind = 'drought'
  w.season.elapsed = 0
  w.season.cycle = 9
  for (let n = 0; n < 15; n++) w.spawnCitizen(w.startI)
  w.stock.bread = 400
  if (opts.openGatesAtDrought) for (const b of gates) setGateHeight(w, b, 0)

  run(g, TICKS_PER_DAY * 11)
  const intake = intakeOf(w, pump.i)
  return {
    pumpI,
    weirRow,
    filled,
    upstream: upstreamVolume(w, weirRow),
    intakeDepth: intake >= 0 ? w.water.depth[intake] : 0,
    stockWater: w.stock.water,
    population: w.citizens.length,
    pumpStatus: pump.status,
  }
}

describe('ダムと水門で渇水をしのぐ', () => {
  it('ダムで貯めた水があれば渇水を越えられる（無ければ干上がる）', () => {
    const dammed = droughtScenario({ weir: 'dam' })
    const free = droughtScenario({ weir: 'none' })
    // 設備以外は同じ条件であること
    expect(dammed.pumpI).toBe(free.pumpI)

    // ダムがあれば取水を続けられ、集落は無傷で渇水を越える
    expect(dammed.intakeDepth).toBeGreaterThanOrEqual(PUMP_MIN_DEPTH)
    expect(dammed.pumpStatus).not.toBe('取水できる水がない')
    expect(dammed.stockWater).toBeGreaterThan(0)
    expect(dammed.population).toBe(20)

    // ダムが無ければ川は流れ去り、取水できず集落は崩壊する
    expect(free.intakeDepth).toBeLessThan(PUMP_MIN_DEPTH)
    expect(free.stockWater).toBe(0)
    expect(free.population).toBeLessThan(5)

    // 上流に残った水の量そのものに差が出ている
    expect(dammed.upstream).toBeGreaterThan(free.upstream * 5 + 10)
  }, 120000)

  it('水門を閉じておけば貯水が保たれ、開ければ流れ去る', () => {
    const shut = droughtScenario({ weir: 'floodgate', rowOffset: 3, fillDays: 3 })
    const open = droughtScenario({
      weir: 'floodgate',
      rowOffset: 3,
      fillDays: 3,
      openGatesAtDrought: true,
    })
    // 渇水に入るまでは同じ貯水量から始まっている
    expect(shut.filled).toBeCloseTo(open.filled, 5)

    // 閉じたまま：貯水はほとんど減らず、ポンプも集落も無事
    expect(shut.upstream).toBeGreaterThan(shut.filled * 0.8)
    expect(shut.intakeDepth).toBeGreaterThanOrEqual(PUMP_MIN_DEPTH)
    expect(shut.population).toBe(20)

    // 全開：溜めた水は下流へ流れ去り、取水できなくなる
    expect(open.upstream).toBeLessThan(shut.upstream * 0.1)
    expect(open.intakeDepth).toBeLessThan(PUMP_MIN_DEPTH)
    expect(open.population).toBeLessThan(5)
  }, 120000)
})

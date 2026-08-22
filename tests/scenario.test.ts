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
 * 耕作できる土地の広さ。判定は生産側（production.ts の畑）と同じ条件にする:
 * 水没しておらず、土壌水分が SOIL_GROW_THRESHOLD 以上の列。
 *
 * around を渡すとその周辺だけ数える。川沿いの氾濫原はもともと広く湿っているので、
 * 灌漑塔の効果を見るときは塔の周りに限って数える。
 */
function arable(w: World, around = -1, radius = 6): number {
  let n = 0
  for (let i = 0; i < w.grid.size; i++) {
    if (around >= 0) {
      const dx = Math.abs(w.grid.xOf(i) - w.grid.xOf(around))
      const dy = Math.abs(w.grid.yOf(i) - w.grid.yOf(around))
      if (dx > radius || dy > radius) continue
    }
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

    // 塔を建てる場所の条件:
    //   - 乾いている（moisture 0）
    //   - まわりに乾いた平地がまとまって残っている（塔が実際に潤せる土地があること）
    //   - 働き手が歩いて行ける（無人だと塔は動かない）
    // 入植地に近い順に選ぶので、住民が通える距離に収まる。
    const dryFlatAround = (i: number, r: number): number => {
      const { grid } = w
      let n = 0
      for (let y = Math.max(0, grid.yOf(i) - r); y <= Math.min(grid.h - 1, grid.yOf(i) + r); y++) {
        for (let x = Math.max(0, grid.xOf(i) - r); x <= Math.min(grid.w - 1, grid.xOf(i) + r); x++) {
          const j = grid.idx(x, y)
          if (w.irrigation.moisture[j] === 0 && Math.abs(grid.ground[j] - grid.ground[i]) <= 1) n++
        }
      }
      return n
    }
    const tower = nearestSpot(
      g,
      (i) =>
        w.irrigation.moisture[i] === 0 &&
        canPlace(w, defOf('irrigation'), i).ok &&
        dryFlatAround(i, 8) >= 60 &&
        !!g.path.find(w.startI, i),
    )
    expect(tower).toBeGreaterThanOrEqual(0)
    expect(w.irrigation.soilWet[tower]).toBeLessThan(SOIL_GROW_THRESHOLD)

    const before = arable(w, tower)
    const b = place(w, defOf('irrigation'), tower)
    expect(b).not.toBeNull()
    completeBuild(w, b!)
    run(g, TICKS_PER_DAY * 2)

    const after = arable(w, tower)
    // 実測 +32。射程 8 の塔ひとつで、段差の分を差し引いても数十マスは増える
    expect(after).toBeGreaterThan(before + 24)
    expect(w.irrigation.soilWet[tower]).toBeGreaterThanOrEqual(SOIL_GROW_THRESHOLD)

    // 水を切らすと塔は止まり、土は乾いて元の広さに戻る
    w.stock.water = 0
    run(g, TICKS_PER_DAY * 3)
    expect(arable(w, tower)).toBeLessThan(after - 24)
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
  /** 荷の運び方と、踏車に残っている水（渇水中に細く届く分） */
  pumpRoute: string
  pumpLoad: number
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
  droughtDays?: number
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
  w.season.prevKind = 'normal' // 流量が 1 日かけて細っていく
  w.season.elapsed = 0
  w.season.lengthDays = 20 // 試験中に季節が変わらないようにする
  w.season.cycle = 9
  for (let n = 0; n < 15; n++) w.spawnCitizen(w.startI)
  w.stock.meal = 400
  if (opts.openGatesAtDrought) for (const b of gates) setGateHeight(w, b, 0)

  run(g, TICKS_PER_DAY * (opts.droughtDays ?? 11))
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
    pumpRoute: g.logistics.routeOf(pump.id),
    pumpLoad: pump.load,
  }
}

describe('ダムと水門で渇水をしのぐ', () => {
  it('ダムで貯めた水があれば渇水を越えられる（無ければ干上がる）', () => {
    const dammed = droughtScenario({ weir: 'dam' })
    const free = droughtScenario({ weir: 'none' })
    // 設備以外は同じ条件であること
    expect(dammed.pumpI).toBe(free.pumpI)

    // 堰があれば、溜めた水と蓄えで 11 日の日照りを越えられる
    expect(dammed.stockWater).toBeGreaterThan(0)
    expect(dammed.population).toBe(20)

    // 堰が無ければ川は流れ去り、蓄えも尽きて集落は絶える
    expect(free.intakeDepth).toBeLessThan(PUMP_MIN_DEPTH)
    expect(free.stockWater).toBe(0)
    expect(free.population).toBe(0)

    // 上流に残った水の量そのものに差が出ている（実測 9.7 と 0）
    expect(dammed.upstream).toBeGreaterThan(free.upstream + 5)

    // ただし 11 日ともなると堰だけでは取水口までは保たない（そのための水門）。
    // ふつうの長さ（8 日）の日照りなら、堰があれば汲み続けられる
    const short = droughtScenario({ weir: 'dam', droughtDays: 8 })
    expect(short.intakeDepth).toBeGreaterThanOrEqual(PUMP_MIN_DEPTH) // 実測 0.72
    expect(short.pumpStatus).toBe('稼働中')
  }, 180000)

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

    // 閉じたまま：貯水が残り、ポンプも集落も無事。
    // 氾濫原が広いので堰の両端を回り込んで下流へ抜けるうえ、11 日ぶんの蒸発も効く。
    // 満水のままとはいかない（実測 155 → 22。谷を端まで締め切れば止められる）。
    expect(shut.upstream).toBeGreaterThan(shut.filled * 0.1)
    expect(shut.intakeDepth).toBeGreaterThanOrEqual(PUMP_MIN_DEPTH)
    expect(shut.population).toBe(20)

    // 全開：溜めた水は下流へ流れ去り、取水できなくなる
    expect(open.upstream).toBeLessThan(shut.upstream * 0.1)
    expect(open.upstream).toBeLessThan(open.filled * 0.05)
    expect(open.intakeDepth).toBeLessThan(PUMP_MIN_DEPTH)
    expect(open.population).toBeLessThan(shut.population - 8) // 実測 20 人と 9 人
  }, 120000)
})

import { Game } from '../core/game'
import { World } from '../core/world'
import type { Building } from '../core/world'
import { canPlace, completeBuild, place } from '../sim/structures'
import { defOf } from './buildings'
import {
  PADDY_MAX_DEPTH,
  PADDY_MIN_DEPTH,
  SOIL_GROW_THRESHOLD,
  TICKS_PER_DAY,
} from './constants'

/** サンプルの村はいつも同じ地形・同じ配置になるよう、シードを固定する */
export const SAMPLE_SEED = 4242

/** 庄屋に一番近い、条件を満たす列を探す */
function spotNear(g: Game, ok: (i: number) => boolean): number {
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

/** その場で建てて完成させる。建てられなければ null */
function build(g: Game, defId: string, i: number): Building | null {
  if (i < 0) return null
  const b = place(g.world, defOf(defId), i)
  if (b) completeBuild(g.world, b)
  return b
}

/** 働き手が通える場所か */
function reachable(g: Game, i: number): boolean {
  return !!g.path.find(g.world.startI, i)
}

/** 既にある建物から min マス以上離れているか（建物が団子にならないように） */
function spaced(g: Game, i: number, min: number): boolean {
  const { grid, buildings } = g.world
  const x = grid.xOf(i)
  const y = grid.yOf(i)
  for (const b of buildings) {
    const d = Math.max(Math.abs(grid.xOf(b.i) - x), Math.abs(grid.yOf(b.i) - y))
    if (d < min) return false
  }
  return true
}

/** その列を n 段掘り下げる */
function dig(g: Game, i: number, times: number): void {
  for (let n = 0; n < times; n++) {
    const b = place(g.world, defOf('dig'), i)
    if (b) completeBuild(g.world, b)
  }
}

/** 川を横断するように堰を架ける。中央の 1 マスだけ水門にして水位を操作できるようにする */
function damAcross(g: Game, row: number): number {
  const { grid, water } = g.world
  const xs: number[] = []
  for (let x = 0; x < grid.w; x++) if (water.depth[grid.idx(x, row)] > 0.2) xs.push(x)
  if (xs.length === 0) return 0
  const from = xs[0] - 1
  const to = xs[xs.length - 1] + 1
  const middle = Math.round((from + to) / 2)
  let n = 0
  for (let x = from; x <= to; x++) {
    if (x < 0 || x >= grid.w) continue
    if (build(g, x === middle ? 'floodgate' : 'dam', grid.idx(x, row))) n++
  }
  return n
}

/** その行でいちばん深い列の x */
function deepestOn(g: Game, row: number): number {
  const { grid, water } = g.world
  let best = 0
  let bestX = 0
  for (let x = 0; x < grid.w; x++) {
    const d = water.depth[grid.idx(x, row)]
    if (d > best) {
      best = d
      bestX = x
    }
  }
  return bestX
}

/** その行の、集落側の岸（水際の 1 マス外）と、そこから内陸へ向かう向き */
function bankOn(g: Game, row: number): { x: number; dir: number } | null {
  const { grid, water } = g.world
  const xs: number[] = []
  for (let x = 0; x < grid.w; x++) if (water.depth[grid.idx(x, row)] > 0.3) xs.push(x)
  if (xs.length === 0) return null
  const sx = grid.xOf(g.world.startI)
  const left = xs[0]
  const right = xs[xs.length - 1]
  return sx > right ? { x: right + 1, dir: 1 } : { x: left - 1, dir: -1 }
}

/**
 * 川の水面の高さ。堰でどれだけ持ち上がっているかは掘る前に分からないので、
 * その行の水から直に読む。
 */
function riverSurface(g: Game, row: number): number {
  const { grid, water } = g.world
  let best = -Infinity
  for (let x = 0; x < grid.w; x++) {
    const i = grid.idx(x, row)
    if (water.depth[i] > 0.3) best = Math.max(best, water.surface(i))
  }
  return best
}

/**
 * 目当ての水深になるよう列を掘り下げる。
 *
 * 水が来てから深さを測ろうとすると、溝を伝って水が回るまでの間に掘りすぎてしまう。
 * 先に川の水面の高さを読み、そこから逆算して床の高さを決める。
 */
function trench(g: Game, cells: number[], surface: number, depth: number): void {
  const { grid } = g.world
  const wantBed = Math.floor(surface - depth)
  for (const i of cells) {
    let guard = 0
    while (grid.natural[i] > 0 && grid.bed(i) > wantBed && guard++ < 6) dig(g, i, 1)
  }
}

/**
 * 川岸から内陸へ溝を引く。溝そのものの列と、その脇に開いた区画を返す。
 *
 * 区画は溝のすぐ隣（深い段）と、その一つ外（浅い段）の二段に開く。
 * 堰の上流はしばらく水位が上がり続けるうえ、床の高さは整数なので、
 * 掘った時点の水深を狙って合わせても落ち着いたときにどうなるかは決められない。
 * 高さの違う段を二列作っておけば、どちらかが稲の育つ水深に収まる。
 * 収まらなかったほうはため池として残り、防火用水になる。
 */
function ditchFrom(
  g: Game,
  row: number,
  length: number,
  depth: number,
  plotDepth: number,
): { line: number[]; plots: number[] } {
  const { grid } = g.world
  const bank = bankOn(g, row)
  const surface = riverSurface(g, row)
  if (!bank || surface === -Infinity) return { line: [], plots: [] }
  const line: number[] = []
  const inner: number[] = []
  const outer: number[] = []
  // 川のいちばん深いところから掘り始める。岸の浅瀬を残すと、掘った溝が
  // 深いだけの独立した池になり、舟が川へ出られない
  const from = deepestOn(g, row)
  // 川側へは深いところを通り越すまで掘る。掘っているあいだに水位が下がって
  // 岸が後退することがあるので、余分に見ておく
  const reach = Math.abs(bank.x - from) + 4
  for (let n = -reach; n <= length; n++) {
    const x = bank.x + bank.dir * n
    if (x < 1 || x >= grid.w - 1) continue
    line.push(grid.idx(x, row))
    if (plotDepth <= 0 || n <= 0) continue
    for (const dy of [-1, 1]) {
      if (row + dy >= 1 && row + dy < grid.h - 1) inner.push(grid.idx(x, row + dy))
      if (row + dy * 2 >= 1 && row + dy * 2 < grid.h - 1) outer.push(grid.idx(x, row + dy * 2))
    }
  }
  trench(g, line, surface, depth)
  if (plotDepth > 0) {
    trench(g, inner, surface, plotDepth)
    trench(g, outer, surface, plotDepth - 1)
  }
  return { line, plots: [...inner, ...outer] }
}

/** a から b へまっすぐ道を敷く */
function roadTo(g: Game, a: number, b: number): void {
  const { grid } = g.world
  let x = grid.xOf(a)
  let y = grid.yOf(a)
  const tx = grid.xOf(b)
  const ty = grid.yOf(b)
  for (let guard = 0; guard < 200 && (x !== tx || y !== ty); guard++) {
    if (x !== tx) x += Math.sign(tx - x)
    else y += Math.sign(ty - y)
    build(g, 'road', grid.idx(x, y))
  }
}

/**
 * 「もう村ができている」状態のゲームを作る。
 *
 * 川を堰き止めて水位を上げ、用水路で田に水を引き、籾を搗いて米にする、という
 * 一巡が回っているところまで進めてある。運河を掘って船着場でつないだ出作りの田、
 * 用水櫓で潤した畑、火の見櫓と火消し詰所も置いてあるので、
 * この game の仕掛けがひととおり目に入るようにしてある。
 */
export function createSampleGame(w = 80, h = 80): Game {
  const g = new Game({ w, h, seed: SAMPLE_SEED })
  const world = g.world
  const { grid } = world
  const startRow = grid.yOf(world.startI)

  // 建設資材は潤沢にしておき、最後に村らしい在庫へ戻す
  world.stock.log = 9999
  world.stock.plank = 9999
  for (let t = 0; t < 120; t++) g.step()

  // 1. まず川を堰き止める（水位が上がってから水辺の設備を置く）
  damAcross(g, startRow + 14)
  // 溝の深さは水面から逆算するので、堰の上流が満ちきってから掘る。
  // 溜まりきる前に掘ると、あとで水位が上がって田が水没する。
  for (let t = 0; t < TICKS_PER_DAY * 6; t++) g.step()
  g.path.refresh(world.water)

  // 2. 水辺の設備
  for (let n = 0; n < 2; n++) {
    build(
      g,
      'pump',
      spotNear(g, (i) => canPlace(world, defOf('pump'), i).ok && reachable(g, i) && spaced(g, i, 2)),
    )
  }

  // 3. 用水路と水田（村のすぐ上手）
  const near = ditchFrom(g, startRow - 3, 2, 0.9, 0.5)

  // 4. 運河と出作りの田（村から離れた下手）。舟が通る深さまで掘り、その脇に田を開く。
  //    陸路では捌けない距離なので、船着場でつないで荷を運ぶ
  // 運河は堰の上流に掘る。下流は堰に水を止められていて舟の通る深さにならない
  const canalRow = startRow + 9
  const canal = ditchFrom(g, canalRow, 7, 1.6, 0.6)
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()
  g.path.refresh(world.water)

  const onLand = (defId: string) => (i: number) =>
    canPlace(world, defOf(defId), i).ok && reachable(g, i)
  const room = (defId: string) => (i: number) => onLand(defId)(i) && spaced(g, i, 2)

  // 5. 船着場。蔵のそばと、運河を掘った先の田のそばに置いてつなぐ
  build(g, 'wharf', spotNear(g, (i) => canPlace(world, defOf('wharf'), i).ok && reachable(g, i)))
  const tail = canal.line[canal.line.length - 1]
  if (tail !== undefined) {
    // 運河の突き当たりの一つ先。掘っていないので陸で、運河には面している
    const dir = Math.sign(grid.xOf(tail) - grid.xOf(canal.line[0])) || 1
    for (const step of [1, 2]) {
      const i = grid.idx(grid.xOf(tail) + dir * step, canalRow)
      if (canPlace(world, defOf('wharf'), i).ok && build(g, 'wharf', i)) break
    }
  }

  // 6. 暮らしと生産（建物どうしは 1 マス空けて村らしく見えるようにする）
  for (let n = 0; n < 4; n++) build(g, 'house', spotNear(g, room('house')))
  build(g, 'storage', spotNear(g, room('storage')))
  build(g, 'dozo', spotNear(g, room('dozo')))
  build(g, 'lumberjack', spotNear(g, room('lumberjack')))
  build(g, 'sawmill', spotNear(g, room('sawmill')))
  build(g, 'mill', spotNear(g, room('mill')))

  // 7. 火の用心
  build(g, 'firetower', spotNear(g, room('firetower')))
  build(g, 'firehouse', spotNear(g, room('firehouse')))
  for (let n = 0; n < 2; n++) build(g, 'barrel', spotNear(g, room('barrel')))

  // 8. 乾いた高台に用水櫓を建て、その足元に畑を置く（灌漑で耕地が広がる様子）
  const tower = spotNear(g, (i) => world.irrigation.moisture[i] === 0 && onLand('irrigation')(i))
  if (tower >= 0) {
    build(g, 'irrigation', tower)
    for (let n = 0; n < 2; n++) {
      build(g, 'farm', spotNear(g, (i) => distance(world, i, tower) <= 4 && onLand('farm')(i)))
    }
  }
  build(
    g,
    'farm',
    spotNear(g, (i) => world.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD && onLand('farm')(i)),
  )

  // 10. 人を増やし、村らしい在庫にしてから数日回して落ち着かせる
  while (world.citizens.length < 16) world.spawnCitizen(world.startI)
  world.stock.log = 45
  world.stock.plank = 30
  world.stock.rice = 18
  world.stock.wheat = 10
  world.stock.meal = 90
  world.stock.water = 90
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) g.step()

  // 11. 水位が落ち着いてから、稲の育つ深さになっている区画にだけ田を開く。
  //     残りの窪地はため池として置いておく（防火用水になる）
  let paddies = 0
  for (const i of [...near.plots, ...canal.plots]) {
    if (paddies >= 5) break
    // 水位はこのあとも少し動くので、上下に余裕のある区画だけを田にする
    const d = world.water.depth[i]
    if (d < PADDY_MIN_DEPTH + 0.05 || d > PADDY_MAX_DEPTH - 0.25) continue
    if (!canPlace(world, defOf('paddy'), i).ok) continue
    if (build(g, 'paddy', i)) paddies++
  }

  // 12. 庄屋から離れた建物へ道を通す（陸路の荷捌きが伸びる）
  for (const b of world.buildings) {
    if (distance(world, b.i, world.startI) > 6) roadTo(g, world.startI, b.i)
  }

  // 13. 働き手を配属し直す。あとから建てた田に人が回らないため
  //     （assignJobs は職のない住民しか動かさない）
  for (const b of world.buildings) b.workers = []
  for (const c of world.citizens) {
    c.jobId = -1
    c.task = 'idle'
  }
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()

  world.stock.log = 45
  world.stock.plank = 30
  world.log = []
  world.pushLog('サンプルの村を読み込んだ')
  return g
}

function distance(world: World, a: number, b: number): number {
  const { grid } = world
  return Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b))
}

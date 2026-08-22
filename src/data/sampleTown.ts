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

/** 乾いていて空いていれば土手を積む */
function leveeAt(g: Game, i: number): void {
  const { grid, water } = g.world
  if (i < 0 || i >= grid.size) return
  if (water.depth[i] > 0.05) return // 水路の口は塞がない
  if (g.world.buildingOn(i)) return
  build(g, 'levee', i)
}

/**
 * 村をぐるりと堤防で囲う。川側は行ごとに岸を追い、あとの三方はまっすぐ引く。
 *
 * 一段しか積まないので人は越えて歩ける（段差 1 まで登れる）。用水路と運河の口は
 * 開けたままにするので、締め切りを忘れれば水は回り込む。完璧な締切堤ではなく、
 * 「守りはこう作る」という形を見せるためのもの。
 */
function leveeRing(g: Game, row: number, inland: number, halfRows: number): void {
  const { grid } = g.world
  const bank = bankOn(g, row)
  if (!bank) return
  const ya = row - halfRows
  const yb = row + halfRows
  const xIn = bank.x + bank.dir * inland

  // 川側は行ごとに岸をたどる（川は真っ直ぐではない）
  for (let y = ya; y <= yb; y++) {
    if (y < 1 || y >= grid.h - 1) continue
    const b = bankOn(g, y)
    if (b) leveeAt(g, grid.idx(b.x, y))
  }
  // 内陸側
  for (let y = ya; y <= yb; y++) {
    if (y < 1 || y >= grid.h - 1) continue
    leveeAt(g, grid.idx(xIn, y))
  }
  // 上手と下手の袖
  for (const y of [ya, yb]) {
    if (y < 1 || y >= grid.h - 1) continue
    for (let n = 0; n <= inland; n++) leveeAt(g, grid.idx(bank.x + bank.dir * n, y))
  }
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

  // 村と同じ高さから上にだけ建てる。掘割ぎわの一段低い窪地に建てると、
  // 堰の上流が満ちきったときに水を被る（読み込んだ早々に蔵の蓄えが傷む）
  const villageGround = grid.ground[world.startI]
  const onLand = (defId: string) => (i: number) =>
    grid.ground[i] >= villageGround && canPlace(world, defOf(defId), i).ok && reachable(g, i)
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
  // 蔵は二棟。荒天がひと巡りするあいだ村を食わせるには、これくらい貯めておく必要がある
  for (let n = 0; n < 2; n++) build(g, 'storage', spotNear(g, room('storage')))
  build(g, 'dozo', spotNear(g, room('dozo')))
  build(g, 'lumberjack', spotNear(g, room('lumberjack')))
  build(g, 'sawmill', spotNear(g, room('sawmill')))
  build(g, 'mill', spotNear(g, room('mill')))

  // 7. 火の用心
  build(g, 'firetower', spotNear(g, room('firetower')))
  build(g, 'firehouse', spotNear(g, room('firehouse')))
  for (let n = 0; n < 2; n++) build(g, 'barrel', spotNear(g, room('barrel')))

  // 8. 畑は二手に分けて置く。
  //    村のそばの畑は蔵に近くて手っ取り早いが、大雨のたびに麦ごと流される。
  //    段丘の上（村より二段高い）には水が来ないので、洪水のあいだ村を食わせるのはこちら。
  //    乾いた段丘は用水櫓で潤す。田は川端、畑は段丘、という置き分けが季節への備えになる。
  const high = villageGround + 2 // 一段だけだと大雨で水が乗る（実測 0.13 m）
  const onTerrace = (defId: string) => (i: number) => grid.ground[i] >= high && onLand(defId)(i)
  const tower = spotNear(g, (i) => world.irrigation.moisture[i] === 0 && onTerrace('irrigation')(i))
  if (tower >= 0) {
    build(g, 'irrigation', tower)
    for (let n = 0; n < 2; n++) {
      build(g, 'farm', spotNear(g, (i) => distance(world, i, tower) <= 5 && onTerrace('farm')(i)))
    }
  }
  for (let n = 0; n < 2; n++) {
    build(
      g,
      'farm',
      spotNear(g, (i) => world.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD && room('farm')(i)),
    )
  }

  // 9. 村をぐるりと堤防で囲う（大雨への備えの手本）
  leveeRing(g, startRow, 10, 7)

  // 10. 人を増やし、村らしい在庫にしてから数日回して落ち着かせる
  // 荒天がひと巡りするあいだ、村は蓄えだけで食いつなぐことになる。
  // 16 人は「この田畑と蔵で養える人数」として決めた
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

  // 12. 運河に橋を架ける。向こう岸の田へ、水に入らずに渡れるようにする
  // 桁は隣の歩ける面から受け継ぐので、両脇が浅く残っている所にしか架からない。
  // 運河の奥（掘った終端）から順に、架けられる所を探す
  for (let n = canal.line.length - 1; n >= 0; n--) {
    if (build(g, 'bridge', canal.line[n])) break
  }

  // 13. 庄屋から離れた建物へ道を通す（陸路の荷捌きが伸びる）
  for (const b of world.buildings) {
    if (distance(world, b.i, world.startI) > 6) roadTo(g, world.startI, b.i)
  }

  // 14. 働き手を配属し直す。あとから建てた田に人が回らないため
  //     （assignJobs は職のない住民しか動かさない）
  for (const b of world.buildings) b.workers = []
  for (const c of world.citizens) {
    c.jobId = -1
    c.task = 'idle'
  }
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()

  // 15. 季節の筋書き。読み込んで数日は平年、そのあと大雨が来て、続けて日照りになる。
  //     増水と浸水、そのあとの渇水という山と谷を続けて見られるようにしてある。
  const season = world.season
  season.kind = 'normal'
  season.prevKind = 'normal'
  season.elapsed = 0
  season.lengthDays = 3
  season.nextKind = 'rain'
  season.scripted = ['drought']

  // 蔵を満たすのは最後。先に満たすと、落ち着かせて回しているあいだに人が増えてしまう
  world.stock.log = 45
  world.stock.plank = 30
  world.stock.meal = 300
  world.stock.water = 300
  world.log = []
  world.pushLog('サンプルの村を読み込んだ')
  return g
}

function distance(world: World, a: number, b: number): number {
  const { grid } = world
  return Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b))
}

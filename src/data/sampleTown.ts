import { Game } from '../core/game'
import { World } from '../core/world'
import { canPlace, completeBuild, place } from '../sim/structures'
import { defOf } from './buildings'
import { SOIL_GROW_THRESHOLD, TICKS_PER_DAY } from './constants'

/** サンプルの町はいつも同じ地形・同じ配置になるよう、シードを固定する */
export const SAMPLE_SEED = 4242

/** 入植地に一番近い、条件を満たす列を探す */
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
function build(g: Game, defId: string, i: number) {
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

/**
 * 「もう町ができている」状態のゲームを作る。
 *
 * 川を堰き止めて貯水池を作り、水を汲み、木を挽き、湿った土で麦を育ててパンを焼く、
 * という一巡が回っているところまで進めてある。乾いた高台には用水櫓を建てて、
 * 灌漑で耕地が広がる様子も見えるようにしてある。
 */
export function createSampleGame(w = 80, h = 80): Game {
  const g = new Game({ w, h, seed: SAMPLE_SEED })
  const world = g.world
  const { grid } = world

  // 建設資材は潤沢にしておき、最後に町らしい在庫へ戻す
  world.stock.log = 9999
  world.stock.plank = 9999
  for (let t = 0; t < 120; t++) g.step()

  // 1. まず川を堰き止める（貯水池ができてから水辺の設備を置く）
  damAcross(g, grid.yOf(world.startI) + 5)
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) g.step()
  g.path.refresh(world.water)

  // 2. 水辺の設備
  for (let n = 0; n < 2; n++) {
    build(
      g,
      'pump',
      spotNear(g, (i) => canPlace(world, defOf('pump'), i).ok && reachable(g, i) && spaced(g, i, 2)),
    )
  }

  // 3. 暮らしと生産（建物どうしは 1 マス空けて村らしく見えるようにする）
  const onLand = (defId: string) => (i: number) =>
    canPlace(world, defOf(defId), i).ok && reachable(g, i)
  const room = (defId: string) => (i: number) => onLand(defId)(i) && spaced(g, i, 2)
  for (let n = 0; n < 3; n++) build(g, 'house', spotNear(g, room('house')))
  build(g, 'storage', spotNear(g, room('storage')))
  build(g, 'lumberjack', spotNear(g, room('lumberjack')))
  build(g, 'sawmill', spotNear(g, room('sawmill')))
  build(g, 'mill', spotNear(g, room('mill')))
  for (let n = 0; n < 4; n++) {
    build(
      g,
      'farm',
      spotNear(
        g,
        (i) => world.irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD && onLand('farm')(i),
      ),
    )
  }

  // 4. 乾いた高台に用水櫓を建て、その足元にも畑を作る（灌漑の効果が見える配置）
  const tower = spotNear(
    g,
    (i) => world.irrigation.moisture[i] === 0 && onLand('irrigation')(i),
  )
  if (tower >= 0) {
    build(g, 'irrigation', tower)
    for (let n = 0; n < 2; n++) {
      build(g, 'farm', spotNear(g, (i) => distance(world, i, tower) <= 4 && onLand('farm')(i)))
    }
  }

  // 5. 人を増やし、町らしい在庫にしてから数日回して落ち着かせる
  while (world.citizens.length < 14) world.spawnCitizen(world.startI)
  world.stock.log = 45
  world.stock.plank = 30
  world.stock.wheat = 12
  world.stock.meal = 70
  world.stock.water = 80
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) g.step()
  world.log = []
  world.pushLog('サンプルの町を読み込んだ')
  return g
}

function distance(world: World, a: number, b: number): number {
  const { grid } = world
  return Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b))
}

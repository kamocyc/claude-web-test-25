import { World } from '../core/world'
import type { Building } from '../core/world'
import { BuildingKind, defOf } from '../data/buildings'
import {
  EXTINGUISH_DRY_FACTOR,
  EXTINGUISH_RATE,
  FIRE_BREAK_FACTOR,
  FIRE_BURN_TICKS,
  FIRE_GROW,
  FIRE_RAIN_QUENCH,
  FIRE_SPREAD_CHANCE,
  FIRE_SPREAD_MIN,
  FIRE_SPREAD_RADIUS,
  FIRE_TICK_INTERVAL,
  FIRE_UNSEEN_TICKS,
  FIRE_WATER_DEPTH,
  FIRE_WATER_RADIUS,
  IGNITE_CHANCE_PER_DAY,
  TREE_FIRE_GROW,
  TREE_SPREAD_CHANCE,
} from '../data/constants'
import { demolish } from './structures'

/** 地形そのもの、あるいは水を張ってあるので燃えないもの */
const NON_FLAMMABLE = new Set<BuildingKind>([
  'levee', 'dam', 'floodgate', 'dig', 'road', 'bridge', 'paddy', 'farm',
])

export function canBurn(b: Building): boolean {
  const def = defOf(b.defId)
  return !def.fireproof && !NON_FLAMMABLE.has(def.kind)
}

/**
 * 火事。
 *
 * 木と紙と藁でできた村なので、火が出れば町ごと持っていかれる。備えは三つ:
 *
 *   火の見櫓   … 範囲内の火はその場で見つかる。範囲外は気づくのが遅れ、その間に燃え広がる
 *   火消し詰所 … 見つかった火へ駆けつけて消す
 *   防火用水   … 火元の近くに水路・ため池・天水桶があれば消火が 4 倍速い
 *
 * 延焼は間に水があると止まる。つまり町の中を通した水路が、そのまま火除け地になる。
 * 日照りは出火を 4 倍に増やし、大雨は火を消していく。
 */
export function updateFire(world: World): void {
  const rain = world.season.kind === 'rain'
  const burning: Building[] = []

  for (const b of world.buildings) {
    if (b.fire <= 0) continue
    if (!b.built) {
      // 建設中の骨組みが燃えたらそのまま消える
      b.fire = 0
      continue
    }
    b.fire = Math.min(1, b.fire + FIRE_GROW)
    if (rain) b.fire -= FIRE_RAIN_QUENCH
    if (b.fire <= 0) {
      quench(world, b)
      continue
    }
    b.detected = b.detected || seenFromTower(world, b.i) || ++b.fireTicks > FIRE_UNSEEN_TICKS
    burning.push(b)
  }

  // 全焼の判定（勢いが頭打ちになってから FIRE_BURN_TICKS 続くと崩れ落ちる）
  for (const b of burning) {
    if (b.fire < 1) continue
    b.burnTicks++
    if (b.burnTicks >= FIRE_BURN_TICKS) {
      world.pushLog(`${defOf(b.defId).name}が焼け落ちた`)
      demolish(world, b)
    }
  }

  advanceTreeFire(world, rain)
  if (world.tick % FIRE_TICK_INTERVAL === 0) spread(world, rain)
}

/** 火が消えたときの後始末 */
function quench(world: World, b: Building): void {
  b.fire = 0
  b.fireTicks = 0
  b.burnTicks = 0
  if (b.detected) world.pushLog(`${defOf(b.defId).name}の火は消し止められた`)
  b.detected = false
}

/** 日替わりの出火判定。火を使う建物だけが火元になる */
export function igniteDaily(world: World): void {
  const mult = world.season.igniteMult
  for (const b of world.buildings) {
    if (!b.built || b.fire > 0) continue
    const def = defOf(b.defId)
    if (!def.fireProne) continue
    // 周りが湿っていれば出にくいが、ゼロにはならない
    const dryness = 0.3 + 0.7 * (1 - world.irrigation.soilWet[b.i])
    if (world.rng.next() < IGNITE_CHANCE_PER_DAY * mult * dryness) {
      b.fire = 0.12
      b.fireTicks = 0
      b.burnTicks = 0
      b.detected = seenFromTower(world, b.i)
      world.pushLog(`${def.name}から火が出た！`)
    }
  }
}

/** 稼働中の火の見櫓から見えているか */
function seenFromTower(world: World, i: number): boolean {
  const { grid } = world
  const x = grid.xOf(i)
  const y = grid.yOf(i)
  for (const t of world.buildings) {
    if (!t.built || defOf(t.defId).kind !== 'firetower') continue
    if (t.staffPresent <= 0) continue // 番人がいなければ見張れない
    const r = defOf(t.defId).radius ?? 14
    if (Math.abs(grid.xOf(t.i) - x) <= r && Math.abs(grid.yOf(t.i) - y) <= r) return true
  }
  return false
}

/**
 * 火元の近くに消火用の水があるか。水路・ため池でも天水桶でもよい。
 * 無ければ遠くから桶で運ぶことになり、消火はぐんと遅くなる。
 */
export function fireWaterNear(world: World, i: number): boolean {
  const { grid, water } = world
  const x = grid.xOf(i)
  const y = grid.yOf(i)
  const r = FIRE_WATER_RADIUS
  for (let yy = Math.max(0, y - r); yy <= Math.min(grid.h - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(grid.w - 1, x + r); xx++) {
      if (water.depth[grid.idx(xx, yy)] >= FIRE_WATER_DEPTH) return true
    }
  }
  for (const b of world.buildings) {
    if (!b.built || defOf(b.defId).kind !== 'barrel') continue
    if (Math.abs(grid.xOf(b.i) - x) <= r && Math.abs(grid.yOf(b.i) - y) <= r) return true
  }
  return false
}

/** 火消しひとりが 1 tick で削れる火の勢い */
export function extinguishPower(world: World, i: number): number {
  return EXTINGUISH_RATE * (fireWaterNear(world, i) ? 1 : EXTINGUISH_DRY_FACTOR)
}

/** 火消しの働きを 1 tick ぶん当てる。消し止めたら true */
export function fightFire(world: World, b: Building): boolean {
  b.fire -= extinguishPower(world, b.i)
  if (b.fire > 0) return false
  quench(world, b)
  return true
}

/** 隣の建物と樹木へ燃え移る */
function spread(world: World, rain: boolean): void {
  const { grid, rng } = world
  const damp = rain ? 0.1 : 1
  const sources: { x: number; y: number; heat: number }[] = []
  for (const b of world.buildings) {
    if (b.built && b.fire >= FIRE_SPREAD_MIN) {
      sources.push({ x: grid.xOf(b.i), y: grid.yOf(b.i), heat: b.fire })
    }
  }
  for (let i = 0; i < world.treeFire.length; i++) {
    if (world.treeFire[i] >= FIRE_SPREAD_MIN) {
      sources.push({ x: grid.xOf(i), y: grid.yOf(i), heat: world.treeFire[i] })
    }
  }
  if (sources.length === 0) return

  for (const src of sources) {
    // 建物へ
    for (const t of world.buildings) {
      if (!t.built || t.fire > 0 || !canBurn(t)) continue
      const tx = grid.xOf(t.i)
      const ty = grid.yOf(t.i)
      if (Math.abs(tx - src.x) > FIRE_SPREAD_RADIUS || Math.abs(ty - src.y) > FIRE_SPREAD_RADIUS) continue
      let p = FIRE_SPREAD_CHANCE * src.heat * damp * (1 - world.irrigation.soilWet[t.i] * 0.5)
      if (waterBetween(world, src.x, src.y, tx, ty)) p *= FIRE_BREAK_FACTOR
      if (rng.next() < p) {
        t.fire = 0.1
        t.fireTicks = 0
        t.burnTicks = 0
        t.detected = seenFromTower(world, t.i)
        world.pushLog(`${defOf(t.defId).name}へ燃え移った`)
      }
    }
    // 樹木へ（火の粉が飛ぶのは隣まで）
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = src.x + dx
        const y = src.y + dy
        if (!grid.inBounds(x, y)) continue
        const i = grid.idx(x, y)
        if (!world.hasTree[i] || world.treeFire[i] > 0) continue
        const p = TREE_SPREAD_CHANCE * src.heat * damp * (1 - world.irrigation.soilWet[i] * 0.5)
        if (rng.next() < p) world.treeFire[i] = 0.1
      }
    }
  }
}

/** 燃えている木は燃え尽きて消える。消火の対象にはしない */
function advanceTreeFire(world: World, rain: boolean): void {
  const { treeFire, hasTree, treeGrowth } = world
  for (let i = 0; i < treeFire.length; i++) {
    if (treeFire[i] <= 0) continue
    if (!hasTree[i]) {
      treeFire[i] = 0
      continue
    }
    treeFire[i] += rain ? -FIRE_RAIN_QUENCH : TREE_FIRE_GROW
    if (treeFire[i] <= 0) treeFire[i] = 0
    else if (treeFire[i] >= 1.6) {
      hasTree[i] = 0
      treeGrowth[i] = 0
      treeFire[i] = 0
    }
  }
}

/**
 * 2 点のあいだに消火に足る深さの水があるか（ブレゼンハムで直線を辿る）。
 * 町の中に水路を通しておくと、ここで延焼が止まる。
 */
function waterBetween(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const { grid, water } = world
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) {
      if (water.depth[grid.idx(x, y)] >= FIRE_WATER_DEPTH) return true
    }
    if (x === x1 && y === y1) return false
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

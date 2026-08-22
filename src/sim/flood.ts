import { World } from '../core/world'
import type { Building } from '../core/world'
import { BuildingKind, ResourceKind, RESOURCES, defOf } from '../data/buildings'
import {
  FLOOD_DAMAGE_CHANCE,
  FLOOD_DAMAGE_DEPTH,
  FLOOD_LEFTOVER,
  FLOOD_ROAD_DEPTH,
  FLOOD_ROAD_WASH_CHANCE,
  FLOOD_SPOIL_RATE,
  FLOOD_STOP_DEPTH,
} from '../data/constants'

/**
 * 水に浸かっても困らないもの。
 *
 * 水を張って使うもの（水田）、地形そのもの（土手・堰・水門・堀割・道）、
 * もともと水に足を突っ込んで建てるもの（踏車・放水樋・船着場）。
 */
const NON_FLOODABLE = new Set<BuildingKind>([
  'paddy',
  'levee',
  'dam',
  'floodgate',
  'dig',
  'road',
  'pump',
  'dump',
  'wharf',
])

/** その建物が浸水の被害を受けるか */
export function canFlood(b: Building): boolean {
  const def = defOf(b.defId)
  return !def.floodproof && !NON_FLOODABLE.has(def.kind)
}

/** 床上まで水が来ていて働けない */
export function isSwamped(world: World, b: Building): boolean {
  return canFlood(b) && world.water.depth[b.i] >= FLOOD_STOP_DEPTH
}

/**
 * 浸水の被害。
 *
 * 深さで段階が分かれる。浅い浸水は不便なだけ、深い浸水は損害になる。
 *
 *   0.35 以上 … 建物が働けない（`isSwamped`。水が引けばそのまま戻る）
 *   0.35 以上 … 蔵の蓄えが日ごとに傷む
 *   0.50 以上 … 建物が日ごとに一定の確率で傷む（深いほど当たりやすい）
 *   0.30 以上 … 道が流される
 *
 * 守りは土手（水を止める）・水門（雨の前に開けて水位を下げる）・堀割（逃がす）・
 * 段丘に建てること。前触れが残り 2 日で出るので、備える猶予はある。
 */
export function floodDamage(world: World): void {
  spoilStock(world)
  damageBuildings(world)
  washRoads(world)
}

/** 浸かった蔵の蓄えが傷む。土蔵は高い基礎と漆喰で無事 */
function spoilStock(world: World): void {
  let flooded = 0
  let total = 0
  for (const b of world.buildings) {
    const def = defOf(b.defId)
    if (!b.built || !def.storage) continue
    total += def.storage
    if (!def.floodproof && world.water.depth[b.i] >= FLOOD_STOP_DEPTH) flooded += def.storage
  }
  if (flooded <= 0 || total <= 0) return

  // 浸かった蔵の割合だけ傷む
  const lost = FLOOD_SPOIL_RATE * (flooded / total)
  let any = 0
  for (const k of RESOURCES as readonly ResourceKind[]) {
    const drop = world.stock[k] * lost
    world.stock[k] -= drop
    any += drop
  }
  if (any > 0.5) world.pushLog('蔵が浸かって蓄えが傷んだ')
}

/**
 * 深く浸かった建物が傷む。全部が一斉に壊れないよう、日ごとの確率で判定する。
 * 庄屋は村の種なので傷まない（ここが壊れると立て直しようがなくなる）。
 */
function damageBuildings(world: World): void {
  for (const b of world.buildings) {
    const def = defOf(b.defId)
    if (!b.built || b.damaged || !canFlood(b) || def.kind === 'district') continue
    const depth = world.water.depth[b.i]
    if (depth < FLOOD_DAMAGE_DEPTH) continue
    if (world.rng.next() >= FLOOD_DAMAGE_CHANCE * Math.min(1, depth)) continue

    // 建設の仕組みをそのまま使う。住民が建設要員として直しに来る（材木は要らない）
    b.built = false
    b.damaged = true
    b.buildProgress = Math.floor(def.buildPoints * FLOOD_LEFTOVER)
    b.progress = 0
    b.status = '浸水で傷んだ'
    b.workers = []
    for (const c of world.citizens) if (c.jobId === b.id) c.jobId = -1
    world.pushLog(`${def.name}が水に傷んだ`)
  }
}

/** 水に浸かった道は流される */
function washRoads(world: World): void {
  const { grid, water, rng } = world
  for (let i = 0; i < grid.size; i++) {
    if (!grid.road[i] || water.depth[i] < FLOOD_ROAD_DEPTH) continue
    if (rng.next() < FLOOD_ROAD_WASH_CHANCE) grid.road[i] = 0
  }
}

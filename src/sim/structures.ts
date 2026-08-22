import { World } from '../core/world'
import type { Building } from '../core/world'
import { BuildingDef, defOf } from '../data/buildings'
import {
  BOAT_MIN_DEPTH,
  DAM_RESIST,
  FLOODGATE_MAX_HEIGHT,
  MAX_Z,
  PADDY_MAX_DEPTH,
  PUMP_MIN_DEPTH,
} from '../data/constants'

export interface PlaceCheck {
  ok: boolean
  reason?: string
}

/** その列に水利/地形構造物を建てられるか */
export function canPlace(world: World, def: BuildingDef, i: number): PlaceCheck {
  const { grid, water } = world
  if (i < 0 || i >= grid.size) return { ok: false, reason: '範囲外' }
  const existing = world.buildingOn(i)
  if (existing) {
    // 土手は積み上げられる
    if (def.kind === 'levee' && defOf(existing.defId).kind === 'levee' && existing.built) {
      if (grid.ground[i] + 1 >= MAX_Z) return { ok: false, reason: 'これ以上高くできない' }
      return { ok: true }
    }
    return { ok: false, reason: 'すでに建物がある' }
  }
  switch (def.placement) {
    case 'land':
      if (water.depth[i] > 0.3) return { ok: false, reason: '水中には建てられない' }
      break
    case 'shallowWater':
      // 水田は水を張った土地に置く。深いところには置けない
      if (water.depth[i] > PADDY_MAX_DEPTH) return { ok: false, reason: '水が深すぎる' }
      break
    case 'nearBoatWater': {
      // 船着場は舟の通れる深さの水に面していること
      let deep = false
      grid.forEachNeighbor(i, (n) => {
        if (water.depth[n] >= BOAT_MIN_DEPTH) deep = true
      })
      if (water.depth[i] > 0.3) return { ok: false, reason: '水中には建てられない' }
      if (!deep) return { ok: false, reason: '隣に舟の通れる水路が必要' }
      break
    }
    case 'nearWater': {
      let near = false
      grid.forEachNeighbor(i, (n) => {
        if (water.depth[n] >= PUMP_MIN_DEPTH) near = true
      })
      if (water.depth[i] > 0.3) return { ok: false, reason: '水中には建てられない' }
      if (!near) return { ok: false, reason: '隣に十分な深さの水が必要' }
      break
    }
    case 'anyTerrain':
      break
  }
  if (def.kind === 'dig' && grid.natural[i] <= 0) return { ok: false, reason: 'これ以上掘れない' }
  if (def.kind === 'road' && grid.road[i]) return { ok: false, reason: 'すでに道がある' }
  if (def.kind !== 'dig' && grid.ground[i] + 1 >= MAX_Z) return { ok: false, reason: '高すぎる' }
  if (!world.hasStock(def.cost)) return { ok: false, reason: '資材が足りない' }
  return { ok: true }
}

/** 建設サイトを置く（資材はここで引き当てる）。既存の土手なら段を積み増す。 */
export function place(world: World, def: BuildingDef, i: number): Building | null {
  const check = canPlace(world, def, i)
  if (!check.ok) return null
  if (!world.takeStock(def.cost)) return null

  const existing = world.buildingOn(i)
  if (existing && def.kind === 'levee') {
    existing.pending += 1
    existing.built = false
    existing.buildProgress = 0
    existing.status = '建設中'
    return existing
  }
  const b = world.createBuilding(def, i, false)
  if (def.kind === 'levee' || def.kind === 'dig') b.pending = 1
  if (def.buildPoints === 0) completeBuild(world, b)
  return b
}

/** 建設完了時に地形・水系へ反映する */
export function completeBuild(world: World, b: Building): void {
  const def = defOf(b.defId)
  const { grid } = world
  b.built = true
  b.buildProgress = def.buildPoints
  b.status = ''
  switch (def.kind) {
    case 'levee': {
      b.stack += b.pending
      b.pending = 0
      grid.levee[b.i] = b.stack
      grid.refreshGround(b.i)
      displaceWater(world, b.i)
      break
    }
    case 'dam': {
      grid.barrier[b.i] = 1
      grid.flowResist[b.i] = DAM_RESIST
      displaceWater(world, b.i)
      break
    }
    case 'floodgate': {
      grid.barrier[b.i] = b.gateHeight
      grid.flowResist[b.i] = DAM_RESIST
      displaceWater(world, b.i)
      break
    }
    case 'road': {
      // 道は地形の属性。建設枠を潰さないよう、完成したら建物としては消す
      grid.road[b.i] = 1
      world.removeBuilding(b)
      break
    }
    case 'dig': {
      const n = Math.min(b.pending, grid.natural[b.i])
      grid.natural[b.i] -= n
      grid.refreshGround(b.i)
      world.removeBuilding(b)
      break
    }
    default:
      break
  }
}

/** 水門の堰高を変更する */
export function setGateHeight(world: World, b: Building, height: number): void {
  const def = defOf(b.defId)
  if (def.kind !== 'floodgate') return
  b.gateHeight = Math.max(0, Math.min(FLOODGATE_MAX_HEIGHT, Math.round(height)))
  if (b.built) {
    world.grid.barrier[b.i] = b.gateHeight
    displaceWater(world, b.i)
  }
}

/**
 * 河床が上がった列に残っている水を隣へ押し出す（総水量は保存する）。
 * 溜め切れなかった分は最後に一番低い隣へまとめて渡す。
 */
export function displaceWater(world: World, i: number): void {
  const { grid, water } = world
  const cap = grid.ceiling[i] - grid.bed(i)
  let excess = water.depth[i] - Math.max(0, cap)
  if (excess <= 0) return
  water.depth[i] -= excess

  const neighbors: number[] = []
  grid.forEachNeighbor(i, (n) => neighbors.push(n))
  neighbors.sort((a, c) => water.surface(a) - water.surface(c))
  for (const n of neighbors) {
    if (excess <= 0) break
    const room = grid.ceiling[n] - grid.bed(n) - water.depth[n]
    if (room <= 0) continue
    const give = Math.min(room, excess)
    water.depth[n] += give
    excess -= give
  }
  if (excess > 0 && neighbors.length > 0) water.depth[neighbors[0]] += excess
}

/** 建物を撤去する。地形への影響も元に戻す。 */
export function demolish(world: World, b: Building): void {
  const def = defOf(b.defId)
  const { grid } = world
  switch (def.kind) {
    case 'dam':
    case 'floodgate':
      grid.barrier[b.i] = 0
      grid.flowResist[b.i] = 0
      break
    case 'levee':
      grid.levee[b.i] = 0
      grid.refreshGround(b.i)
      break
    default:
      break
  }
  world.removeBuilding(b)
}

/** 踏車の取水口（隣接する最も深い水の列）。無ければ -1 */
export function intakeOf(world: World, i: number): number {
  const { grid, water } = world
  let best = -1
  let bestDepth = PUMP_MIN_DEPTH
  grid.forEachNeighbor(i, (n) => {
    if (water.depth[n] > bestDepth) {
      bestDepth = water.depth[n]
      best = n
    }
  })
  return best
}

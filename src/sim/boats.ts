import { World } from '../core/world'
import { BOAT_MIN_DEPTH, WHARF_RADIUS } from '../data/constants'
import { Logistics, WharfInfo } from './logistics'

/**
 * 舟の航路。荷を積む船着場から、蔵のそばの船着場までの水路。
 *
 * 荷そのものは物流（Logistics）が数として捌いていて、この航路は「いま何が
 * どこへ流れているか」を目に見せるためのもの。舟が沈んだり遅れたりはしない。
 */
export interface BoatRoute {
  /** 荷を積む船着場（蔵から遠いほう）の建物 id */
  fromId: number
  /** 蔵のそばの船着場の建物 id */
  toId: number
  /** 通り道になる水路の列。from 側から to 側へ並ぶ */
  path: number[]
  /** その船着場が集めている荷（多いほど舟を増やす） */
  cargo: number
}

/**
 * いま舟が行き来している航路を洗い出す。
 *
 * 水路ごとに「いちばん蔵に近い船着場」を荷揚げ場とし、同じ水路の残りの船着場から
 * そこへ航路を引く。蔵まで歩けない水路には舟を出さない（荷の行き先が無い）。
 */
export function boatRoutes(world: World, logistics: Logistics): BoatRoute[] {
  const wharves = logistics.wharves()
  const out: BoatRoute[] = []
  for (const w of wharves) {
    const home = homeOf(wharves, w.comp)
    if (!home || home.id === w.id) continue
    const found = navigate(world, w.i, [home.i])
    if (!found) continue
    out.push({ fromId: w.id, toId: home.id, path: found.path, cargo: cargoAt(world, w.i) })
  }
  return out
}

/** その水路の荷揚げ場。蔵のそばにある船着場のうち、いちばん蔵に近いもの */
function homeOf(wharves: readonly WharfInfo[], comp: number): WharfInfo | null {
  let best: WharfInfo | null = null
  for (const w of wharves) {
    if (w.comp !== comp || !w.hub) continue
    // 同じ近さなら若い方（毎回同じ航路になるように）
    if (!best || w.landCost < best.landCost || (w.landCost === best.landCost && w.id < best.id)) best = w
  }
  return best
}

/** 舟が通れる水路を幅優先で辿り、いちばん近いハブまでの道を返す */
function navigate(world: World, fromI: number, goalIs: number[]): { path: number[] } | null {
  const { grid, water } = world
  const navigable = (i: number): boolean => water.depth[i] >= BOAT_MIN_DEPTH
  // ハブ船着場に横付けできる水面（そこへ着けば荷が下りる）
  const goals = new Set<number>()
  for (const g of goalIs) {
    grid.forEachNeighbor(g, (n) => {
      if (navigable(n)) goals.add(n)
    })
  }
  if (goals.size === 0) return null

  const prev = new Int32Array(grid.size).fill(-2) // -2 = 未訪問、-1 = 出発点
  const queue: number[] = []
  grid.forEachNeighbor(fromI, (n) => {
    if (navigable(n) && prev[n] === -2) {
      prev[n] = -1
      queue.push(n)
    }
  })
  let end = -1
  for (let qi = 0; qi < queue.length && end < 0; qi++) {
    const i = queue[qi]
    if (goals.has(i)) {
      end = i
      break
    }
    grid.forEachNeighbor(i, (n) => {
      if (navigable(n) && prev[n] === -2) {
        prev[n] = i
        queue.push(n)
      }
    })
  }
  if (end < 0) return null

  const path: number[] = []
  for (let i = end; i !== -1; i = prev[i]) path.push(i)
  path.reverse()
  return { path }
}

/**
 * その船着場が集めている荷の量。
 *
 * 集荷範囲に荷置き場が待っている建物があれば、その荷はこの船着場から舟に載る
 * （範囲に入っている時点で、物流はその建物を舟運として数えている）。
 */
function cargoAt(world: World, wharfI: number): number {
  const { grid } = world
  const wx = grid.xOf(wharfI)
  const wy = grid.yOf(wharfI)
  let sum = 0
  for (const b of world.buildings) {
    if (!b.built || b.load <= 0) continue
    if (Math.abs(grid.xOf(b.i) - wx) > WHARF_RADIUS || Math.abs(grid.yOf(b.i) - wy) > WHARF_RADIUS) continue
    sum += b.load
  }
  return sum
}

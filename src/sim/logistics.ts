import { World } from '../core/world'
import { defOf } from '../data/buildings'
import {
  BOAT_MIN_DEPTH,
  LAND_FAR,
  LAND_NEAR,
  ROAD_COST,
  ROUTE_RATE,
  WHARF_RADIUS,
} from '../data/constants'
import { PathFinder } from './pathfinding'

/** 荷の運び方。舟運が段違いに太く、道の無い遠方は人が背負うしかない */
export type RouteKind = 'boat' | 'near' | 'cart' | 'foot'

/** 船着場と、それが面している水路。舟の絵を描くのにも使う */
export interface WharfInfo {
  id: number
  i: number
  /** 面している水路の連結成分 */
  comp: number
  /** 蔵のそばか（荷の行き先になる船着場） */
  hub: boolean
  /** 蔵までの陸路コスト（-1 = 遠すぎる）。いちばん蔵に近い船着場を選ぶのに使う */
  landCost: number
}

export const ROUTE_LABEL: Record<RouteKind, string> = {
  boat: '舟運',
  near: '村の中',
  cart: '大八車',
  foot: '人が背負う',
}

// 陸路のコストは 1 マス 5 で数える（道は 2）。整数にしておくとバケット法が使える。
const COST_SCALE = 5
const COST_PLAIN = COST_SCALE
const COST_ROAD = ROAD_COST * COST_SCALE
const NEAR_COST = LAND_NEAR * COST_SCALE
const FAR_COST = LAND_FAR * COST_SCALE

/**
 * 物流。
 *
 * 生産物はいったん建物の荷置き場に積まれ、蔵へは「1 日に運べる量」の分しか流れない。
 * 運べる量は蔵までの道のりで決まる。
 *
 *   村の中（蔵まで陸路 12 マス以内） … 困らない
 *   大八車（〜30 マス）             … 細る
 *   人が背負う（それ以遠）          … ほとんど運べない
 *   舟運                            … 距離にほぼ依らず太い
 *
 * 道を敷くと 1 マスを 0.4 マスとして数えるので「村の中」の範囲が伸びる。
 * 舟運は、集荷範囲に船着場があり、その船着場の水路が蔵のそばの船着場と
 * つながっているときに使える。水深 BOAT_MIN_DEPTH 以上の列が舟の通り道になるので、
 * 堀割で運河を掘り、堰で水位を保つことがそのまま物流網の整備になる。
 */
export class Logistics {
  /** 蔵からの陸路コスト（-1 = 遠すぎるか道がない） */
  private readonly landCost: Int32Array
  /** 舟が通れる水域の連結成分（-1 = 通れない） */
  private readonly comp: Int32Array
  /** 建物 id → 経路の種類 */
  private readonly route = new Map<number, RouteKind>()
  /** 水路に面している船着場（描画側が舟の航路を引くのに使う） */
  private wharfList: WharfInfo[] = []
  private readonly buckets: number[][] = []

  constructor(size: number) {
    this.landCost = new Int32Array(size).fill(-1)
    this.comp = new Int32Array(size).fill(-1)
  }

  routeOf(buildingId: number): RouteKind {
    return this.route.get(buildingId) ?? 'foot'
  }
  /** 1 日に運べる量 */
  rateOf(buildingId: number): number {
    return ROUTE_RATE[this.routeOf(buildingId)]
  }
  /** 舟が入れる水に面している船着場 */
  wharves(): readonly WharfInfo[] {
    return this.wharfList
  }

  /** 数十 tick に 1 回だけ回せばよい */
  recompute(world: World, path: PathFinder): void {
    this.spreadFromStorage(world, path)
    this.labelWaterways(world)
    this.classify(world, path)
  }

  /** 蔵と庄屋を始点に、歩ける列を重み付きダイクストラで塗る（道は安い） */
  private spreadFromStorage(world: World, path: PathFinder): void {
    const { grid } = world
    const { landCost, buckets } = this
    landCost.fill(-1)
    buckets.length = FAR_COST + 1
    for (let b = 0; b <= FAR_COST; b++) buckets[b] = buckets[b] ? ((buckets[b].length = 0), buckets[b]) : []

    const push = (i: number, cost: number) => {
      if (cost > FAR_COST) return
      if (landCost[i] >= 0 && landCost[i] <= cost) return
      landCost[i] = cost
      buckets[cost].push(i)
    }
    for (const b of world.buildings) {
      if (!b.built || !defOf(b.defId).storage) continue
      for (const t of path.approachTiles(b.i)) push(t, 0)
    }
    for (let c = 0; c <= FAR_COST; c++) {
      const bucket = buckets[c]
      for (let qi = 0; qi < bucket.length; qi++) {
        const i = bucket[qi]
        if (landCost[i] !== c) continue // あとでより安い値が入った
        grid.forEachNeighbor(i, (n) => {
          if (!path.canStep(i, n)) return
          push(n, c + (grid.road[n] ? COST_ROAD : COST_PLAIN))
        })
      }
    }
  }

  /** 舟が通れる水域を連結成分に分ける */
  private labelWaterways(world: World): void {
    const { grid, water } = world
    const { comp } = this
    comp.fill(-1)
    const queue: number[] = []
    let next = 0
    for (let s = 0; s < grid.size; s++) {
      if (comp[s] >= 0 || water.depth[s] < BOAT_MIN_DEPTH) continue
      const id = next++
      comp[s] = id
      queue.length = 0
      queue.push(s)
      for (let qi = 0; qi < queue.length; qi++) {
        const i = queue[qi]
        grid.forEachNeighbor(i, (n) => {
          if (comp[n] >= 0 || water.depth[n] < BOAT_MIN_DEPTH) return
          comp[n] = id
          queue.push(n)
        })
      }
    }
  }

  /** 建物から蔵までの陸路コスト。建物の列自体が歩けないこともあるので隣も見る */
  private costOf(i: number, path: PathFinder): number {
    let best = -1
    for (const t of path.approachTiles(i)) {
      const c = this.landCost[t]
      if (c >= 0 && (best < 0 || c < best)) best = c
    }
    return best
  }

  /** 建物ごとに経路の種類を決める */
  private classify(world: World, path: PathFinder): void {
    const { grid } = world
    const { comp, route } = this
    route.clear()

    // 船着場を拾い、蔵のそばにあるものの水路成分を「蔵まで舟で行ける水路」とする
    const wharves: WharfInfo[] = []
    const hubs = new Set<number>()
    for (const b of world.buildings) {
      if (!b.built || defOf(b.defId).kind !== 'wharf') continue
      let c = comp[b.i]
      grid.forEachNeighbor(b.i, (n) => {
        if (c < 0) c = comp[n]
      })
      if (c < 0) continue // 舟が入れる深さの水に接していない
      const lc = this.costOf(b.i, path)
      const hub = lc >= 0 && lc <= NEAR_COST
      wharves.push({ id: b.id, i: b.i, comp: c, hub, landCost: lc })
      if (hub) hubs.add(c)
    }
    this.wharfList = wharves

    for (const b of world.buildings) {
      if (!b.built) continue
      let best: RouteKind = 'foot'
      const lc = this.costOf(b.i, path)
      if (lc >= 0 && lc <= NEAR_COST) best = 'near'
      else if (lc >= 0 && lc <= FAR_COST) best = 'cart'

      const bx = grid.xOf(b.i)
      const by = grid.yOf(b.i)
      for (const wf of wharves) {
        if (!hubs.has(wf.comp)) continue
        if (Math.abs(grid.xOf(wf.i) - bx) > WHARF_RADIUS || Math.abs(grid.yOf(wf.i) - by) > WHARF_RADIUS) continue
        if (ROUTE_RATE.boat > ROUTE_RATE[best]) best = 'boat'
        break
      }
      route.set(b.id, best)
    }
  }
}

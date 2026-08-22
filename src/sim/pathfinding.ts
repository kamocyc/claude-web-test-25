import { Grid } from '../core/grid'
import { MAX_STEP, WADE_COST_MAX, WADE_FREE_DEPTH, WALKABLE_MAX_DEPTH } from '../data/constants'
import { WaterSim } from './water'

/** 二分ヒープ（優先度付きキュー） */
class Heap {
  private items: number[] = []
  private keys: number[] = []
  get size(): number {
    return this.items.length
  }
  clear(): void {
    this.items.length = 0
    this.keys.length = 0
  }
  push(item: number, key: number): void {
    const { items, keys } = this
    items.push(item)
    keys.push(key)
    let c = items.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (keys[p] <= keys[c]) break
      ;[items[p], items[c]] = [items[c], items[p]]
      ;[keys[p], keys[c]] = [keys[c], keys[p]]
      c = p
    }
  }
  pop(): number {
    const { items, keys } = this
    const top = items[0]
    const lastI = items.pop() as number
    const lastK = keys.pop() as number
    if (items.length > 0) {
      items[0] = lastI
      keys[0] = lastK
      let p = 0
      for (;;) {
        const l = p * 2 + 1
        const r = l + 1
        let m = p
        if (l < items.length && keys[l] < keys[m]) m = l
        if (r < items.length && keys[r] < keys[m]) m = r
        if (m === p) break
        ;[items[p], items[m]] = [items[m], items[p]]
        ;[keys[p], keys[m]] = [keys[m], keys[p]]
        p = m
      }
    }
    return top
  }
}

/**
/**
 * 水の中の歩きにくさ。乾いた地面を 1 として、深いほど時間がかかる。
 *
 * くるぶし程度（WADE_FREE_DEPTH）までは変わらず、歩ける限界の深さで
 * WADE_COST_MAX 倍になる。経路探索の重みと歩く速さの両方に効くので、
 * 住民は浅瀬や橋を選んで回り道するようになる。
 */
export function wadeCost(depth: number): number {
  if (depth <= WADE_FREE_DEPTH) return 1
  const t = Math.min(1, (depth - WADE_FREE_DEPTH) / (WALKABLE_MAX_DEPTH - WADE_FREE_DEPTH))
  return 1 + (WADE_COST_MAX - 1) * t
}

/**
 * 歩行面グラフ上の経路探索。
 *
 * 歩けるのは水が浅い列で、隣へは段差 MAX_STEP まで登れる。段差 2 以上を越えたいときは
 * 土手を階段状に積んでテラスを作る（Timberborn の縦方向建築）。
 *
 * 歩く高さは ground + barrier なので、**完成した堰の上は歩ける**。おかげで川の
 * 真ん中に堰を架けるときは岸から 1 マスずつ延ばしていくことになり、本家と同じ
 * 「堰は岸から継ぎ足して伸ばす」進み方になる。橋も同じで、桁の高さは繋いだ岸から
 * 受け継ぐ（structures.ts の deckHeightFor）。
 *
 * 1 マスの重みは一定ではなく、水の深さで増える（wadeCost）。深い水を突っ切るより
 * 岸を回るほうが速い、という判断がそのまま経路に出る。
 */
export class PathFinder {
  readonly grid: Grid
  readonly walkable: Uint8Array
  /** その列を 1 マス進むのにかかる時間の倍率（乾いた地面 = 1） */
  readonly cost: Float64Array
  private readonly dist: Float64Array
  private readonly came: Int32Array
  private readonly visitMark: Int32Array
  private mark = 0
  private readonly heap = new Heap()

  constructor(grid: Grid) {
    this.grid = grid
    this.walkable = new Uint8Array(grid.size)
    this.cost = new Float64Array(grid.size).fill(1)
    this.dist = new Float64Array(grid.size)
    this.came = new Int32Array(grid.size)
    this.visitMark = new Int32Array(grid.size)
  }

  refresh(water: WaterSim): void {
    const { grid, walkable, cost } = this
    for (let i = 0; i < grid.size; i++) {
      const d = this.wetness(water, i)
      walkable[i] = d <= WALKABLE_MAX_DEPTH ? 1 : 0
      cost[i] = wadeCost(d)
    }
  }

  /** 歩く面がどれだけ水を被っているか。橋の上は桁を越えた分だけ */
  private wetness(water: WaterSim, i: number): number {
    const deck = this.grid.deck[i]
    if (deck <= 0) return water.depth[i]
    return Math.max(0, water.surface(i) - deck)
  }

  /** 立つ高さ（堰の上にも橋の上にも乗れる） */
  top(i: number): number {
    return this.grid.walkTop(i)
  }

  /** その列を 1 マス進むのにかかる時間の倍率 */
  costAt(i: number): number {
    return this.cost[i] || 1
  }

  canStep(a: number, b: number): boolean {
    if (!this.walkable[b]) return false
    const d = this.top(b) - this.top(a)
    return d <= MAX_STEP && d >= -MAX_STEP - 2 // 落ちるのは 3 段まで許す
  }

  /** start から goals のいずれかへの最短経路（列番号の配列、start を含まない） */
  findAny(start: number, goals: readonly number[]): number[] | null {
    if (goals.length === 0) return null
    const goalSet = new Set(goals)
    if (goalSet.has(start)) return []
    const { grid, dist, came, visitMark, heap } = this
    // 出発点が水没しても脱出できるよう、start 自体の歩行可否は問わない
    this.mark++
    heap.clear()
    dist[start] = 0
    came[start] = -1
    visitMark[start] = this.mark
    heap.push(start, 0)
    while (heap.size > 0) {
      const cur = heap.pop()
      if (goalSet.has(cur)) return this.rebuild(cur)
      const d = dist[cur]
      const x = grid.xOf(cur)
      const y = grid.yOf(cur)
      const step = (n: number) => {
        if (!this.canStep(cur, n)) return
        // 深い水は遠回りより高くつく。ここが橋を架ける動機になる
        const nd = d + this.cost[n]
        if (visitMark[n] === this.mark && dist[n] <= nd) return
        visitMark[n] = this.mark
        dist[n] = nd
        came[n] = cur
        heap.push(n, nd)
      }
      if (x > 0) step(cur - 1)
      if (x < grid.w - 1) step(cur + 1)
      if (y > 0) step(cur - grid.w)
      if (y < grid.h - 1) step(cur + grid.w)
    }
    return null
  }

  find(start: number, goal: number): number[] | null {
    return this.findAny(start, [goal])
  }

  private rebuild(goal: number): number[] {
    const path: number[] = []
    let cur = goal
    while (cur !== -1 && this.came[cur] !== -1) {
      path.push(cur)
      cur = this.came[cur]
    }
    path.reverse()
    return path
  }

  /** 目標に隣接する（または目標自身の）歩ける列の一覧 */
  approachTiles(target: number): number[] {
    const out: number[] = []
    if (this.walkable[target]) out.push(target)
    this.grid.forEachNeighbor(target, (n) => {
      if (this.walkable[n]) out.push(n)
    })
    return out
  }
}

import { Grid } from '../core/grid'
import { MAX_STEP, WALKABLE_MAX_DEPTH } from '../data/constants'
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
 * 歩行面グラフ上の経路探索。
 *
 * 歩けるのは水が浅い列で、隣へは段差 MAX_STEP まで登れる。段差 2 以上を越えたいときは
 * 土手を階段状に積んでテラスを作る（Timberborn の縦方向建築）。
 *
 * 歩く高さは ground + barrier なので、**完成した堰の上は歩ける**。おかげで川の
 * 真ん中に堰を架けるときは岸から 1 マスずつ延ばしていくことになり、本家と同じ
 * 「堰は岸から継ぎ足して伸ばす」進み方になる。
 */
export class PathFinder {
  readonly grid: Grid
  readonly walkable: Uint8Array
  private readonly dist: Float64Array
  private readonly came: Int32Array
  private readonly visitMark: Int32Array
  private mark = 0
  private readonly heap = new Heap()

  constructor(grid: Grid) {
    this.grid = grid
    this.walkable = new Uint8Array(grid.size)
    this.dist = new Float64Array(grid.size)
    this.came = new Int32Array(grid.size)
    this.visitMark = new Int32Array(grid.size)
  }

  refresh(water: WaterSim): void {
    const { grid, walkable } = this
    for (let i = 0; i < grid.size; i++) {
      walkable[i] = water.depth[i] <= WALKABLE_MAX_DEPTH ? 1 : 0
    }
  }

  /** 立つ高さ（堰の上に乗れる） */
  top(i: number): number {
    return this.grid.ground[i] + this.grid.barrier[i]
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
        const nd = d + 1
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

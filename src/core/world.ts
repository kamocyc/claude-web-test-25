import { Grid } from './grid'
import { Rng } from './rng'
import { WaterSim } from '../sim/water'
import { Irrigation } from '../sim/irrigation'
import { Season } from '../sim/season'
import { BuildingDef, ResourceKind, Stock, defOf, emptyStock } from '../data/buildings'
import { JOB_PRIORITY_NORMAL } from '../data/constants'

export interface Building {
  id: number
  defId: string
  /** 列番号 */
  i: number
  built: boolean
  /** 建設作業の進捗 */
  buildProgress: number
  /** 生産の進捗 */
  progress: number
  /** この tick に出勤していた労働者数 */
  staffPresent: number
  /** 割り当てられた住民 id */
  workers: number[]
  /** 働き手を回す優先度。0 = 低 / 1 = 並 / 2 = 高。遊ぶ側が建物ごとに決める */
  priority: number
  /** 水門の堰高 */
  gateHeight: number
  /** 完成済みの積み上げ数（土手）*/
  stack: number
  /** 建設待ちの追加段数（土手・掘削）*/
  pending: number
  /** 橋の桁の高さ（0 = 橋ではない） */
  deck: number
  /** 浸水で傷んでいる（建て直しではなく修理待ち） */
  damaged: boolean
  /** 火の勢い 0..1（0 = 燃えていない） */
  fire: number
  /** 出火してから発見されるまでの経過 tick */
  fireTicks: number
  /** 勢いが頭打ちになってからの経過 tick。焼け落ちるまでの猶予 */
  burnTicks: number
  /** 火事が村に知られているか。火の見櫓があれば即座に知れる */
  detected: boolean
  /** 蔵へまだ運べていない荷 */
  load: number
  /** 荷の種類（空なら荷なし） */
  loadKind: ResourceKind | ''
  /** この tick に実際に稼働したか */
  active: boolean
  /** 直近の稼働状況（UI 表示用） */
  status: string
}

export interface CitizenNeeds {
  water: number
  food: number
  sleep: number
}

export type TaskKind = 'idle' | 'drink' | 'eat' | 'sleep' | 'work' | 'build' | 'fight'

export interface Citizen {
  id: number
  name: string
  /** 現在いる列 */
  i: number
  /** 補間用のワールド座標（列中心） */
  x: number
  y: number
  px: number
  py: number
  needs: CitizenNeeds
  starveTicks: number
  /** 尽きている需要（力尽きた理由になる）。'' = 足りている */
  starveKind: '' | 'water' | 'food'
  jobId: number
  task: TaskKind
  taskTarget: number
  path: number[] | null
  pathPos: number
  actionTicks: number
}

export interface WaterSource {
  i: number
  strength: number
}

const FIRST_NAMES = [
  'アヤ', 'ケン', 'ミオ', 'ソウ', 'リン', 'ハル', 'ナギ', 'ユウ', 'トウ', 'サキ',
  'コウ', 'マイ', 'レン', 'ノア', 'イオ', 'シン', 'ミク', 'タク', 'エマ', 'ジン',
]

export class World {
  readonly grid: Grid
  readonly water: WaterSim
  readonly irrigation: Irrigation
  readonly season = new Season()
  readonly rng: Rng

  tick = 0
  stock: Stock = emptyStock()
  buildings: Building[] = []
  /** 列 → 建物 id（-1 = なし） */
  readonly buildingAt: Int32Array
  nextBuildingId = 1

  /** 樹木 */
  readonly hasTree: Uint8Array
  readonly treeGrowth: Float64Array
  readonly treeDry: Float64Array
  /** 立ち枯れ（1 = 枯れ木）。もう育たないが、伐れば丸太は取れる */
  readonly treeDead: Uint8Array
  /** 燃えている木の勢い */
  readonly treeFire: Float64Array

  citizens: Citizen[] = []
  nextCitizenId = 1

  sources: WaterSource[] = []
  startI = 0
  /** 直近の出来事（UI のログ） */
  log: string[] = []
  /**
   * 蔵の水・食べ物が尽きたことを既に告げたか。
   * 涸れているあいだ言い続けないための一時の目印なので、セーブには入れない。
   */
  warned = { water: false, food: false }

  constructor(grid: Grid, seed: number) {
    this.grid = grid
    this.rng = new Rng(seed)
    this.water = new WaterSim(grid)
    this.irrigation = new Irrigation(grid)
    this.buildingAt = new Int32Array(grid.size).fill(-1)
    this.hasTree = new Uint8Array(grid.size)
    this.treeGrowth = new Float64Array(grid.size)
    this.treeDry = new Float64Array(grid.size)
    this.treeDead = new Uint8Array(grid.size)
    this.treeFire = new Float64Array(grid.size)
  }

  // --- 在庫 ---------------------------------------------------------------
  get capacity(): number {
    let cap = 0
    for (const b of this.buildings) {
      if (!b.built) continue
      const def = defOf(b.defId)
      if (def.storage) cap += def.storage
    }
    return cap
  }
  addStock(kind: ResourceKind, amount: number): number {
    const cap = this.capacity
    const room = Math.max(0, cap - this.stock[kind])
    const put = Math.min(room, amount)
    this.stock[kind] += put
    return put
  }
  hasStock(need: Partial<Stock>): boolean {
    for (const k of Object.keys(need) as ResourceKind[]) {
      if (this.stock[k] < (need[k] ?? 0)) return false
    }
    return true
  }
  takeStock(need: Partial<Stock>): boolean {
    if (!this.hasStock(need)) return false
    for (const k of Object.keys(need) as ResourceKind[]) this.stock[k] -= need[k] ?? 0
    return true
  }

  // --- 建物 ---------------------------------------------------------------
  createBuilding(def: BuildingDef, i: number, built: boolean): Building {
    const b: Building = {
      id: this.nextBuildingId++,
      defId: def.id,
      i,
      built,
      buildProgress: built ? def.buildPoints : 0,
      progress: 0,
      staffPresent: 0,
      workers: [],
      priority: JOB_PRIORITY_NORMAL,
      gateHeight: def.kind === 'floodgate' ? 3 : 0,
      stack: 0,
      pending: 0,
      deck: 0,
      load: 0,
      loadKind: '',
      damaged: false,
      fire: 0,
      fireTicks: 0,
      burnTicks: 0,
      detected: false,
      active: false,
      status: built ? '' : '建設中',
    }
    this.buildings.push(b)
    this.buildingAt[i] = b.id
    return b
  }
  buildingById(id: number): Building | undefined {
    return this.buildings.find((b) => b.id === id)
  }
  buildingOn(i: number): Building | undefined {
    const id = this.buildingAt[i]
    return id < 0 ? undefined : this.buildingById(id)
  }
  removeBuilding(b: Building): void {
    this.buildingAt[b.i] = -1
    this.buildings = this.buildings.filter((x) => x !== b)
    for (const c of this.citizens) if (c.jobId === b.id) c.jobId = -1
  }

  // --- 住民 ---------------------------------------------------------------
  spawnCitizen(i: number): Citizen {
    const id = this.nextCitizenId++
    const c: Citizen = {
      id,
      name: FIRST_NAMES[id % FIRST_NAMES.length] + (id > FIRST_NAMES.length ? String(Math.floor(id / FIRST_NAMES.length)) : ''),
      i,
      x: this.grid.xOf(i) + 0.5,
      y: this.grid.yOf(i) + 0.5,
      px: this.grid.xOf(i) + 0.5,
      py: this.grid.yOf(i) + 0.5,
      needs: { water: 1, food: 1, sleep: 1 },
      starveTicks: 0,
      starveKind: '',
      jobId: -1,
      task: 'idle',
      taskTarget: -1,
      path: null,
      pathPos: 0,
      actionTicks: 0,
    }
    this.citizens.push(c)
    return c
  }

  get housing(): number {
    let n = 0
    for (const b of this.buildings) {
      if (!b.built) continue
      const def = defOf(b.defId)
      if (def.housing) n += def.housing
    }
    return n
  }

  pushLog(msg: string): void {
    this.log.push(msg)
    if (this.log.length > 30) this.log.shift()
  }
}

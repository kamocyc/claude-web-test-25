export const RESOURCES = ['water', 'log', 'plank', 'wheat', 'bread'] as const
export type ResourceKind = (typeof RESOURCES)[number]
export type Stock = Record<ResourceKind, number>

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  water: '水',
  log: '丸太',
  plank: '板材',
  wheat: '小麦',
  bread: 'パン',
}

export function emptyStock(): Stock {
  return { water: 0, log: 0, plank: 0, wheat: 0, bread: 0 }
}

export type BuildingKind =
  | 'district'
  | 'house'
  | 'pump'
  | 'dump'
  | 'irrigation'
  | 'lumberjack'
  | 'sawmill'
  | 'farm'
  | 'bakery'
  | 'storage'
  | 'levee'
  | 'dam'
  | 'floodgate'
  | 'dig'

export type Placement = 'land' | 'nearWater' | 'anyTerrain'

export interface BuildingDef {
  id: string
  name: string
  desc: string
  kind: BuildingKind
  category: 'water' | 'terrain' | 'living' | 'industry'
  cost: Partial<Stock>
  /** 建設に必要な作業 tick */
  buildPoints: number
  workers: number
  housing?: number
  storage?: number
  recipe?: { in?: Partial<Stock>; out: Partial<Stock>; ticks: number }
  /** 働き手を配属する優先度（大きいほど先に埋まる）。生きるのに要る仕事を優先する。 */
  jobPriority?: number
  radius?: number
  /** 描画用 */
  color: number
  height: number
  placement: Placement
}

export const BUILDINGS: readonly BuildingDef[] = [
  {
    id: 'district',
    name: '地区センター',
    desc: '開始地点。共有在庫と 3 人分の寝床、住民のスポーン地点になる。',
    kind: 'district',
    category: 'living',
    cost: {},
    buildPoints: 0,
    workers: 0,
    storage: 80,
    housing: 3,
    color: 0xd9a441,
    height: 1.6,
    placement: 'land',
  },
  {
    id: 'house',
    name: '住居',
    desc: '住民 4 人が眠れる。人口上限を増やす。',
    kind: 'house',
    category: 'living',
    cost: { log: 6 },
    buildPoints: 120,
    workers: 0,
    housing: 4,
    color: 0xc8825a,
    height: 1.3,
    placement: 'land',
  },
  {
    id: 'storage',
    name: '倉庫',
    desc: '共有在庫の容量を増やす。',
    kind: 'storage',
    category: 'living',
    cost: { log: 4, plank: 2 },
    buildPoints: 100,
    workers: 0,
    storage: 80,
    color: 0xa98d63,
    height: 1.1,
    placement: 'land',
  },
  {
    id: 'pump',
    name: '揚水ポンプ',
    desc: '隣接する水深 0.5 以上の水から水を汲み上げる。集落の生命線。',
    kind: 'pump',
    category: 'water',
    cost: { log: 4 },
    buildPoints: 90,
    workers: 1,
    jobPriority: 10,
    recipe: { out: { water: 4 }, ticks: 20 },
    color: 0x5aa9c8,
    height: 1.4,
    placement: 'nearWater',
  },
  {
    id: 'dump',
    name: '放水設備',
    desc: '備蓄した水を地形に戻す。貯水池の補給や遠方の灌漑に使う。',
    kind: 'dump',
    category: 'water',
    cost: { log: 3, plank: 2 },
    buildPoints: 90,
    workers: 1,
    jobPriority: 3,
    recipe: { in: { water: 2 }, out: {}, ticks: 40 },
    color: 0x3f7f9c,
    height: 1.2,
    placement: 'anyTerrain',
  },
  {
    id: 'irrigation',
    name: '灌漑塔',
    desc: '水を消費して周囲 8 マスに湿り気を供給する。乾季の生命線。',
    kind: 'irrigation',
    category: 'water',
    cost: { log: 4, plank: 4 },
    buildPoints: 160,
    workers: 1,
    jobPriority: 9,
    radius: 8,
    recipe: { in: { water: 1 }, out: {}, ticks: 30 },
    color: 0x7fc4d8,
    height: 2.2,
    placement: 'land',
  },
  {
    id: 'lumberjack',
    name: '伐採小屋',
    desc: '周囲の育った木を伐って丸太にする。跡地には苗が育つ。',
    kind: 'lumberjack',
    category: 'industry',
    cost: { log: 3 },
    buildPoints: 80,
    workers: 2,
    jobPriority: 5,
    radius: 8,
    recipe: { out: { log: 2 }, ticks: 50 },
    color: 0x6f8f4a,
    height: 1.2,
    placement: 'land',
  },
  {
    id: 'sawmill',
    name: '製材所',
    desc: '丸太を板材に加工する。',
    kind: 'sawmill',
    category: 'industry',
    cost: { log: 6 },
    buildPoints: 120,
    workers: 2,
    jobPriority: 4,
    recipe: { in: { log: 2 }, out: { plank: 1 }, ticks: 45 },
    color: 0x8a6b45,
    height: 1.4,
    placement: 'land',
  },
  {
    id: 'farm',
    name: '農地',
    desc: '湿った土でのみ小麦が育つ。乾くと枯れる。',
    kind: 'farm',
    category: 'industry',
    cost: { log: 1 },
    buildPoints: 40,
    workers: 1,
    jobPriority: 8,
    recipe: { out: { wheat: 3 }, ticks: 90 },
    color: 0xbfa76a,
    height: 0.35,
    placement: 'land',
  },
  {
    id: 'bakery',
    name: 'パン屋',
    desc: '小麦と水からパンを焼く。',
    kind: 'bakery',
    category: 'industry',
    cost: { log: 4, plank: 3 },
    buildPoints: 130,
    workers: 2,
    jobPriority: 7,
    recipe: { in: { wheat: 2, water: 1 }, out: { bread: 3 }, ticks: 60 },
    color: 0xd8b46a,
    height: 1.4,
    placement: 'land',
  },
  {
    id: 'levee',
    name: '堤防',
    desc: '水を完全にせき止める。積み上げれば高い壁になる。',
    kind: 'levee',
    category: 'terrain',
    cost: { log: 2 },
    buildPoints: 30,
    workers: 0,
    color: 0x9a9a90,
    height: 1,
    placement: 'anyTerrain',
  },
  {
    id: 'dam',
    name: 'ダム',
    desc: '高さ 1 まで水をせき止め、超えた分は越流する。貯水の基本。',
    kind: 'dam',
    category: 'terrain',
    cost: { log: 3 },
    buildPoints: 40,
    workers: 0,
    color: 0x8f7f6a,
    height: 1,
    placement: 'anyTerrain',
  },
  {
    id: 'floodgate',
    name: '水門',
    desc: '堰の高さを 0〜3 で調整できる。乾季前の水位管理に使う。',
    kind: 'floodgate',
    category: 'terrain',
    cost: { log: 4, plank: 2 },
    buildPoints: 70,
    workers: 0,
    color: 0x6b6b78,
    height: 3,
    placement: 'anyTerrain',
  },
  {
    id: 'dig',
    name: '掘削',
    desc: '地形を 1 段掘り下げる。水路を通したり水を導いたりできる。',
    kind: 'dig',
    category: 'terrain',
    cost: {},
    buildPoints: 40,
    workers: 0,
    color: 0x7b6a55,
    height: 0,
    placement: 'anyTerrain',
  },
]

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]))

export function defOf(id: string): BuildingDef {
  const d = BUILDING_BY_ID.get(id)
  if (!d) throw new Error(`unknown building: ${id}`)
  return d
}

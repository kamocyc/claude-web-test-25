export const RESOURCES = ['water', 'log', 'plank', 'rice', 'meal', 'wheat'] as const
export type ResourceKind = (typeof RESOURCES)[number]
export type Stock = Record<ResourceKind, number>

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  water: '水',
  log: '丸太',
  plank: '板材',
  rice: '籾',
  meal: '米',
  wheat: '麦',
}

export function emptyStock(): Stock {
  return { water: 0, log: 0, plank: 0, rice: 0, meal: 0, wheat: 0 }
}

export type BuildingKind =
  | 'district'
  | 'house'
  | 'pump'
  | 'dump'
  | 'irrigation'
  | 'lumberjack'
  | 'sawmill'
  | 'paddy'
  | 'farm'
  | 'mill'
  | 'storage'
  | 'dozo'
  | 'wharf'
  | 'firetower'
  | 'firehouse'
  | 'barrel'
  | 'road'
  | 'bridge'
  | 'levee'
  | 'dam'
  | 'floodgate'
  | 'dig'

export type Placement = 'land' | 'shallowWater' | 'nearWater' | 'nearBoatWater' | 'anyTerrain'

export interface BuildingDef {
  id: string
  name: string
  desc: string
  kind: BuildingKind
  category: 'water' | 'terrain' | 'living' | 'safety' | 'industry'
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
  /** 竈や炉を使うので、ここから火が出る */
  fireProne?: boolean
  /** 土壁で囲われていて燃えない */
  fireproof?: boolean
  /** 高い基礎と漆喰で水に強い */
  floodproof?: boolean
  /** 描画用 */
  color: number
  height: number
  placement: Placement
}

export const BUILDINGS: readonly BuildingDef[] = [
  {
    id: 'district',
    name: '庄屋',
    desc: '村の始まり。共有の蔵と 3 人分の寝床を兼ね、ここから人が育つ。',
    kind: 'district',
    category: 'living',
    cost: {},
    buildPoints: 0,
    workers: 0,
    storage: 80,
    housing: 3,
    fireProne: true,
    color: 0xd9a441,
    height: 1.6,
    placement: 'land',
  },
  {
    id: 'house',
    name: '民家',
    desc: '茅葺の家。4 人が眠れる。人口の上限を増やす。',
    kind: 'house',
    category: 'living',
    cost: { log: 6 },
    buildPoints: 120,
    workers: 0,
    housing: 4,
    fireProne: true,
    color: 0xc8825a,
    height: 1.3,
    placement: 'land',
  },
  {
    id: 'storage',
    name: '蔵',
    desc: '村の蓄えを増やす。',
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
    name: '踏車',
    desc: '足で踏んで水を汲み上げる。隣に水深 0.5 以上の水がいる。村の生命線。',
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
    name: '放水樋',
    desc: '蓄えた水を地面に戻す。ため池の補給や、遠くの田へ水を送るのに使う。',
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
    name: '用水櫓',
    desc: '水を汲み上げて周囲 8 マスの土を潤す。日照りの畑を守る。',
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
    id: 'wharf',
    name: '船着場',
    desc: '舟で荷を運ぶ桟橋。水深 0.8 以上の水路に面していること。蔵のそばの船着場と水路がつながっていれば、周囲 8 マスの荷が一気に捌ける。',
    kind: 'wharf',
    category: 'water',
    cost: { log: 5, plank: 3 },
    buildPoints: 140,
    workers: 1,
    jobPriority: 6,
    radius: 8,
    color: 0x8a6f4c,
    height: 0.9,
    placement: 'nearBoatWater',
  },
  {
    id: 'lumberjack',
    name: '杣小屋',
    desc: '周りの育った木を伐って丸太にする。枯れ木があれば先に片づける。跡地にはどちらも苗が残る。',
    kind: 'lumberjack',
    category: 'industry',
    cost: { log: 3 },
    buildPoints: 80,
    workers: 2,
    jobPriority: 5,
    radius: 8,
    recipe: { out: { log: 2 }, ticks: 50 },
    fireProne: true,
    color: 0x6f8f4a,
    height: 1.2,
    placement: 'land',
  },
  {
    id: 'sawmill',
    name: '木挽小屋',
    desc: '丸太を挽いて板材にする。',
    kind: 'sawmill',
    category: 'industry',
    cost: { log: 6 },
    buildPoints: 120,
    workers: 2,
    jobPriority: 4,
    recipe: { in: { log: 2 }, out: { plank: 1 }, ticks: 45 },
    fireProne: true,
    color: 0x8a6b45,
    height: 1.4,
    placement: 'land',
  },
  {
    id: 'paddy',
    name: '水田',
    desc: '稲を育てる。水深 0.05〜1.0 の湛水がいる。水が涸れれば枯れ、深く浸かれば止まる。',
    kind: 'paddy',
    category: 'industry',
    cost: { log: 1 },
    buildPoints: 50,
    workers: 1,
    jobPriority: 8,
    recipe: { out: { rice: 4 }, ticks: 90 },
    color: 0x7fa86a,
    height: 0.3,
    placement: 'shallowWater',
  },
  {
    id: 'farm',
    name: '畑',
    desc: '湿った土で麦が育つ。湛水はいらないので、日照りの備えになる。',
    kind: 'farm',
    category: 'industry',
    cost: { log: 1 },
    buildPoints: 40,
    workers: 1,
    jobPriority: 6,
    recipe: { out: { wheat: 3 }, ticks: 90 },
    color: 0xbfa76a,
    height: 0.35,
    placement: 'land',
  },
  {
    id: 'mill',
    name: '精米所',
    desc: '水車で籾を搗いて米にする。米は村の主食。',
    kind: 'mill',
    category: 'industry',
    cost: { log: 4, plank: 3 },
    buildPoints: 130,
    workers: 2,
    jobPriority: 7,
    recipe: { in: { rice: 2, water: 1 }, out: { meal: 3 }, ticks: 60 },
    fireProne: true,
    color: 0xd8b46a,
    height: 1.4,
    placement: 'land',
  },
  {
    id: 'firetower',
    name: '火の見櫓',
    desc: '半鐘を吊るした物見櫓。番人がいれば周囲 14 マスの火事をその場で見つけられる。範囲の外は気づくのが遅れ、その間に燃え広がる。',
    kind: 'firetower',
    category: 'safety',
    cost: { log: 8, plank: 2 },
    buildPoints: 150,
    workers: 1,
    jobPriority: 9,
    radius: 14,
    color: 0x8b6f4a,
    height: 3.2,
    placement: 'land',
  },
  {
    id: 'firehouse',
    name: '火消し詰所',
    desc: '町火消しが詰める小屋。見つかった火事へ駆けつけて消し止める。火元の近くに水があれば消火は 4 倍速い。',
    kind: 'firehouse',
    category: 'safety',
    cost: { log: 6, plank: 4 },
    buildPoints: 160,
    workers: 3,
    jobPriority: 9,
    color: 0xa85a48,
    height: 1.3,
    placement: 'land',
  },
  {
    id: 'barrel',
    name: '天水桶',
    desc: '軒先に据える防火用水。周囲 6 マスの火事で使える。水路の通らない町なかに置く。',
    kind: 'barrel',
    category: 'safety',
    cost: { plank: 2 },
    buildPoints: 25,
    workers: 0,
    fireproof: true,
    color: 0x5f7a86,
    height: 0.5,
    placement: 'land',
  },
  {
    id: 'dozo',
    name: '土蔵',
    desc: 'なまこ壁の蔵。値は張るが火に強く、燃え移らない。大事な蓄えはここへ。',
    kind: 'dozo',
    category: 'living',
    cost: { log: 6, plank: 8 },
    buildPoints: 200,
    workers: 0,
    storage: 80,
    fireproof: true,
    floodproof: true,
    color: 0xd8d4c8,
    height: 1.4,
    placement: 'land',
  },
  {
    id: 'levee',
    name: '土手',
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
    name: '堰',
    desc: '高さ 1 まで水をせき止め、超えた分は越していく。水を溜める基本。',
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
    desc: '堰の高さを 0〜3 で加減できる。日照りに備えて水位を操る。',
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
    id: 'road',
    name: '道',
    desc: '荷車の通る道。敷いた列は 1 マスを 0.4 マスとして数えるので、蔵から遠い建物まで荷が捌けるようになる。',
    kind: 'road',
    category: 'terrain',
    cost: {},
    buildPoints: 20,
    workers: 0,
    color: 0xa89878,
    height: 0,
    placement: 'land',
  },
  {
    id: 'bridge',
    name: '橋',
    desc: '水の上に桁を渡す。上は乾いた地面と同じ速さで歩ける。水は下を流れるので、川の流れも水位も変えない。岸（または架けた橋）の隣から一マスずつ継ぎ足して伸ばす。',
    kind: 'bridge',
    category: 'terrain',
    cost: { log: 2, plank: 1 },
    buildPoints: 60,
    workers: 0,
    floodproof: true,
    color: 0x9a7b52,
    height: 0.4,
    placement: 'anyTerrain',
  },
  {
    id: 'dig',
    name: '堀割',
    desc: '地面を 1 段掘り下げる。田へ水を引き、深く掘れば舟の通る運河になる。',
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

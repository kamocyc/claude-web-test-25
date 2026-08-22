import { World } from '../core/world'
import type { Building, Citizen } from '../core/world'
import { emptyStock, Stock } from '../data/buildings'
import { SEASON_KINDS, SeasonKind } from '../sim/season'
import { SEVERE_SCALE_DEFAULT } from '../data/constants'

function seasonKind(v: string): SeasonKind {
  return (SEASON_KINDS as readonly string[]).includes(v) ? (v as SeasonKind) : 'normal'
}

const VERSION = 3
const KEY = 'satoyama.save.v3'

interface SaveData {
  version: number
  w: number
  h: number
  tick: number
  stock: Stock
  rng: number
  season: {
    kind: string
    prevKind: string
    nextKind: string | null
    lengthDays: number
    elapsed: number
    day: number
    dayTick: number
    cycle: number
    /** 旧いセーブにしかない（大雨と日照りに分ける前の共通の倍率） */
    severeScale?: number
    rainScale: number
    droughtScale: number
    scripted: string[]
  }
  natural: number[]
  levee: number[]
  barrier: number[]
  ceiling: number[]
  flowResist: number[]
  isDrain: number[]
  road: number[]
  deck: number[]
  depth: number[]
  fluxX: number[]
  fluxY: number[]
  soilWet: number[]
  hasTree: number[]
  treeGrowth: number[]
  treeDry: number[]
  treeFire: number[]
  sources: { i: number; strength: number }[]
  startI: number
  buildings: Building[]
  citizens: Citizen[]
  nextBuildingId: number
  nextCitizenId: number
  log: string[]
}

// 数値は丸めずにそのまま出す。乾いた列は 0 なので JSON は十分小さく収まり、
// 読み込み後も 1 tick 単位で同じ結果になる（＝セーブを跨いでも決定的）。

export function serialize(world: World): string {
  const { grid, water, irrigation, season } = world
  const data: SaveData = {
    version: VERSION,
    w: grid.w,
    h: grid.h,
    tick: world.tick,
    stock: { ...world.stock },
    rng: world.rng.state,
    season: {
      kind: season.kind,
      prevKind: season.prevKind,
      nextKind: season.nextKind,
      lengthDays: season.lengthDays,
      elapsed: season.elapsed,
      day: season.day,
      dayTick: season.dayTick,
      cycle: season.cycle,
      rainScale: season.rainScale,
      droughtScale: season.droughtScale,
      scripted: [...season.scripted],
    },
    natural: Array.from(grid.natural),
    levee: Array.from(grid.levee),
    barrier: Array.from(grid.barrier),
    ceiling: Array.from(grid.ceiling),
    flowResist: Array.from(grid.flowResist),
    isDrain: Array.from(grid.isDrain),
    road: Array.from(grid.road),
    deck: Array.from(grid.deck),
    depth: Array.from(water.depth),
    fluxX: Array.from(water.fluxX),
    fluxY: Array.from(water.fluxY),
    soilWet: Array.from(irrigation.soilWet),
    hasTree: Array.from(world.hasTree),
    treeGrowth: Array.from(world.treeGrowth),
    treeDry: Array.from(world.treeDry),
    treeFire: Array.from(world.treeFire),
    sources: world.sources.map((s) => ({ ...s })),
    startI: world.startI,
    buildings: world.buildings.map((b) => ({ ...b, workers: [...b.workers] })),
    citizens: world.citizens.map((c) => ({ ...c, needs: { ...c.needs }, path: null })),
    nextBuildingId: world.nextBuildingId,
    nextCitizenId: world.nextCitizenId,
    log: world.log.slice(-10),
  }
  return JSON.stringify(data)
}

/** 既存の World に読み込む（描画側のメッシュを作り直さずに済む） */
export function deserializeInto(world: World, json: string): boolean {
  const data = JSON.parse(json) as SaveData
  if (data.version !== VERSION) return false
  const { grid } = world
  if (data.w !== grid.w || data.h !== grid.h) return false

  grid.natural.set(data.natural)
  grid.levee.set(data.levee)
  grid.barrier.set(data.barrier)
  grid.ceiling.set(data.ceiling)
  grid.flowResist.set(data.flowResist)
  grid.isDrain.set(data.isDrain)
  grid.road.set(data.road ?? [])
  grid.deck.set(data.deck ?? [])
  grid.refreshAllGround()

  world.water.depth.set(data.depth)
  world.water.fluxX.set(data.fluxX)
  world.water.fluxY.set(data.fluxY)
  world.irrigation.soilWet.set(data.soilWet)
  world.hasTree.set(data.hasTree)
  world.treeGrowth.set(data.treeGrowth)
  world.treeDry.set(data.treeDry)
  world.treeFire.set(data.treeFire ?? [])

  world.tick = data.tick
  world.stock = { ...emptyStock(), ...data.stock }
  world.rng.state = data.rng
  world.season.kind = seasonKind(data.season.kind)
  world.season.prevKind = seasonKind(data.season.prevKind)
  world.season.nextKind = data.season.nextKind === null ? null : seasonKind(data.season.nextKind)
  world.season.lengthDays = data.season.lengthDays
  world.season.elapsed = data.season.elapsed
  world.season.day = data.season.day
  world.season.dayTick = data.season.dayTick
  world.season.cycle = data.season.cycle
  const oldScale = data.season.severeScale ?? SEVERE_SCALE_DEFAULT
  world.season.rainScale = data.season.rainScale ?? oldScale
  world.season.droughtScale = data.season.droughtScale ?? oldScale
  world.season.scripted = (data.season.scripted ?? []).map(seasonKind)
  world.sources = data.sources
  world.startI = data.startI
  world.buildings = data.buildings
  // 古いセーブには理由が入っていない
  world.citizens = data.citizens.map((c) => ({ ...c, starveKind: c.starveKind ?? '' }))
  world.nextBuildingId = data.nextBuildingId
  world.nextCitizenId = data.nextCitizenId
  world.log = data.log

  world.buildingAt.fill(-1)
  for (const b of world.buildings) world.buildingAt[b.i] = b.id
  world.irrigation.recompute(world.water, [])
  return true
}

export function saveToStorage(world: World): void {
  try {
    localStorage.setItem(KEY, serialize(world))
  } catch {
    world.pushLog('セーブに失敗した（保存領域が足りない）')
  }
}

export function loadFromStorage(world: World): boolean {
  const json = localStorage.getItem(KEY)
  if (!json) return false
  try {
    return deserializeInto(world, json)
  } catch {
    return false
  }
}

export function hasStorageSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

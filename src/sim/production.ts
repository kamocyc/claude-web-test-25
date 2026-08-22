import { World } from '../core/world'
import type { Building } from '../core/world'
import { ResourceKind, defOf } from '../data/buildings'
import {
  CROP_GROW_TICKS,
  DUMP_ADD_PER_UNIT,
  FLOOD_CROP_DEPTH,
  FLOOD_TREE_DEPTH,
  LOAD_CAP,
  PADDY_MAX_DEPTH,
  PADDY_MIN_DEPTH,
  PLANT_DIE_TICKS,
  PUMP_DRAW_PER_UNIT,
  SOIL_GROW_THRESHOLD,
  TICKS_PER_DAY,
  TREE_GROW_TICKS,
} from '../data/constants'
import { MoistureSource } from './irrigation'
import { intakeOf } from './structures'
import { Logistics } from './logistics'
import { isSwamped } from './flood'

const VEG_INTERVAL = 10

/** 建物の生産を 1 tick 進め、用水櫓などの湿り気供給源を返す。 */
export function updateProduction(world: World): MoistureSource[] {
  const moisture: MoistureSource[] = []
  for (const b of world.buildings) {
    b.active = false
    if (!b.built) continue
    const def = defOf(b.defId)
    const recipe = def.recipe
    if (!recipe) continue

    const rate = def.workers === 0 ? 1 : b.staffPresent
    if (rate <= 0) {
      b.status = '労働者がいない'
      continue
    }

    // --- 稼働条件（建物ごと） ---
    if (isSwamped(world, b)) {
      b.status = '床上まで水が来ている'
      continue
    }
    let intake = -1
    if (def.kind === 'pump') {
      intake = intakeOf(world, b.i)
      if (intake < 0) {
        b.status = '取水できる水がない'
        continue
      }
    }
    if (def.kind === 'farm') {
      // 畑の麦は水に弱い。冠水すると育ちかけの作物ごと流される（稲は水田で耐える）
      if (world.water.depth[b.i] >= FLOOD_CROP_DEPTH) {
        b.status = '水に浸かった'
        b.progress = 0
        continue
      }
      if (world.irrigation.soilWet[b.i] < SOIL_GROW_THRESHOLD) {
        b.status = '土が乾いている'
        // 乾くと育ちかけの作物は萎れていく
        b.progress = Math.max(0, b.progress - 0.5)
        continue
      }
    }
    if (def.kind === 'paddy') {
      // 稲は湛水で育つ。土壌水分は見ない。季節にも依らず、水位だけが効く。
      const depth = world.water.depth[b.i]
      if (depth < PADDY_MIN_DEPTH) {
        b.status = '田の水が涸れた'
        b.progress = Math.max(0, b.progress - 0.5)
        continue
      }
      if (depth > PADDY_MAX_DEPTH) {
        // 深く浸かっても稲は枯れない。水が引けば続きから育つ
        b.status = '水に浸かっている'
        continue
      }
    }
    if (def.kind === 'lumberjack' && nearestTree(world, b) < 0) {
      b.status = '育った木がない'
      continue
    }
    if (recipe.in && !world.hasStock(recipe.in)) {
      b.status = '材料待ち'
      continue
    }
    const outs = Object.keys(recipe.out) as ResourceKind[]
    if (outs.length > 0 && b.load >= LOAD_CAP) {
      // 荷置き場が一杯。蔵が満杯なのか、運び出せないのかで言い分けると原因が分かる
      b.status = outs.every((k) => world.stock[k] >= world.capacity) ? '蔵が満杯' : '荷が捌けない'
      continue
    }

    b.active = true
    b.status = '稼働中'
    const crop = def.kind === 'farm' || def.kind === 'paddy'
    b.progress += crop ? (rate * CROP_GROW_TICKS) / recipe.ticks : rate
    const goal = crop ? CROP_GROW_TICKS : recipe.ticks
    if (b.progress < goal) {
      if (def.kind === 'irrigation') moisture.push({ i: b.i, strength: def.radius ?? 8 })
      continue
    }
    b.progress = 0
    if (recipe.in) world.takeStock(recipe.in)
    // 出来高はいったん建物の荷置き場へ。蔵へ流れるのは運べる量だけ（logistics.ts）
    for (const k of outs) {
      b.load += recipe.out[k] ?? 0
      b.loadKind = k
    }

    // --- 完成時の副作用 ---
    switch (def.kind) {
      case 'pump':
        world.water.drawWater(intake, PUMP_DRAW_PER_UNIT * (recipe.out.water ?? 0))
        break
      case 'dump':
        world.water.addWater(b.i, DUMP_ADD_PER_UNIT * (recipe.in?.water ?? 0))
        break
      case 'lumberjack': {
        const t = nearestTree(world, b)
        if (t >= 0) {
          world.hasTree[t] = 1
          world.treeGrowth[t] = 0 // 伐った跡には苗を残す
          world.treeDry[t] = 0
          world.treeDead[t] = 0 // 枯れ木を片づけた跡にも、生きた苗が残る
        }
        break
      }
      default:
        break
    }
    if (def.kind === 'irrigation') moisture.push({ i: b.i, strength: def.radius ?? 8 })
  }
  return moisture
}

/**
 * 伐採小屋の範囲内で伐れる木。枯れ木を先に片づけ、無ければ最も近い成木を伐る。
 *
 * 枯れ木はもう太らないので、置いておくだけ山が塞がる。先に片づければ跡地に苗が残り、
 * 大雨や日照りにやられた山が立ち直っていく。
 */
function nearestTree(world: World, b: Building): number {
  const def = defOf(b.defId)
  const r = def.radius ?? 6
  const { grid } = world
  const bx = grid.xOf(b.i)
  const by = grid.yOf(b.i)
  let best = -1
  let bestD = Infinity
  let bestDead = 0
  for (let y = Math.max(0, by - r); y <= Math.min(grid.h - 1, by + r); y++) {
    for (let x = Math.max(0, bx - r); x <= Math.min(grid.w - 1, bx + r); x++) {
      const i = grid.idx(x, y)
      if (!world.hasTree[i] || world.treeGrowth[i] < 1) continue
      const dead = world.treeDead[i]
      const d = (x - bx) ** 2 + (y - by) ** 2
      if (dead === bestDead ? d < bestD : dead > bestDead) {
        bestD = d
        bestDead = dead
        best = i
      }
    }
  }
  return best
}

/**
 * いま水のせいで働けない職場か。
 *
 * 沈んだ建物、水の引いた田、水を被った畑。ここに人を配属したままにすると、
 * 大雨のあいだ村じゅうの手が使いものにならない職場に張り付いて飢える。
 */
export function idleByWater(world: World, b: Building): boolean {
  const def = defOf(b.defId)
  if (isSwamped(world, b)) return true
  const depth = world.water.depth[b.i]
  if (def.kind === 'paddy') return depth < PADDY_MIN_DEPTH || depth > PADDY_MAX_DEPTH
  if (def.kind === 'farm') return depth >= FLOOD_CROP_DEPTH
  return false
}

/** 樹木の成長と枯死（重いので数 tick に 1 回だけ回す） */
export function updateVegetation(world: World): void {
  if (world.tick % VEG_INTERVAL !== 0) return
  const { hasTree, treeGrowth, treeDry, treeDead, irrigation } = world
  for (let i = 0; i < hasTree.length; i++) {
    if (!hasTree[i]) continue
    // 枯れ木は立ったまま残る。もう育たず、これ以上枯れようもない
    if (treeDead[i]) continue
    // 乾いても、水に浸かりすぎても木は弱る（treeDry は「痛め付けられている時間」）
    const drowning = world.water.depth[i] >= FLOOD_TREE_DEPTH
    if (!drowning && irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD) {
      treeDry[i] = 0
      if (treeGrowth[i] < 1) treeGrowth[i] = Math.min(1, treeGrowth[i] + VEG_INTERVAL / TREE_GROW_TICKS)
    } else {
      treeDry[i] += VEG_INTERVAL
      if (treeDry[i] > PLANT_DIE_TICKS) {
        treeDry[i] = 0
        if (treeGrowth[i] >= 1) {
          // 育ち切った木は立ち枯れる。消えてなくなりはせず、伐れば丸太が取れる
          treeDead[i] = 1
        } else {
          // まだ細い若木は枯れて消えるだけ。伐り出すものは残らない。
          // ここで枯れ木にすると、日照りのあいだ「苗を植える→枯れる→伐る」で
          // 丸太が無尽蔵に湧いてしまう（枯れるほうが育つより速いため）
          hasTree[i] = 0
          treeGrowth[i] = 0
        }
      }
    }
  }
}

/**
 * 荷置き場から蔵へ荷を流す。1 tick に流せるのは「1 日に運べる量」の 1/240。
 * 蔵が満杯なら荷はその場に残る（addStock が入った分だけを返す）。
 */
export function moveLoads(world: World, logistics: Logistics): void {
  for (const b of world.buildings) {
    if (!b.built || b.load <= 0 || b.loadKind === '') continue
    const per = logistics.rateOf(b.id) / TICKS_PER_DAY
    const put = world.addStock(b.loadKind, Math.min(b.load, per))
    b.load -= put
    if (b.load <= 1e-9) {
      b.load = 0
      b.loadKind = ''
    }
  }
}

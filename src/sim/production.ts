import { World } from '../core/world'
import type { Building } from '../core/world'
import { ResourceKind, defOf } from '../data/buildings'
import {
  CROP_GROW_TICKS,
  DUMP_ADD_PER_UNIT,
  PLANT_DIE_TICKS,
  PUMP_DRAW_PER_UNIT,
  SOIL_GROW_THRESHOLD,
  TREE_GROW_TICKS,
} from '../data/constants'
import { MoistureSource } from './irrigation'
import { intakeOf } from './structures'

const VEG_INTERVAL = 10

/** 建物の生産を 1 tick 進め、灌漑塔などの湿り気供給源を返す。 */
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
    let intake = -1
    if (def.kind === 'pump') {
      intake = intakeOf(world, b.i)
      if (intake < 0) {
        b.status = '取水できる水がない'
        continue
      }
    }
    if (def.kind === 'farm') {
      if (world.irrigation.soilWet[b.i] < SOIL_GROW_THRESHOLD) {
        b.status = '土が乾いている'
        // 乾くと育ちかけの作物は萎れていく
        b.progress = Math.max(0, b.progress - 0.5)
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
    if (outs.length > 0 && outs.every((k) => world.stock[k] >= world.capacity)) {
      b.status = '在庫が満杯'
      continue
    }

    b.active = true
    b.status = '稼働中'
    b.progress += def.kind === 'farm' ? (rate * CROP_GROW_TICKS) / recipe.ticks : rate
    const goal = def.kind === 'farm' ? CROP_GROW_TICKS : recipe.ticks
    if (b.progress < goal) {
      if (def.kind === 'irrigation') moisture.push({ i: b.i, strength: def.radius ?? 8 })
      continue
    }
    b.progress = 0
    if (recipe.in) world.takeStock(recipe.in)
    for (const k of outs) world.addStock(k, recipe.out[k] ?? 0)

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

/** 伐採小屋の範囲内で最も近い成木 */
function nearestTree(world: World, b: Building): number {
  const def = defOf(b.defId)
  const r = def.radius ?? 6
  const { grid } = world
  const bx = grid.xOf(b.i)
  const by = grid.yOf(b.i)
  let best = -1
  let bestD = Infinity
  for (let y = Math.max(0, by - r); y <= Math.min(grid.h - 1, by + r); y++) {
    for (let x = Math.max(0, bx - r); x <= Math.min(grid.w - 1, bx + r); x++) {
      const i = grid.idx(x, y)
      if (!world.hasTree[i] || world.treeGrowth[i] < 1) continue
      const d = (x - bx) ** 2 + (y - by) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
  }
  return best
}

/** 樹木の成長と枯死（重いので数 tick に 1 回だけ回す） */
export function updateVegetation(world: World): void {
  if (world.tick % VEG_INTERVAL !== 0) return
  const { hasTree, treeGrowth, treeDry, irrigation } = world
  for (let i = 0; i < hasTree.length; i++) {
    if (!hasTree[i]) continue
    if (irrigation.soilWet[i] >= SOIL_GROW_THRESHOLD) {
      treeDry[i] = 0
      if (treeGrowth[i] < 1) treeGrowth[i] = Math.min(1, treeGrowth[i] + VEG_INTERVAL / TREE_GROW_TICKS)
    } else {
      treeDry[i] += VEG_INTERVAL
      if (treeDry[i] > PLANT_DIE_TICKS) {
        hasTree[i] = 0
        treeGrowth[i] = 0
        treeDry[i] = 0
      }
    }
  }
}

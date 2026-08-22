import { World } from '../core/world'
import {
  DROUGHT_EVAP_MULT,
  EVAP_RATE,
  GROWTH_STOCK_RATIO,
  MOISTURE_RECALC_TICKS,
  TICK_DT,
  WATER_SUBSTEPS,
} from '../data/constants'
import { MoistureSource } from './irrigation'
import { PathFinder } from './pathfinding'
import { updateCitizens } from './citizens'
import { updateProduction, updateVegetation } from './production'

/** 1 tick の実行順序 */
export function stepWorld(world: World, path: PathFinder, moisture: MoistureSource[]): MoistureSource[] {
  world.tick++
  const newDay = world.season.advance()

  // 1. 水源（季節でランプする）
  const strength = world.season.sourceStrength
  if (strength > 0) {
    for (const src of world.sources) world.water.addWater(src.i, src.strength * strength * TICK_DT)
  }

  // 2. 水流（サブステップに分けて解く）
  const evap = EVAP_RATE * (world.season.kind === 'drought' ? DROUGHT_EVAP_MULT : 1)
  const sub = TICK_DT / WATER_SUBSTEPS
  for (let k = 0; k < WATER_SUBSTEPS; k++) world.water.step(sub, evap)

  // 3. 灌漑（範囲の再計算は数 tick に 1 回）
  if (world.tick % MOISTURE_RECALC_TICKS === 0) world.irrigation.recompute(world.water, moisture)
  world.irrigation.advance()

  // 4. 植生
  updateVegetation(world)

  // 5. 住民（歩行可能マップは水位変化に追随させる）
  if (world.tick % 5 === 0) path.refresh(world.water)
  updateCitizens(world, path)

  // 6. 生産（住民の出勤状況を使う）
  const nextMoisture = updateProduction(world)

  // 7. 日替わり
  if (newDay) onNewDay(world)
  return nextMoisture
}

function onNewDay(world: World): void {
  const cap = Math.max(1, world.capacity)
  const food = world.stock.bread + world.stock.wheat
  const room = world.housing - world.citizens.length
  if (
    room > 0 &&
    world.stock.water >= cap * GROWTH_STOCK_RATIO &&
    food >= cap * GROWTH_STOCK_RATIO
  ) {
    const c = world.spawnCitizen(world.startI)
    world.pushLog(`${c.name} が仲間に加わった`)
  }
  if (world.citizens.length === 0) world.pushLog('入植地は途絶えた…')
}

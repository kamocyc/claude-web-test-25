import { World } from '../core/world'
import {
  DRY_EPSILON,
  EVAP_RATE,
  GROWTH_STOCK_RATIO,
  MOISTURE_RECALC_TICKS,
  RAIN_RATE,
  SEASON_OMEN_DAYS,
  TICK_DT,
  WATER_SUBSTEPS,
} from '../data/constants'
import { MoistureSource } from './irrigation'
import { PathFinder } from './pathfinding'
import { updateCitizens } from './citizens'
import { updateProduction, updateVegetation } from './production'
import { SEASON_LABEL, SEASON_OMEN } from './season'

/** 1 tick の実行順序 */
export function stepWorld(world: World, path: PathFinder, moisture: MoistureSource[]): MoistureSource[] {
  world.tick++
  const wasKind = world.season.kind
  const newDay = world.season.advance(world.rng)
  if (world.season.kind !== wasKind) {
    world.pushLog(`${SEASON_LABEL[world.season.kind]}に入った`)
  }

  // 1. 水源（季節でランプする）
  const strength = world.season.sourceStrength
  if (strength > 0) {
    for (const src of world.sources) world.water.addWater(src.i, src.strength * strength * TICK_DT)
  }

  // 1b. 降雨（大雨の季節だけ）。すでに水のある列にだけ足す（RAIN_RATE の注記を参照）
  const rainRate = world.season.rainRate
  if (rainRate > 0) {
    const { grid, water } = world
    const add = rainRate * TICK_DT
    for (let i = 0; i < grid.size; i++) {
      if (water.depth[i] > DRY_EPSILON && !grid.isDrain[i]) water.addWater(i, add)
    }
  }

  // 2. 水流（サブステップに分けて解く）
  const evap = EVAP_RATE * world.season.evapMult
  const sub = TICK_DT / WATER_SUBSTEPS
  for (let k = 0; k < WATER_SUBSTEPS; k++) world.water.step(sub, evap)

  // 3. 灌漑（範囲の再計算は数 tick に 1 回）
  if (world.tick % MOISTURE_RECALC_TICKS === 0) world.irrigation.recompute(world.water, moisture)
  // 雨のあいだは水路の届かない高台も湿る（畑が一斉に実る季節）
  world.irrigation.advance(rainRate / RAIN_RATE)

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
  // 次の季節の前触れ。残り日数がちょうど閾値になった日に一度だけ出す
  const season = world.season
  if (season.forecast && season.daysLeft === SEASON_OMEN_DAYS) {
    world.pushLog(SEASON_OMEN[season.forecast])
  }

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

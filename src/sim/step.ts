import { World } from '../core/world'
import {
  DRY_EPSILON,
  EVAP_RATE,
  GROWTH_RESERVE_DAYS,
  LOGISTICS_RECALC_TICKS,
  MOISTURE_RECALC_TICKS,
  NEED_DECAY,
  RAIN_RATE,
  SEASON_OMEN_DAYS,
  TICK_DT,
  TICKS_PER_DAY,
  WHEAT_FOOD_VALUE,
  WATER_SUBSTEPS,
} from '../data/constants'
import { MoistureSource } from './irrigation'
import { PathFinder } from './pathfinding'
import { updateCitizens } from './citizens'
import { moveLoads, updateProduction, updateVegetation } from './production'
import { Logistics } from './logistics'
import { SEASON_LABEL, SEASON_OMEN } from './season'
import { igniteDaily, updateFire } from './fire'
import { NEED_SEEK_THRESHOLD } from '../data/constants'
import { shortageOf } from './people'
import { floodDamage } from './flood'

/** 1 tick の実行順序 */
export function stepWorld(
  world: World,
  path: PathFinder,
  logistics: Logistics,
  moisture: MoistureSource[],
): MoistureSource[] {
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

  // 6. 物流（蔵までの道のりと水路。重いので数 tick に 1 回）
  if (world.tick % LOGISTICS_RECALC_TICKS === 0) logistics.recompute(world, path)

  // 7. 生産（住民の出勤状況を使う）と、荷置き場から蔵への搬出
  const nextMoisture = updateProduction(world)
  moveLoads(world, logistics)

  // 8. 火事（延焼・焼失。消火は住民の仕事なので citizens 側）
  updateFire(world)

  // 9. 日替わり
  if (newDay) onNewDay(world)
  return nextMoisture
}

function onNewDay(world: World): void {
  igniteDaily(world)
  floodDamage(world)
  warnShortage(world)

  // 次の季節の前触れ。残り日数がちょうど閾値になった日に一度だけ出す
  const season = world.season
  if (season.forecast && season.daysLeft === SEASON_OMEN_DAYS) {
    world.pushLog(SEASON_OMEN[season.forecast])
  }

  // 人が増えるのは平年だけ。大雨や日照りのさなかに口が増えると、
  // 蓄えを食い潰して村ごと倒れる（実際、洪水の最中に人口が増えて全滅していた）
  if (canGrowPopulation(world)) {
    const c = world.spawnCitizen(world.startI)
    world.pushLog(`${c.name} が仲間に加わった`)
  }
  if (world.citizens.length === 0) world.pushLog('村は絶えた…')
}

/** 空き寝床と平年、現在の人口を一定日数支えられる備蓄がそろっているか。 */
export function canGrowPopulation(world: World): boolean {
  const population = Math.max(1, world.citizens.length)
  const reserveTicks = GROWTH_RESERVE_DAYS * TICKS_PER_DAY
  const waterNeeded = population * reserveTicks * NEED_DECAY.water
  const foodNeeded = population * reserveTicks * NEED_DECAY.food
  const food = world.stock.meal + world.stock.wheat * WHEAT_FOOD_VALUE

  return (
    world.housing > world.citizens.length &&
    world.season.kind === 'normal' &&
    world.stock.water >= waterNeeded &&
    food >= foodNeeded
  )
}

/**
 * 蔵が空で、しかも欲しがっている人がいる日に一度だけ知らせる。
 *
 * これが無いと、住民は黙って働き続けたまま渇きで倒れる（飲みに行く枝が
 * 蔵の中身を見て落ちるので、当人の様子には何も出ない）。
 */
export function warnShortage(world: World): void {
  const short = shortageOf(world)
  const wants = (k: 'water' | 'food'): boolean =>
    world.citizens.some((c) => c.needs[k] < NEED_SEEK_THRESHOLD)

  if (short.water && wants('water')) {
    if (!world.warned.water) {
      world.warned.water = true
      world.pushLog('蔵の水が尽きた — 踏車を建て、取水口の水深を保つこと')
    }
  } else if (!short.water) {
    world.warned.water = false
  }

  if (short.food && wants('food')) {
    if (!world.warned.food) {
      world.warned.food = true
      world.pushLog('蔵の食べ物が尽きた — 田畑と精米所の手を確かめること')
    }
  } else if (!short.food) {
    world.warned.food = false
  }
}

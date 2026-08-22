import { describe, expect, it } from 'vitest'
import { Game } from '../src/core/game'
import { defOf } from '../src/data/buildings'
import { canGrowPopulation } from '../src/sim/step'

function villageWithRoom(): Game {
  const game = new Game({ w: 40, h: 40, seed: 17 })
  game.world.createBuilding(defOf('house'), game.world.startI + 1, true)
  game.world.season.kind = 'normal'
  return game
}

describe('人口増加', () => {
  it('現在の人口の3日分の水と米を求める', () => {
    const game = villageWithRoom()
    const world = game.world // 5 人: 水 10、食料 7.5 が3日分

    world.stock.water = 10
    world.stock.meal = 7.5
    world.stock.wheat = 0
    expect(canGrowPopulation(world)).toBe(true)

    world.stock.water = 9.99
    expect(canGrowPopulation(world)).toBe(false)

    world.stock.water = 10
    world.stock.meal = 7.49
    expect(canGrowPopulation(world)).toBe(false)
  })

  it('麦は米の半分の食料として数える', () => {
    const game = villageWithRoom()
    const world = game.world
    world.stock.water = 10
    world.stock.meal = 0
    world.stock.wheat = 15
    expect(canGrowPopulation(world)).toBe(true)

    world.stock.wheat = 14.99
    expect(canGrowPopulation(world)).toBe(false)
  })

  it('備蓄があっても空き寝床がなければ増えない', () => {
    const game = villageWithRoom()
    const world = game.world
    while (world.citizens.length < world.housing) world.spawnCitizen(world.startI)
    world.stock.water = 999
    world.stock.meal = 999
    expect(canGrowPopulation(world)).toBe(false)
  })
})

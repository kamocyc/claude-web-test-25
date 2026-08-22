import { World } from './world'
import { PathFinder } from '../sim/pathfinding'
import { MoistureSource } from '../sim/irrigation'
import { Logistics } from '../sim/logistics'
import { stepWorld } from '../sim/step'
import { generateWorld, MapOptions } from '../data/mapgen'

/** シミュレーション一式。描画からは読むだけ。 */
export class Game {
  readonly world: World
  readonly path: PathFinder
  readonly logistics: Logistics
  private moisture: MoistureSource[] = []

  constructor(opts: MapOptions = {}) {
    this.world = generateWorld(opts)
    this.path = new PathFinder(this.world.grid)
    this.path.refresh(this.world.water)
    this.logistics = new Logistics(this.world.grid.size)
    this.logistics.recompute(this.world, this.path)
  }

  step(): void {
    this.moisture = stepWorld(this.world, this.path, this.logistics, this.moisture)
  }
}

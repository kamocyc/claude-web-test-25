import { World } from './world'
import { PathFinder } from '../sim/pathfinding'
import { MoistureSource } from '../sim/irrigation'
import { stepWorld } from '../sim/step'
import { generateWorld, MapOptions } from '../data/mapgen'

/** シミュレーション一式。描画からは読むだけ。 */
export class Game {
  readonly world: World
  readonly path: PathFinder
  private moisture: MoistureSource[] = []

  constructor(opts: MapOptions = {}) {
    this.world = generateWorld(opts)
    this.path = new PathFinder(this.world.grid)
    this.path.refresh(this.world.water)
  }

  step(): void {
    this.moisture = stepWorld(this.world, this.path, this.moisture)
  }
}

import { World } from '../core/world'
import type { Building, Citizen } from '../core/world'
import { defOf } from '../data/buildings'
import {
  CITIZEN_SPEED,
  NEED_DECAY,
  NEED_SEEK_THRESHOLD,
  STARVE_TICKS,
  TICK_DT,
} from '../data/constants'
import { PathFinder } from './pathfinding'
import { completeBuild } from './structures'
import { fightFire } from './fire'
import { idleByWater } from './production'

const ARRIVE_EPS = 0.06

/** 職場の割り当て：空きスロットのある建物へ無職の住民を配属する。 */
export function assignJobs(world: World): void {
  // 毎 tick 割り当て直すと経路探索が無駄なので間引く
  if (world.tick % 10 !== 0) return
  const openings: Building[] = []
  for (const b of world.buildings) {
    if (!b.built) continue
    const def = defOf(b.defId)
    b.workers = b.workers.filter((id) => world.citizens.some((c) => c.id === id))
    // 水に沈んだ職場や、水の合わない田には人を置かない。手が空くぶん畑や山へ回る
    if (def.workers > 0 && idleByWater(world, b)) {
      for (const id of b.workers) {
        const c = world.citizens.find((x) => x.id === id)
        if (c) {
          c.jobId = -1
          c.task = 'idle'
        }
      }
      b.workers = []
      continue
    }
    for (let n = b.workers.length; n < def.workers; n++) openings.push(b)
  }
  if (openings.length === 0) return
  // 優先度の高い仕事から埋める（末尾から取り出すので昇順に並べる）
  openings.sort((a, b) => (defOf(a.defId).jobPriority ?? 0) - (defOf(b.defId).jobPriority ?? 0))
  for (const c of world.citizens) {
    if (c.jobId >= 0) continue
    const b = openings.pop()
    if (!b) break
    b.workers.push(c.id)
    c.jobId = b.id
    c.task = 'idle'
  }
}

/** 建設に回す人数の枠。全員が職場で埋まっていても工事が止まらないようにする。 */
interface BuildQuota {
  wanted: number
  current: number
}

export function updateCitizens(world: World, path: PathFinder): void {
  for (const b of world.buildings) b.staffPresent = 0
  assignJobs(world)
  const hasSites = world.buildings.some((b) => !b.built)
  const quota: BuildQuota = {
    wanted: hasSites ? Math.max(1, Math.floor(world.citizens.length / 3)) : 0,
    current: world.citizens.filter((c) => c.task === 'build').length,
  }
  const dead: Citizen[] = []
  for (const c of world.citizens) {
    if (!updateCitizen(world, path, c, quota)) dead.push(c)
  }
  for (const c of dead) {
    world.citizens = world.citizens.filter((x) => x !== c)
    const b = c.jobId >= 0 ? world.buildingById(c.jobId) : undefined
    if (b) b.workers = b.workers.filter((id) => id !== c.id)
    world.pushLog(`${c.name} が力尽きた…`)
  }
}

/** 生存していれば true */
function updateCitizen(world: World, path: PathFinder, c: Citizen, quota: BuildQuota): boolean {
  const n = c.needs
  n.water = Math.max(0, n.water - NEED_DECAY.water)
  n.food = Math.max(0, n.food - NEED_DECAY.food)
  if (c.task !== 'sleep') n.sleep = Math.max(0, n.sleep - NEED_DECAY.sleep)

  if (n.water <= 0 || n.food <= 0) c.starveTicks++
  else c.starveTicks = 0
  if (c.starveTicks > STARVE_TICKS) return false

  c.px = c.x
  c.py = c.y

  // 需要が逼迫したら作業を中断して再判断する（消火だけは中断しない）
  if ((c.task === 'work' || c.task === 'build') && urgentNeed(c) !== null) c.task = 'idle'
  if (c.task === 'idle') decideTask(world, path, c, quota)
  if (c.task === 'idle') return true

  if (c.path && c.path.length > 0) {
    walk(world, path, c)
    return true
  }
  act(world, path, c)
  return true
}

function urgentNeed(c: Citizen): 'sleep' | 'water' | 'food' | null {
  if (c.needs.sleep < NEED_SEEK_THRESHOLD) return 'sleep'
  if (c.needs.water < NEED_SEEK_THRESHOLD) return 'water'
  if (c.needs.food < NEED_SEEK_THRESHOLD) return 'food'
  return null
}

/** 火消し詰所に勤めているか */
function isFirefighter(world: World, c: Citizen): boolean {
  if (c.jobId < 0) return false
  const job = world.buildingById(c.jobId)
  return !!job && job.built && defOf(job.defId).kind === 'firehouse'
}

function decideTask(world: World, path: PathFinder, c: Citizen, quota: BuildQuota): void {
  // 需要は優先度順に独立して見る。住居が無いからといって水を飲みに行かない、
  // というようなことが起きないようにする。
  const n = c.needs
  if (n.sleep < NEED_SEEK_THRESHOLD &&
      travelTo(world, path, c, 'sleep', (b) => b.built && defOf(b.defId).kind === 'house')) return
  if (n.water < NEED_SEEK_THRESHOLD && world.stock.water > 0 &&
      travelTo(world, path, c, 'drink', (b) => b.built && !!defOf(b.defId).storage)) return
  if (n.food < NEED_SEEK_THRESHOLD && (world.stock.meal > 0 || world.stock.wheat > 0) &&
      travelTo(world, path, c, 'eat', (b) => b.built && !!defOf(b.defId).storage)) return

  // 見つかった火事があれば、火消しは何をおいても駆けつける
  if (isFirefighter(world, c) &&
      travelTo(world, path, c, 'fight', (b) => b.built && b.fire > 0 && b.detected)) return

  // 工事が残っていれば、職場があっても何人かは建設に回る
  if (quota.current < quota.wanted && travelTo(world, path, c, 'build', (b) => !b.built)) {
    quota.current++
    return
  }

  if (c.jobId >= 0) {
    const job = world.buildingById(c.jobId)
    if (job && job.built && travelTo(world, path, c, 'work', (b) => b === job)) return
    if (job && job.built) {
      // 道がつながっていない職場は手放して、他の建物に配属できるようにする
      job.status = '道がつながっていない'
      job.workers = job.workers.filter((id) => id !== c.id)
    }
    c.jobId = -1
  }
  // 無職なら建設要員として働く
  if (travelTo(world, path, c, 'build', (b) => !b.built)) return
  c.task = 'idle'
  c.taskTarget = -1
}

/** 条件に合う最寄りの建物へ向かう。見つからなければ false */
function travelTo(
  world: World,
  path: PathFinder,
  c: Citizen,
  kind: Citizen['task'],
  filter: (b: Building) => boolean,
): boolean {
  const goals: number[] = []
  const owner = new Map<number, Building>()
  for (const b of world.buildings) {
    if (!filter(b)) continue
    for (const t of path.approachTiles(b.i)) {
      if (!owner.has(t)) {
        owner.set(t, b)
        goals.push(t)
      }
    }
  }
  if (goals.length === 0) return false
  const p = path.findAny(c.i, goals)
  if (!p) return false
  const goal = p.length > 0 ? p[p.length - 1] : c.i
  const b = owner.get(goal)
  if (!b) return false
  c.task = kind
  c.taskTarget = b.id
  c.path = p
  c.pathPos = 0
  c.actionTicks = 0
  return true
}

function walk(world: World, path: PathFinder, c: Citizen): void {
  const { grid } = world
  // 水の中は足が進まない。1 tick は 0.1 秒で 1 マスより短いので、
  // いま立っている列の深さで見れば十分足りる
  let budget = (CITIZEN_SPEED * TICK_DT) / path.costAt(c.i)
  const p = c.path as number[]
  while (budget > 0 && c.pathPos < p.length) {
    const target = p[c.pathPos]
    const tx = grid.xOf(target) + 0.5
    const ty = grid.yOf(target) + 0.5
    const dx = tx - c.x
    const dy = ty - c.y
    const d = Math.hypot(dx, dy)
    if (d <= ARRIVE_EPS || d <= budget) {
      c.x = tx
      c.y = ty
      c.i = target
      c.pathPos++
      budget -= d
    } else {
      c.x += (dx / d) * budget
      c.y += (dy / d) * budget
      budget = 0
    }
  }
  if (c.pathPos >= p.length) c.path = null
}

function act(world: World, path: PathFinder, c: Citizen): void {
  const b = c.taskTarget >= 0 ? world.buildingById(c.taskTarget) : undefined
  if (!b) {
    c.task = 'idle'
    return
  }
  switch (c.task) {
    case 'drink':
      if (world.stock.water >= 1) {
        world.stock.water -= 1
        c.needs.water = 1
      }
      c.task = 'idle'
      break
    case 'eat':
      if (world.stock.meal >= 1) {
        world.stock.meal -= 1
        c.needs.food = 1
      } else if (world.stock.wheat >= 1) {
        world.stock.wheat -= 1
        c.needs.food = Math.min(1, c.needs.food + 0.5)
      }
      c.task = 'idle'
      break
    case 'sleep':
      c.needs.sleep = Math.min(1, c.needs.sleep + 0.01)
      if (c.needs.sleep >= 1) c.task = 'idle'
      break
    case 'fight':
      if (b.fire <= 0) {
        c.task = 'idle'
        break
      }
      fightFire(world, b)
      break
    case 'work':
      if (!b.built) {
        c.task = 'idle'
        break
      }
      b.staffPresent++
      break
    case 'build':
      if (b.built) {
        c.task = 'idle'
        break
      }
      b.buildProgress += 1
      if (b.buildProgress >= defOf(b.defId).buildPoints) {
        completeBuild(world, b)
        path.refresh(world.water)
        world.pushLog(`${defOf(b.defId).name} が完成した`)
        c.task = 'idle'
      }
      break
    default:
      c.task = 'idle'
      break
  }
}

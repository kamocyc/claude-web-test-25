import * as THREE from 'three'
import { World } from '../core/world'
import { Logistics } from '../sim/logistics'
import { boatRoutes } from '../sim/boats'
import { box, cyl, instanced, merge } from './entityMesh'

const MAX_BOATS = 64
/** 舟の速さ [マス/秒]。人（2.2 m/s）より少し速く、水面を滑っていく */
const BOAT_SPEED = 2.8
/** 何秒ごとに航路を引き直すか。水位が変われば通れる水路も変わる */
const ROUTE_REFRESH = 2
/** 荷がこれだけ溜まるごとに舟が 1 艘増える */
const CARGO_PER_BOAT = 12
const MAX_PER_LANE = 4

const HULL = 0x8a6a44
const HULL_DARK = 0x6f5335
const POLE = 0xb99f74
const BALE = 0xd8c58a

const dummy = new THREE.Object3D()

/** 小舟。舳先が +Z を向く（人と同じ向きの取り方） */
function hull(): THREE.BufferGeometry {
  return merge(
    box(0.3, 0.08, 0.78, HULL_DARK, 0, -0.04),
    box(0.36, 0.1, 0.66, HULL, 0, 0.02),
    box(0.24, 0.05, 0.2, HULL_DARK, 0, 0.1, 0.28), // 舳先の板
    cyl(0.02, 0.02, 0.52, 4, POLE, 0.11, 0.1, -0.26), // 棹
  )
}

/** 積み荷の俵。荷を積んで下る舟にだけ乗る */
function bale(): THREE.BufferGeometry {
  return merge(
    box(0.22, 0.16, 0.26, BALE, 0, 0.06, 0.02),
    box(0.16, 0.12, 0.2, BALE, 0, 0.2, 0.04),
  )
}

interface Boat {
  /** 航路上の位置。0..len が下り（荷を積む）、len..2len が戻り */
  t: number
  /** 波に揺れる位相 */
  phase: number
}

interface Lane {
  /** 航路の形が変わったか調べるための署名 */
  sign: string
  /** 滑らかにした航路の点。i はその点がいる列（水面の高さを引くのに使う） */
  pts: { x: number; z: number; i: number }[]
  /** 各点までの道のり */
  acc: number[]
  len: number
  boats: Boat[]
}

/**
 * 水路を行き来する小舟。
 *
 * 荷そのものは物流が数として捌いているので、この舟は見た目だけのもの。
 * それでも「掘った運河が村の物流になっている」ことは舟が通ってはじめて分かる。
 * 荷が溜まっている船着場ほど舟の数が増え、下りの舟は俵を積んでいる。
 */
export class BoatMeshes {
  readonly group = new THREE.Group()
  private readonly hulls: THREE.InstancedMesh
  private readonly bales: THREE.InstancedMesh
  private readonly lanes = new Map<string, Lane>()
  private timer = 0
  private clock = 0

  constructor() {
    const solid = () => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })
    this.hulls = instanced(hull(), solid(), MAX_BOATS)
    this.bales = instanced(bale(), solid(), MAX_BOATS)
    this.group.add(this.hulls, this.bales)
  }

  /** 村を差し替えたときに、前の村の舟を消す */
  clear(): void {
    this.lanes.clear()
    this.timer = 0
    this.hulls.count = 0
    this.bales.count = 0
  }

  /** dt はゲームの速度を掛けた秒数（止めれば舟も止まる） */
  update(world: World, logistics: Logistics, dt: number): void {
    this.clock += dt
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = ROUTE_REFRESH
      this.refreshLanes(world, logistics)
    }
    this.draw(world, dt)
  }

  /** 航路と舟の数を引き直す。舟の位置は航路が変わらないかぎり引き継ぐ */
  private refreshLanes(world: World, logistics: Logistics): void {
    const seen = new Set<string>()
    for (const route of boatRoutes(world, logistics)) {
      const key = `${route.fromId}>${route.toId}`
      seen.add(key)
      const sign = route.path.join(',')
      let lane = this.lanes.get(key)
      if (!lane || lane.sign !== sign) {
        lane = newLane(world, route.path, sign)
        this.lanes.set(key, lane)
      }
      const want = Math.max(1, Math.min(MAX_PER_LANE, 1 + Math.floor(route.cargo / CARGO_PER_BOAT)))
      setBoatCount(lane, want)
    }
    for (const key of [...this.lanes.keys()]) if (!seen.has(key)) this.lanes.delete(key)
  }

  private draw(world: World, dt: number): void {
    let n = 0
    let laden = 0
    for (const lane of this.lanes.values()) {
      if (lane.len <= 0) continue
      const cycle = lane.len * 2
      for (const b of lane.boats) {
        b.t = (b.t + BOAT_SPEED * dt) % cycle
        if (n >= MAX_BOATS) break
        // 下りは荷を積み、戻りは空。折り返しは船着場の上で行う
        const down = b.t <= lane.len
        const s = down ? b.t : cycle - b.t
        const here = pointAt(lane, s)
        const ahead = pointAt(lane, Math.min(lane.len, s + 0.7))
        const behind = pointAt(lane, Math.max(0, s - 0.7))
        const dx = ahead.x - behind.x
        const dz = ahead.z - behind.z
        // 波に合わせてわずかに上下する。止まっているように見えないための揺れ
        const bob = Math.sin(this.clock * 1.6 + b.phase) * 0.02
        const y = world.water.surface(here.i) + bob - 0.03
        dummy.position.set(here.x, y, here.z)
        dummy.rotation.set(0, Math.atan2(dx, dz) + (down ? 0 : Math.PI), Math.sin(this.clock * 1.1 + b.phase) * 0.04)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        this.hulls.setMatrixAt(n, dummy.matrix)
        if (down) {
          this.bales.setMatrixAt(laden, dummy.matrix)
          laden++
        }
        n++
      }
    }
    this.hulls.count = n
    this.bales.count = laden
    this.hulls.instanceMatrix.needsUpdate = true
    this.bales.instanceMatrix.needsUpdate = true
  }
}

/** 折れ線の角を丸めて（Chaikin）、道のりを測っておく */
function newLane(world: World, path: number[], sign: string): Lane {
  const { grid } = world
  let pts = path.map((i) => ({ x: grid.xOf(i) + 0.5, z: grid.yOf(i) + 0.5, i }))
  for (let pass = 0; pass < 2 && pts.length > 2; pass++) {
    const next: typeof pts = [pts[0]]
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, i: a.i })
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, i: b.i })
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  const acc = [0]
  for (let k = 1; k < pts.length; k++) {
    acc.push(acc[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z))
  }
  return { sign, pts, acc, len: acc[acc.length - 1], boats: [] }
}

/** 舟を増やすときは、いる舟のあいだに等間隔で挟む */
function setBoatCount(lane: Lane, want: number): void {
  if (lane.boats.length === want) return
  while (lane.boats.length > want) lane.boats.pop()
  const cycle = lane.len * 2
  while (lane.boats.length < want) {
    const k = lane.boats.length
    lane.boats.push({ t: (cycle * k) / want, phase: k * 1.7 })
  }
}

/** 航路の s マス目の位置 */
function pointAt(lane: Lane, s: number): { x: number; z: number; i: number } {
  const { pts, acc } = lane
  if (s <= 0) return pts[0]
  if (s >= lane.len) return pts[pts.length - 1]
  // 二分探索で区間を見つける
  let lo = 0
  let hi = acc.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (acc[mid] <= s) lo = mid
    else hi = mid
  }
  const seg = acc[hi] - acc[lo]
  const f = seg > 0 ? (s - acc[lo]) / seg : 0
  const a = pts[lo]
  const b = pts[hi]
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, i: f < 0.5 ? a.i : b.i }
}

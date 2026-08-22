import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { World } from '../core/world'
import { BuildingKind, defOf } from '../data/buildings'

const MAX_PER_KIND = 400
const MAX_TREES = 6000
const MAX_CITIZENS = 600

const dummy = new THREE.Object3D()
const tint = new THREE.Color()
const DRY_LEAF = new THREE.Color(0xd8b478)
const WEAK = new THREE.Color(0xd96a5a)

/**
 * 部品に単色を焼き込んで所定の位置へ置く。
 * 多面体ジオメトリは index を持たないので、マージ相手と揃うよう非 index 化しておく。
 */
function part(source: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source
  geo.translate(x, y, z)
  const n = geo.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  const c = new THREE.Color(color)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  geo.deleteAttribute('uv') // マージのため属性を揃える（uv は使わない）
  return geo
}

const box = (w: number, h: number, d: number, color: number, x = 0, base = 0, z = 0) =>
  part(new THREE.BoxGeometry(w, h, d), color, x, base + h / 2, z)

const roof = (r: number, h: number, color: number, base: number) => {
  const g = new THREE.ConeGeometry(r, h, 4)
  g.rotateY(Math.PI / 4) // 四角錐の面を壁に合わせる
  return part(g, color, 0, base + h / 2, 0)
}

const cyl = (
  rt: number, rb: number, h: number, seg: number, color: number,
  x = 0, base = 0, z = 0,
) => part(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, base + h / 2, z)

/** 立てた円盤（水車や鋸刃）。y は円盤の中心 */
const disc = (r: number, t: number, color: number, x: number, y: number, z: number) => {
  const g = new THREE.CylinderGeometry(r, r, t, 12)
  g.rotateX(Math.PI / 2)
  return part(g, color, x, y, z)
}

const log = (len: number, r: number, color: number, x: number, base: number, z: number) => {
  const g = new THREE.CylinderGeometry(r, r, len, 6)
  g.rotateZ(Math.PI / 2)
  return part(g, color, x, base + r, z)
}

const merge = (...parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)

/** 建物の見た目。屋根や煙突を付けて、上から見ても何の建物か分かるようにする */
const BUILDING_GEOMETRY: Partial<Record<BuildingKind, () => THREE.BufferGeometry>> = {
  district: () =>
    merge(
      box(0.84, 0.95, 0.84, 0xd9a441),
      roof(0.74, 0.55, 0xa8543a, 0.95),
      box(0.16, 0.5, 0.16, 0x7d5a3a, 0.3, 1.4, 0.3),
    ),
  house: () => merge(box(0.66, 0.7, 0.66, 0xd0895f), roof(0.6, 0.5, 0x8c4a3a, 0.7)),
  storage: () => merge(box(0.86, 0.6, 0.86, 0xb2955f), box(0.94, 0.14, 0.94, 0x6f5b3f, 0, 0.6)),
  pump: () =>
    merge(
      box(0.56, 0.45, 0.56, 0x3f7f9c),
      cyl(0.09, 0.09, 1.0, 6, 0xaebfc8, 0, 0.45),
      disc(0.26, 0.08, 0x8fb8c9, 0.24, 0.95, 0),
    ),
  dump: () =>
    merge(box(0.6, 0.45, 0.6, 0x3f7f9c), log(0.6, 0.11, 0xaebfc8, 0.28, 0.45, 0)),
  irrigation: () =>
    merge(
      box(0.5, 0.2, 0.5, 0x7a8790),
      cyl(0.14, 0.18, 1.5, 8, 0x8d9aa3, 0, 0.2),
      cyl(0.4, 0.4, 0.42, 12, 0x7fc4d8, 0, 1.7),
      roof(0.44, 0.28, 0x5f97ab, 2.12),
    ),
  lumberjack: () =>
    merge(
      box(0.6, 0.5, 0.6, 0x7d9a55),
      roof(0.56, 0.36, 0x4f6b38, 0.5),
      log(0.5, 0.09, 0x7a5a3a, 0, 0, 0.36),
      log(0.5, 0.09, 0x7a5a3a, 0, 0.18, 0.36),
    ),
  sawmill: () =>
    merge(
      box(0.72, 0.6, 0.72, 0x9a7a50),
      box(0.8, 0.12, 0.8, 0x5d4a30, 0, 0.6),
      disc(0.24, 0.06, 0xd8dde0, 0.3, 0.42, 0),
    ),
  mill: () =>
    merge(
      box(0.68, 0.55, 0.68, 0xd8b46a),
      roof(0.62, 0.45, 0x9a5a44, 0.55),
      box(0.15, 0.4, 0.15, 0x8a5a4a, 0.2, 0.85, 0.2),
    ),
  wharf: () =>
    merge(
      // 桟橋と、舫ってある小舟
      box(0.9, 0.12, 0.42, 0x9a7f57, 0, 0, -0.2),
      cyl(0.05, 0.05, 0.5, 5, 0x6d5638, -0.32, -0.38, -0.2),
      cyl(0.05, 0.05, 0.5, 5, 0x6d5638, 0.32, -0.38, -0.2),
      box(0.66, 0.16, 0.24, 0x7a5f3f, 0, 0.02, 0.26),
      cyl(0.04, 0.04, 0.7, 5, 0x8b6f4a, 0.22, 0.12, 0.26),
    ),
  paddy: () =>
    merge(
      // 畦に囲まれた水面と、そこから出た苗の列
      box(0.98, 0.12, 0.98, 0x6b5a42),
      box(0.86, 0.06, 0.86, 0x4f7d86, 0, 0.12),
      box(0.72, 0.2, 0.1, 0x7fb457, 0, 0.14, -0.22),
      box(0.72, 0.2, 0.1, 0x7fb457, 0, 0.14, 0),
      box(0.72, 0.2, 0.1, 0x7fb457, 0, 0.14, 0.22),
    ),
  farm: () =>
    merge(
      box(0.94, 0.1, 0.94, 0x8a6a45),
      box(0.82, 0.16, 0.16, 0x9ac45a, 0, 0.1, -0.26),
      box(0.82, 0.16, 0.16, 0x9ac45a, 0, 0.1, 0),
      box(0.82, 0.16, 0.16, 0x9ac45a, 0, 0.1, 0.26),
    ),
  dam: () => merge(box(0.98, 0.88, 0.66, 0x8a7a63), box(1.0, 0.16, 0.76, 0xb8a48c, 0, 0.88)),
  floodgate: () => merge(box(0.98, 0.88, 0.5, 0x6b6b78), box(1.0, 0.16, 0.6, 0xa9b0bd, 0, 0.88)),
}

/** 堰は堰高に合わせて縦に伸ばす。ほかは形を焼き込んであるので伸ばさない */
const STRETCHED = new Set<BuildingKind>(['dam', 'floodgate'])

function conifer(): THREE.BufferGeometry {
  return merge(
    cyl(0.07, 0.1, 0.45, 5, 0x6b4c33),
    part(new THREE.ConeGeometry(0.38, 0.75, 7), 0x3f7a38, 0, 0.75),
    part(new THREE.ConeGeometry(0.27, 0.6, 7), 0x4a8b3f, 0, 1.2),
  )
}
function broadleaf(): THREE.BufferGeometry {
  return merge(
    cyl(0.08, 0.11, 0.5, 5, 0x7a5a3a),
    part(new THREE.IcosahedronGeometry(0.42, 0), 0x4f8f43, 0, 0.9),
    part(new THREE.IcosahedronGeometry(0.28, 0), 0x5d9c4c, 0.18, 1.15, 0.12),
  )
}
function person(): THREE.BufferGeometry {
  return merge(
    part(new THREE.CapsuleGeometry(0.15, 0.3, 3, 7), 0xe8dcc6, 0, 0.3),
    part(new THREE.SphereGeometry(0.12, 8, 6), 0xf0d8bd, 0, 0.6),
  )
}

function instanced(geom: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geom, mat, max)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  m.count = 0
  m.frustumCulled = false
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** 建物・樹木・住民のインスタンス描画。 */
export class EntityMeshes {
  readonly group = new THREE.Group()
  private readonly kinds = new Map<BuildingKind, THREE.InstancedMesh>()
  private readonly counts = new Map<BuildingKind, number>()
  private readonly sites: THREE.InstancedMesh
  private readonly trees: THREE.InstancedMesh[]
  private readonly people: THREE.InstancedMesh
  /** 樹木は動かないので毎フレーム作り直さない */
  private treeFrame = 0

  constructor() {
    // 形に色を焼き込んであるので material は白。稼働状況の陰りは instanceColor で掛ける
    const solid = () => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })
    for (const [kind, make] of Object.entries(BUILDING_GEOMETRY)) {
      const mesh = instanced(make(), solid(), MAX_PER_KIND)
      this.kinds.set(kind as BuildingKind, mesh)
      this.group.add(mesh)
    }
    this.sites = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.4 }),
      MAX_PER_KIND,
    )
    this.trees = [
      instanced(conifer(), solid(), MAX_TREES),
      instanced(broadleaf(), solid(), MAX_TREES),
    ]
    this.people = instanced(person(), solid(), MAX_CITIZENS)
    this.group.add(this.sites, ...this.trees, this.people)
  }

  update(world: World, alpha: number): void {
    this.updateBuildings(world)
    if (this.treeFrame++ % 15 === 0) this.updateTrees(world)
    this.updatePeople(world, alpha)
  }

  private updateBuildings(world: World): void {
    const { grid } = world
    this.counts.clear()
    let sites = 0
    for (const b of world.buildings) {
      const def = defOf(b.defId)
      const x = grid.xOf(b.i) + 0.5
      const z = grid.yOf(b.i) + 0.5
      const base = grid.ground[b.i]
      if (!b.built) {
        const t = def.buildPoints > 0 ? b.buildProgress / def.buildPoints : 1
        dummy.position.set(x, base + 0.15 + t * 0.4, z)
        dummy.scale.set(0.9, 0.3 + t * 0.8, 0.9)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        this.sites.setMatrixAt(sites++, dummy.matrix)
        continue
      }
      const mesh = this.kinds.get(def.kind)
      if (!mesh) continue // 土手は地形として描かれる
      const n = this.counts.get(def.kind) ?? 0
      if (n >= MAX_PER_KIND) continue
      let sy = 1
      if (STRETCHED.has(def.kind)) {
        sy = def.kind === 'floodgate' ? Math.max(0.4, b.gateHeight) : 1
      }
      dummy.position.set(x, base, z)
      dummy.scale.set(1, sy, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(n, dummy.matrix)
      tint.setRGB(1, 1, 1)
      if (!b.active && def.recipe) tint.setRGB(0.72, 0.72, 0.76) // 止まっている建物は色を落とす
      mesh.setColorAt(n, tint)
      this.counts.set(def.kind, n + 1)
    }
    for (const [kind, mesh] of this.kinds) {
      mesh.count = this.counts.get(kind) ?? 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.sites.count = sites
    this.sites.instanceMatrix.needsUpdate = true
  }

  private updateTrees(world: World): void {
    const { grid } = world
    const n = [0, 0]
    for (let i = 0; i < world.hasTree.length; i++) {
      if (!world.hasTree[i]) continue
      const variant = (Math.imul(i + 7, 2654435761) >>> 0) % 100 < 62 ? 0 : 1
      if (n[variant] >= MAX_TREES) continue
      const jitter = (((Math.imul(i + 3, 40503) >>> 0) % 1000) / 1000 - 0.5) * 2
      const g = 0.45 + world.treeGrowth[i] * 0.75 + jitter * 0.08
      dummy.position.set(grid.xOf(i) + 0.5 + jitter * 0.18, grid.ground[i], grid.yOf(i) + 0.5 - jitter * 0.14)
      dummy.rotation.set(0, jitter * Math.PI, 0)
      dummy.scale.set(g, g, g)
      dummy.updateMatrix()
      const mesh = this.trees[variant]
      mesh.setMatrixAt(n[variant], dummy.matrix)
      // 乾いてくると葉が枯れ色になる
      const dry = Math.min(1, world.treeDry[i] / 300)
      tint.setRGB(1, 1, 1).lerp(DRY_LEAF, dry)
      mesh.setColorAt(n[variant], tint)
      n[variant]++
    }
    for (let v = 0; v < this.trees.length; v++) {
      this.trees[v].count = n[v]
      this.trees[v].instanceMatrix.needsUpdate = true
      if (this.trees[v].instanceColor) this.trees[v].instanceColor!.needsUpdate = true
    }
  }

  private updatePeople(world: World, alpha: number): void {
    const { grid } = world
    let n = 0
    for (const c of world.citizens) {
      if (n >= MAX_CITIZENS) break
      const x = c.px + (c.x - c.px) * alpha
      const z = c.py + (c.y - c.py) * alpha
      const base = grid.ground[c.i] + grid.barrier[c.i] // 堰の上にも立つ
      dummy.position.set(x, base, z)
      dummy.rotation.set(0, Math.atan2(c.x - c.px, c.y - c.py), 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.people.setMatrixAt(n, dummy.matrix)
      const worst = Math.min(c.needs.water, c.needs.food, c.needs.sleep)
      tint.setRGB(1, 1, 1).lerp(WEAK, 1 - Math.min(1, worst * 2))
      this.people.setColorAt(n, tint)
      n++
    }
    this.people.count = n
    this.people.instanceMatrix.needsUpdate = true
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true
  }
}

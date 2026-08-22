import * as THREE from 'three'
import { World } from '../core/world'
import { defOf } from '../data/buildings'

const MAX_BUILDINGS = 4000
const MAX_TREES = 6000
const MAX_CITIZENS = 600

const dummy = new THREE.Object3D()
const color = new THREE.Color()

function instanced(geom: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geom, mat, max)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  m.count = 0
  m.frustumCulled = false
  return m
}

/** 建物・樹木・住民のインスタンス描画。 */
export class EntityMeshes {
  readonly group = new THREE.Group()
  private readonly buildings: THREE.InstancedMesh
  private readonly sites: THREE.InstancedMesh
  private readonly trunks: THREE.InstancedMesh
  private readonly leaves: THREE.InstancedMesh
  private readonly people: THREE.InstancedMesh

  constructor() {
    // InstancedMesh の色は instanceColor で与える。ジオメトリに color 属性が無いので
    // material.vertexColors は付けない（付けると全部黒くなる）。
    const tinted = () => new THREE.MeshLambertMaterial({ color: 0xffffff })
    this.buildings = instanced(new THREE.BoxGeometry(1, 1, 1), tinted(), MAX_BUILDINGS)
    this.sites = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.35 }),
      MAX_BUILDINGS,
    )
    this.trunks = instanced(
      new THREE.CylinderGeometry(0.09, 0.12, 1, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4c33 }),
      MAX_TREES,
    )
    this.leaves = instanced(new THREE.ConeGeometry(0.42, 1.1, 6), tinted(), MAX_TREES)
    this.people = instanced(new THREE.CapsuleGeometry(0.16, 0.34, 3, 6), tinted(), MAX_CITIZENS)
    this.group.add(this.buildings, this.sites, this.trunks, this.leaves, this.people)
  }

  update(world: World, alpha: number): void {
    this.updateBuildings(world)
    this.updateTrees(world)
    this.updatePeople(world, alpha)
  }

  private updateBuildings(world: World): void {
    const { grid } = world
    let bn = 0
    let sn = 0
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
        this.sites.setMatrixAt(sn++, dummy.matrix)
        continue
      }
      let height = def.height
      // 堰は水面から少し頭を出して見えるようにする
      if (def.kind === 'floodgate') height = Math.max(0.5, b.gateHeight) + 0.15
      if (def.kind === 'dam') height = 1.15
      if (def.kind === 'levee') continue // 堤防は地形として描かれる
      dummy.position.set(x, base + height / 2, z)
      dummy.scale.set(def.kind === 'farm' ? 0.96 : 0.8, height, def.kind === 'farm' ? 0.96 : 0.8)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      this.buildings.setMatrixAt(bn, dummy.matrix)
      color.setHex(def.color)
      if (!b.active && def.recipe) color.multiplyScalar(0.72)
      this.buildings.setColorAt(bn, color)
      bn++
    }
    this.buildings.count = bn
    this.sites.count = sn
    this.buildings.instanceMatrix.needsUpdate = true
    this.sites.instanceMatrix.needsUpdate = true
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true
  }

  private updateTrees(world: World): void {
    const { grid } = world
    let n = 0
    for (let i = 0; i < world.hasTree.length; i++) {
      if (!world.hasTree[i]) continue
      if (n >= MAX_TREES) break
      const g = 0.35 + world.treeGrowth[i] * 0.65
      const x = grid.xOf(i) + 0.5
      const z = grid.yOf(i) + 0.5
      const base = grid.ground[i]
      dummy.rotation.set(0, 0, 0)
      dummy.position.set(x, base + g * 0.4, z)
      dummy.scale.set(1, g * 0.8, 1)
      dummy.updateMatrix()
      this.trunks.setMatrixAt(n, dummy.matrix)
      dummy.position.set(x, base + g * 1.0, z)
      dummy.scale.set(g, g, g)
      dummy.updateMatrix()
      this.leaves.setMatrixAt(n, dummy.matrix)
      // 乾いてくると葉が枯れ色になる
      const dry = Math.min(1, world.treeDry[i] / 300)
      color.setHex(0x3f7a34).lerp(new THREE.Color(0x9a7a3a), dry)
      this.leaves.setColorAt(n, color)
      n++
    }
    this.trunks.count = n
    this.leaves.count = n
    this.trunks.instanceMatrix.needsUpdate = true
    this.leaves.instanceMatrix.needsUpdate = true
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true
  }

  private updatePeople(world: World, alpha: number): void {
    const { grid } = world
    let n = 0
    for (const c of world.citizens) {
      if (n >= MAX_CITIZENS) break
      const x = c.px + (c.x - c.px) * alpha
      const z = c.py + (c.y - c.py) * alpha
      const base = grid.ground[c.i] + grid.barrier[c.i] // 堰の上にも立つ
      dummy.position.set(x, base + 0.36, z)
      dummy.rotation.set(0, Math.atan2(c.x - c.px, c.y - c.py), 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.people.setMatrixAt(n, dummy.matrix)
      const worst = Math.min(c.needs.water, c.needs.food, c.needs.sleep)
      color.setHex(0xf2e2c9).lerp(new THREE.Color(0xd96a5a), 1 - Math.min(1, worst * 2))
      this.people.setColorAt(n, color)
      n++
    }
    this.people.count = n
    this.people.instanceMatrix.needsUpdate = true
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true
  }
}

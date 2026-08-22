import * as THREE from 'three'
import { Grid } from '../core/grid'
import { World } from '../core/world'

const CHUNK = 16

const TOP_DRY = new THREE.Color(0xa8926a)
const TOP_WET = new THREE.Color(0x6f9a4f)
const TOP_UNDER = new THREE.Color(0x5d6b52)
const LEVEE = new THREE.Color(0x9a9a90)
const SIDE = new THREE.Color(0x6b5b48)
const SIDE_ROCK = new THREE.Color(0x565f66)

interface Chunk {
  mesh: THREE.Mesh
  geom: THREE.BufferGeometry
  columns: number[]
  /** 列 → 頂点の開始位置と個数（先頭 6 個が上面） */
  start: Map<number, number>
  count: Map<number, number>
  dirty: boolean
}

/**
 * 地形メッシュ。16x16 のチャンクに分けてマージしたジオメトリを持ち、
 * 地形が変わったチャンクだけ作り直す。土壌水分の変化は色だけ塗り替える。
 */
export class TerrainMesh {
  readonly group = new THREE.Group()
  private readonly chunks: Chunk[] = []
  private readonly chunkOf: Int32Array
  private readonly world: World
  private readonly grid: Grid
  private readonly material: THREE.MeshLambertMaterial
  private readonly prevGround: Uint8Array

  constructor(world: World) {
    this.world = world
    this.grid = world.grid
    const { grid } = this
    this.chunkOf = new Int32Array(grid.size)
    this.prevGround = new Uint8Array(grid.ground)
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true })

    const cw = Math.ceil(grid.w / CHUNK)
    const ch = Math.ceil(grid.h / CHUNK)
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const columns: number[] = []
        for (let y = cy * CHUNK; y < Math.min(grid.h, (cy + 1) * CHUNK); y++) {
          for (let x = cx * CHUNK; x < Math.min(grid.w, (cx + 1) * CHUNK); x++) {
            const i = grid.idx(x, y)
            columns.push(i)
            this.chunkOf[i] = this.chunks.length
          }
        }
        const geom = new THREE.BufferGeometry()
        const mesh = new THREE.Mesh(geom, this.material)
        mesh.frustumCulled = true
        this.group.add(mesh)
        this.chunks.push({ mesh, geom, columns, start: new Map(), count: new Map(), dirty: true })
      }
    }
    this.rebuildAll()
  }

  /** 地形が変わったチャンクだけ作り直す（変更検知は ground の差分で行う） */
  syncFromGrid(): void {
    const g = this.grid.ground
    for (let i = 0; i < g.length; i++) {
      if (this.prevGround[i] === g[i]) continue
      this.prevGround[i] = g[i]
      this.markDirty(i)
    }
    this.update()
  }

  markDirty(i: number): void {
    const c = this.chunks[this.chunkOf[i]]
    if (c) c.dirty = true
    // 隣のチャンクの側面も変わりうる
    this.grid.forEachNeighbor(i, (n) => {
      const cn = this.chunks[this.chunkOf[n]]
      if (cn) cn.dirty = true
    })
  }

  rebuildAll(): void {
    for (const c of this.chunks) c.dirty = true
    this.update()
  }

  update(): void {
    for (const c of this.chunks) {
      if (!c.dirty) continue
      this.buildChunk(c)
      c.dirty = false
    }
  }

  /** 土壌水分・水没状態を色に反映する（ジオメトリはそのまま） */
  refreshColors(): void {
    for (const c of this.chunks) {
      const attr = c.geom.getAttribute('color') as THREE.BufferAttribute | undefined
      if (!attr) continue
      const arr = attr.array as Float32Array
      for (const i of c.columns) {
        const s = c.start.get(i)
        const n = c.count.get(i)
        if (s === undefined || n === undefined) continue
        this.writeColors(arr, s, n, i)
      }
      attr.needsUpdate = true
    }
  }

  private groundAt(x: number, y: number): number {
    if (!this.grid.inBounds(x, y)) return 0
    return this.grid.ground[this.grid.idx(x, y)]
  }

  private writeColors(colors: Float32Array, start: number, count: number, i: number): void {
    const { world, grid } = this
    const wet = world.irrigation.soilWet[i]
    const under = world.water.depth[i] > 0.05
    const top = new THREE.Color()
    if (grid.levee[i] > 0) top.copy(LEVEE)
    else if (under) top.copy(TOP_UNDER)
    else top.copy(TOP_DRY).lerp(TOP_WET, wet)
    // 高いところほど明るく
    const tint = 0.85 + Math.min(1, grid.ground[i] / 16) * 0.3
    top.multiplyScalar(tint)
    const side = new THREE.Color().copy(grid.ground[i] > 9 ? SIDE_ROCK : SIDE).multiplyScalar(tint)
    for (let v = 0; v < count; v++) {
      const c = v < 6 ? top : side
      const o = (start + v) * 3
      colors[o] = c.r
      colors[o + 1] = c.g
      colors[o + 2] = c.b
    }
  }

  private buildChunk(c: Chunk): void {
    const { grid } = this
    const pos: number[] = []
    const nor: number[] = []
    c.start.clear()
    c.count.clear()

    const quad = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
    ) => {
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz)
      for (let k = 0; k < 6; k++) nor.push(nx, ny, nz)
    }

    for (const i of c.columns) {
      const x = grid.xOf(i)
      const y = grid.yOf(i)
      const g = grid.ground[i]
      const start = pos.length / 3
      // 上面
      quad(x, g, y, x, g, y + 1, x + 1, g, y + 1, x + 1, g, y, 0, 1, 0)
      // 側面（隣が低い分だけ）
      const sides: [number, number, number, number][] = [
        [this.groundAt(x - 1, y), 0, 0, -1],
        [this.groundAt(x + 1, y), 1, 0, 1],
        [this.groundAt(x, y - 1), 2, -1, 0],
        [this.groundAt(x, y + 1), 3, 1, 0],
      ]
      for (const [ng, dir] of sides) {
        if (ng >= g) continue
        const lo = ng
        switch (dir) {
          case 0:
            quad(x, g, y, x, lo, y, x, lo, y + 1, x, g, y + 1, -1, 0, 0)
            break
          case 1:
            quad(x + 1, g, y + 1, x + 1, lo, y + 1, x + 1, lo, y, x + 1, g, y, 1, 0, 0)
            break
          case 2:
            quad(x + 1, g, y, x + 1, lo, y, x, lo, y, x, g, y, 0, 0, -1)
            break
          default:
            quad(x, g, y + 1, x, lo, y + 1, x + 1, lo, y + 1, x + 1, g, y + 1, 0, 0, 1)
            break
        }
      }
      c.start.set(i, start)
      c.count.set(i, pos.length / 3 - start)
    }

    const positions = new Float32Array(pos)
    const normals = new Float32Array(nor)
    const colors = new Float32Array(positions.length)
    for (const i of c.columns) {
      const s = c.start.get(i) as number
      const n = c.count.get(i) as number
      this.writeColors(colors, s, n, i)
    }
    c.geom.dispose()
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.computeBoundingSphere()
    c.mesh.geometry = geom
    ;(c as { geom: THREE.BufferGeometry }).geom = geom
  }
}

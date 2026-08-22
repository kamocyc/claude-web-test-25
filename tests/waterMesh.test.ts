import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Game } from '../src/core/game'
import { Grid } from '../src/core/grid'
import { World } from '../src/core/world'
import { WaterMesh } from '../src/render/waterMesh'
import { DRY_EPSILON } from '../src/data/constants'

/**
 * WaterMesh は WebGL を必要としない（BufferGeometry と ShaderMaterial を組むだけ）ので
 * Node 上でそのまま組み立てて、出来上がった頂点と面を検査できる。
 */
const build = (ticks: number) => {
  const game = new Game({ w: 60, h: 60, seed: 4242 })
  for (let i = 0; i < ticks; i++) game.step()
  const mesh = new WaterMesh(game.world)
  const geom = mesh.mesh.geometry
  const index = geom.getIndex() as THREE.BufferAttribute
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const depth = geom.getAttribute('aDepth') as THREE.BufferAttribute
  const count = geom.drawRange.count
  const tris: number[][] = []
  for (let t = 0; t < count; t += 3) {
    tris.push([index.getX(t), index.getX(t + 1), index.getX(t + 2)])
  }
  return { game, tris, pos, depth, count }
}

describe('水面メッシュ', () => {
  it('面を張るのは濡れている列だけ', () => {
    const { game, tris } = build(200)
    const { grid, water } = game.world
    const vw = grid.w + 1
    const cells = new Set<number>()
    for (const [a] of tris) cells.add(grid.idx(a % vw, Math.floor(a / vw)))
    expect(cells.size).toBeGreaterThan(200) // 川が描かれている
    const dry = [...cells].filter((i) => water.depth[i] <= DRY_EPSILON)
    expect(dry).toEqual([])
  })

  it('陸地の上に斜めの水面ができない（1 枚の面の高低差が水深の範囲に収まる）', () => {
    const { tris, pos } = build(200)
    let maxSpan = 0
    for (const t of tris) {
      const ys = t.map((v) => pos.getY(v))
      maxSpan = Math.max(maxSpan, Math.max(...ys) - Math.min(...ys))
    }
    // 崖の天端へ引っ張られていた頃は 10 ブロック以上あった
    expect(maxSpan).toBeLessThan(2)
  })

  it('水際の頂点の水深は「接する 4 列のうち濡れている割合」まで下がる', () => {
    // 平らな地形に 1 列だけ水を置く。角はどれも 4 列のうち 1 列しか濡れていないので
    // 水深は 1/4 になり、水際がなだらかに消える。列ごとの最大値を使っていた頃は
    // 4 隅とも満水のまま、地形の上に板が乗ったように見えていた。
    const grid = new Grid(8, 8)
    grid.ground.fill(2)
    const world = new World(grid, 1)
    const i = grid.idx(4, 4)
    world.water.depth[i] = 1.2
    const mesh = new WaterMesh(world)
    const geom = mesh.mesh.geometry
    const depth = geom.getAttribute('aDepth') as THREE.BufferAttribute
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const vw = grid.w + 1
    for (const [vx, vy] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ]) {
      const v = vy * vw + vx
      expect(depth.getX(v)).toBeCloseTo(1.2 / 4, 5)
      // 高さは水面に合わせる（地形の高さに引っ張られない）
      expect(pos.getY(v)).toBeCloseTo(world.water.surface(i), 5)
    }
    // その外側は完全に乾いている
    expect(depth.getX(3 * vw + 4)).toBe(0)
    expect(geom.drawRange.count).toBe(6)
  })

  it('川では水の中ほど深く、水際ほど浅く見える', () => {
    const { game, tris, depth } = build(200)
    const { grid, water } = game.world
    const vw = grid.w + 1
    const allWet = (vx: number, vy: number): boolean => {
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const x = vx + dx
          const y = vy + dy
          if (!grid.inBounds(x, y) || water.depth[grid.idx(x, y)] <= DRY_EPSILON) return false
        }
      }
      return true
    }
    let inner = 0
    let edge = 0
    let innerSum = 0
    let edgeSum = 0
    const seen = new Set<number>()
    for (const t of tris) {
      for (const v of t) {
        if (seen.has(v)) continue
        seen.add(v)
        const d = depth.getX(v)
        if (allWet(v % vw, Math.floor(v / vw))) {
          inner++
          innerSum += d
        } else {
          edge++
          edgeSum += d
        }
      }
    }
    expect(inner).toBeGreaterThan(50)
    expect(edge).toBeGreaterThan(20)
    expect(edgeSum / edge).toBeLessThan((innerSum / inner) * 0.7)
  })

  it('水が引くと面も減る', () => {
    const wet = build(200).count
    const game = new Game({ w: 60, h: 60, seed: 4242 })
    for (let i = 0; i < 200; i++) game.step()
    const mesh = new WaterMesh(game.world)
    game.world.water.depth.fill(0)
    mesh.update(0)
    expect(mesh.mesh.geometry.drawRange.count).toBe(0)
    expect(wet).toBeGreaterThan(0)
  })
})

import { Grid } from '../core/grid'
import { Rng } from '../core/rng'
import { World } from '../core/world'
import { MAX_Z } from './constants'
import { defOf } from './buildings'

/** 値ノイズ（決定的） */
function valueNoise(rng: Rng, w: number, h: number, scale: number): Float64Array {
  const gw = Math.ceil(w / scale) + 2
  const gh = Math.ceil(h / scale) + 2
  const g = new Float64Array(gw * gh)
  for (let i = 0; i < g.length; i++) g[i] = rng.next()
  const out = new Float64Array(w * h)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / scale
      const fy = y / scale
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const a = g[y0 * gw + x0]
      const b = g[y0 * gw + x0 + 1]
      const c = g[(y0 + 1) * gw + x0]
      const d = g[(y0 + 1) * gw + x0 + 1]
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
    }
  }
  return out
}

export interface MapOptions {
  w?: number
  h?: number
  seed?: number
}

/**
 * 川が上流(y=0)から下流(y=h-1)へ流れる谷を生成する。
 * 川床は緩やかに下り、下端は排水口なので水は流れ去る。プレイヤーは途中に
 * ダムや水門を建てて水を溜める。
 */
export function generateWorld(opts: MapOptions = {}): World {
  const w = opts.w ?? 80
  const h = opts.h ?? 80
  const seed = opts.seed ?? 12345
  const rng = new Rng(seed)
  const grid = new Grid(w, h)
  // 単一スケールの値ノイズだけだと格子に沿った等高線が出るので、
  // スケールの違う 3 枚を重ねて自然な起伏にする。
  const n1 = valueNoise(rng, w, h, 27)
  const n2 = valueNoise(rng, w, h, 13)
  const n3 = valueNoise(rng, w, h, 6)
  const fbm = (i: number) => n1[i] * 0.55 + n2[i] * 0.3 + n3[i] * 0.15

  const center = (y: number) => w / 2 + Math.sin(y * 0.11) * 5 + Math.sin(y * 0.037) * 7
  const riverBed = (y: number) => 7 - (y / h) * 4

  // 谷の断面: 水路 → 一段上がった浅瀬 → 広い氾濫原（ほぼ平ら）→ 段丘の高地。
  // 氾濫原を広く取ってあるので、川のそばにまとまった建設・耕作の土地がある。
  const CHANNEL = 2.6 // 水路の半幅
  const SHORE = 1.6 // 浅瀬の幅（1 段だけ上げて歩いて降りられるようにする）
  const PLAIN = 11 // 氾濫原の幅

  for (let y = 0; y < h; y++) {
    const cx = center(y)
    const bed = riverBed(y)
    for (let x = 0; x < w; x++) {
      const i = grid.idx(x, y)
      const d = Math.abs(x - cx)
      const t = d - CHANNEL
      let hgt: number
      if (t < 0) {
        hgt = bed - 2 // 水路
      } else if (t < SHORE) {
        hgt = bed - 1 // 浅瀬
      } else if (t < SHORE + PLAIN) {
        // 氾濫原。たまに 1 段の高まりがあるだけで、ほぼ平ら
        hgt = bed + (fbm(i) > 0.76 ? 1 : 0)
      } else {
        // ここから段丘。ノイズは加算のみなので谷が決壊しない
        const up = t - SHORE - PLAIN
        const blend = Math.min(1, up / 4)
        hgt = bed + up * 0.5 + fbm(i) * 11 * blend
      }
      // マップ端は崖にして水を閉じ込める。ただし上流の流入口と下流の放流口だけは
      // 川床のまま開けておく（ここから水が入り、ここから流れ去る）。
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y)
      const mouth = d < CHANNEL + SHORE && (y <= 2 || y >= h - 3)
      if (edge < 3 && !mouth) hgt = Math.max(hgt, bed + 9)
      grid.natural[i] = Math.max(0, Math.min(MAX_Z - 6, Math.round(hgt)))
    }
  }
  grid.refreshAllGround()

  const world = new World(grid, seed)

  // 上流の水源と下流の排水口
  const topCx = center(0)
  for (let x = Math.round(topCx) - 2; x <= Math.round(topCx) + 2; x++) {
    if (x < 0 || x >= w) continue
    const i = grid.idx(x, 1)
    grid.natural[i] = Math.round(riverBed(1)) - 2
    grid.refreshGround(i)
    world.sources.push({ i, strength: 0.28 })
  }
  for (let x = 0; x < w; x++) grid.isDrain[grid.idx(x, h - 1)] = 1

  // 川に最初から水を入れておく（起動直後から川らしく見せる）
  for (let y = 0; y < h; y++) {
    const cx = center(y)
    const bed = riverBed(y)
    for (let x = 0; x < w; x++) {
      const i = grid.idx(x, y)
      // 落ち着いたときの水位に合わせて入れておく（多く入れすぎると岸が一度冠水し、
      // 引いた後に岸辺の施設が取水できなくなる）
      if (Math.abs(x - cx) < 4.2 && grid.ground[i] <= bed - 1.5) world.water.depth[i] = 0.9
    }
  }

  // 樹木（川沿いの湿った土地に生える）
  for (let y = 2; y < h - 2; y++) {
    const cx = center(y)
    for (let x = 2; x < w - 2; x++) {
      const i = grid.idx(x, y)
      const d = Math.abs(x - cx)
      if (d < 4.5 || d > 22) continue
      if (world.water.depth[i] > 0) continue
      if (rng.next() > 0.18) continue
      world.hasTree[i] = 1
      world.treeGrowth[i] = rng.range(0.5, 1)
    }
  }

  // 開始地点：中流の川岸の平らな場所
  const startY = Math.round(h * 0.45)
  let startX = Math.round(center(startY)) + 5
  startX = Math.max(4, Math.min(w - 5, startX))
  let startI = grid.idx(startX, startY)
  for (let dx = 0; dx < 8; dx++) {
    const cand = grid.idx(Math.min(w - 2, startX + dx), startY)
    if (world.water.depth[cand] === 0) {
      startI = cand
      break
    }
  }
  world.startI = startI
  world.hasTree[startI] = 0
  world.createBuilding(defOf('district'), startI, true)

  world.stock.log = 60
  world.stock.plank = 20
  world.stock.water = 45
  world.stock.bread = 45

  for (let n = 0; n < 5; n++) world.spawnCitizen(startI)
  world.irrigation.recompute(world.water, [])
  for (let i = 0; i < grid.size; i++) world.irrigation.soilWet[i] = world.irrigation.moisture[i] > 0 ? 1 : 0
  return world
}

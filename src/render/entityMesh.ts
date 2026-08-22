import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { World } from '../core/world'
import { BuildingKind, defOf } from '../data/buildings'

const MAX_PER_KIND = 400
const MAX_TREES = 6000
const MAX_CITIZENS = 600
const MAX_FLAMES = 400

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

// --- 農村・宿場町の意匠 -----------------------------------------------------
// 茅葺の寄棟、板壁、なまこ壁の土蔵、木組みの櫓。屋根の形と色で何の建物か分かるようにする。
const THATCH = 0xc0a97a // 茅葺
const THATCH_RIDGE = 0x8e7a55 // 棟
const WOOD = 0xa8845c // 板壁
const WOOD_DARK = 0x7a5f42
const POST = 0x6d5638 // 柱・梁
const TILE = 0x6f747b // いぶし銀の瓦
const PLASTER = 0xe6e2d6 // 漆喰
const MUD = 0xc0a67e // 土壁
const SEEDLING = 0x7fb457
const PADDY_WATER = 0x5b8b96
const ROPE = 0xd8cba8

/** 切妻屋根（二枚の勾配板）。瓦にも板葺きにも使う */
function gable(w: number, h: number, d: number, color: number, base: number): THREE.BufferGeometry {
  const slope = Math.hypot(w / 2, h)
  const ang = Math.atan2(h, w / 2)
  const mk = (sign: number) => {
    const g = new THREE.BoxGeometry(slope, 0.09, d)
    g.rotateZ(sign * ang)
    return part(g, color, (sign * -w) / 4, base + h / 2, 0)
  }
  return merge(mk(1), mk(-1))
}

/** 寄棟の茅葺屋根。軒を深く出すと一気に日本の民家に見える */
const thatch = (r: number, h: number, base: number, color = THATCH) =>
  merge(roof(r, h, color, base), box(r * 1.5, 0.07, r * 1.5, THATCH_RIDGE, 0, base - 0.02, 0))

const BUILDING_GEOMETRY: Partial<Record<BuildingKind, () => THREE.BufferGeometry>> = {
  // 庄屋: 瓦葺きの母屋に、板塀と門を添える
  district: () =>
    merge(
      box(0.86, 0.62, 0.7, MUD, 0, 0, -0.06),
      box(0.9, 0.1, 0.74, WOOD_DARK, 0, 0.62, -0.06),
      gable(1.0, 0.4, 0.82, TILE, 0.72),
      box(0.5, 0.42, 0.1, WOOD, 0, 0, 0.42),
      cyl(0.05, 0.05, 0.62, 5, POST, -0.26, 0, 0.42),
      cyl(0.05, 0.05, 0.62, 5, POST, 0.26, 0, 0.42),
      box(0.62, 0.08, 0.16, TILE, 0, 0.62, 0.42),
    ),
  // 民家: 茅葺の寄棟。軒が深く、壁は板張り
  house: () =>
    merge(
      box(0.62, 0.42, 0.62, MUD),
      box(0.66, 0.14, 0.66, WOOD_DARK, 0, 0.42),
      thatch(0.62, 0.58, 0.56),
      cyl(0.045, 0.045, 0.44, 4, POST, -0.3, 0, 0.3),
      cyl(0.045, 0.045, 0.44, 4, POST, 0.3, 0, 0.3),
    ),
  // 蔵: 高床の板倉。米と資材を積む
  storage: () =>
    merge(
      cyl(0.06, 0.06, 0.22, 5, POST, -0.3, 0, -0.3),
      cyl(0.06, 0.06, 0.22, 5, POST, 0.3, 0, -0.3),
      cyl(0.06, 0.06, 0.22, 5, POST, -0.3, 0, 0.3),
      cyl(0.06, 0.06, 0.22, 5, POST, 0.3, 0, 0.3),
      box(0.9, 0.08, 0.9, WOOD_DARK, 0, 0.22),
      box(0.78, 0.48, 0.78, WOOD, 0, 0.3),
      gable(0.98, 0.3, 0.9, WOOD_DARK, 0.78),
    ),
  // 土蔵: なまこ壁と瓦。腰まわりだけ黒い
  dozo: () =>
    merge(
      box(0.82, 0.2, 0.82, 0x4a4a4e),
      box(0.78, 0.58, 0.78, PLASTER, 0, 0.2),
      box(0.86, 0.06, 0.86, TILE, 0, 0.78),
      gable(0.98, 0.34, 0.86, TILE, 0.84),
    ),
  // 踏車: 足で踏んで水を汲み上げる。羽根の付いた立て車
  pump: () =>
    merge(
      box(0.44, 0.18, 0.5, WOOD_DARK),
      disc(0.34, 0.07, WOOD, 0.16, 0.5, 0),
      box(0.06, 0.68, 0.06, POST, 0.16, 0.16, -0.16),
      box(0.06, 0.68, 0.06, POST, 0.16, 0.16, 0.16),
      box(0.12, 0.06, 0.62, WOOD, -0.22, 0.34, 0),
    ),
  // 放水樋: 桶から樋で水を落とす
  dump: () =>
    merge(
      cyl(0.22, 0.24, 0.4, 8, WOOD, -0.16, 0.18),
      cyl(0.06, 0.06, 0.2, 4, POST, -0.16, 0),
      log(0.7, 0.1, WOOD_DARK, 0.16, 0.12, 0),
      box(0.06, 0.24, 0.06, POST, 0.44, 0, 0),
    ),
  // 用水櫓: 汲み上げた水を溜めて撒く。屋根付きの水槽
  irrigation: () =>
    merge(
      cyl(0.05, 0.05, 1.4, 4, POST, -0.24, 0, -0.24),
      cyl(0.05, 0.05, 1.4, 4, POST, 0.24, 0, -0.24),
      cyl(0.05, 0.05, 1.4, 4, POST, -0.24, 0, 0.24),
      cyl(0.05, 0.05, 1.4, 4, POST, 0.24, 0, 0.24),
      box(0.62, 0.06, 0.62, WOOD_DARK, 0, 0.72),
      cyl(0.3, 0.32, 0.5, 10, WOOD, 0, 1.4),
      thatch(0.42, 0.3, 1.9),
    ),
  // 船着場: 桟橋と舫った小舟
  wharf: () =>
    merge(
      box(0.9, 0.1, 0.4, WOOD, 0, 0, -0.22),
      cyl(0.05, 0.05, 0.45, 5, POST, -0.34, -0.34, -0.22),
      cyl(0.05, 0.05, 0.45, 5, POST, 0.34, -0.34, -0.22),
      box(0.68, 0.14, 0.22, WOOD_DARK, 0, 0, 0.26),
      box(0.2, 0.05, 0.16, WOOD, 0.16, 0.14, 0.26),
      cyl(0.03, 0.03, 0.55, 4, POST, -0.34, 0.1, 0.26),
    ),
  // 火の見櫓: 木組みの櫓に半鐘。てっぺんが村で一番高い
  firetower: () =>
    merge(
      cyl(0.045, 0.06, 2.2, 4, POST, -0.2, 0, -0.2),
      cyl(0.045, 0.06, 2.2, 4, POST, 0.2, 0, -0.2),
      cyl(0.045, 0.06, 2.2, 4, POST, -0.2, 0, 0.2),
      cyl(0.045, 0.06, 2.2, 4, POST, 0.2, 0, 0.2),
      box(0.5, 0.05, 0.06, POST, 0, 0.7, -0.2),
      box(0.5, 0.05, 0.06, POST, 0, 1.4, -0.2),
      box(0.06, 0.05, 0.46, POST, 0.2, 1.05, 0),
      box(0.56, 0.07, 0.56, WOOD, 0, 2.2),
      cyl(0.14, 0.16, 0.18, 8, 0x8c7a4a, 0, 2.34), // 半鐘
      thatch(0.4, 0.26, 2.55, WOOD_DARK),
    ),
  // 火消し詰所: 板壁の小屋に纏を立てる
  firehouse: () =>
    merge(
      box(0.66, 0.44, 0.6, WOOD),
      gable(0.78, 0.3, 0.68, WOOD_DARK, 0.44),
      cyl(0.035, 0.035, 0.95, 4, POST, 0.34, 0, 0.26),
      cyl(0.12, 0.1, 0.16, 6, 0xc8503c, 0.34, 0.9, 0.26),
      box(0.2, 0.04, 0.02, ROPE, 0.34, 0.82, 0.26),
    ),
  // 天水桶: 軒先の防火用水。箍を巻いた桶
  barrel: () =>
    merge(
      cyl(0.2, 0.22, 0.44, 10, WOOD, 0, 0),
      cyl(0.21, 0.21, 0.04, 10, WOOD_DARK, 0, 0.08),
      cyl(0.2, 0.2, 0.04, 10, WOOD_DARK, 0, 0.34),
      cyl(0.17, 0.17, 0.02, 10, 0x4f7d86, 0, 0.42),
    ),
  // 杣小屋: 茅葺の小屋と丸太の積み
  lumberjack: () =>
    merge(
      box(0.52, 0.36, 0.52, WOOD, 0, 0, -0.1),
      thatch(0.54, 0.4, 0.36),
      log(0.6, 0.09, 0x7a5a3a, 0, 0, 0.38),
      log(0.6, 0.09, 0x7a5a3a, 0, 0.18, 0.38),
      log(0.6, 0.09, 0x8a6a44, 0, 0.36, 0.38),
    ),
  // 木挽小屋: 片流れの作業小屋と大鋸
  sawmill: () =>
    merge(
      cyl(0.05, 0.05, 0.56, 4, POST, -0.34, 0, -0.3),
      cyl(0.05, 0.05, 0.56, 4, POST, 0.34, 0, -0.3),
      box(0.76, 0.3, 0.4, WOOD, 0, 0, -0.16),
      gable(0.9, 0.26, 0.8, WOOD_DARK, 0.56),
      box(0.6, 0.1, 0.34, 0x8a6a44, 0, 0, 0.3),
      disc(0.2, 0.04, 0xd8dde0, 0.24, 0.36, 0.3),
    ),
  // 精米所: 水車小屋。大きな立て車が回る
  mill: () =>
    merge(
      box(0.6, 0.5, 0.62, MUD, 0.1, 0, 0),
      box(0.64, 0.1, 0.66, WOOD_DARK, 0.1, 0.5),
      gable(0.78, 0.34, 0.72, TILE, 0.6),
      disc(0.4, 0.1, WOOD, -0.34, 0.42, 0),
      disc(0.16, 0.13, WOOD_DARK, -0.34, 0.42, 0),
      box(0.86, 0.06, 0.06, WOOD, -0.34, 0.4, 0),
      box(0.06, 0.06, 0.86, WOOD, -0.34, 0.4, 0),
    ),
  // 水田: 畦に囲まれた水面から苗が並ぶ
  paddy: () =>
    merge(
      box(0.98, 0.14, 0.98, 0x6b5a42),
      box(0.84, 0.08, 0.84, PADDY_WATER, 0, 0.12),
      box(0.7, 0.22, 0.08, SEEDLING, 0, 0.16, -0.24),
      box(0.7, 0.22, 0.08, SEEDLING, 0, 0.16, 0),
      box(0.7, 0.22, 0.08, SEEDLING, 0, 0.16, 0.24),
    ),
  // 畑: 土を寄せた畝
  farm: () =>
    merge(
      box(0.96, 0.08, 0.96, 0x8a6a45),
      box(0.86, 0.14, 0.2, 0x9a7853, 0, 0.08, -0.28),
      box(0.86, 0.14, 0.2, 0x9a7853, 0, 0.08, 0),
      box(0.86, 0.14, 0.2, 0x9a7853, 0, 0.08, 0.28),
      box(0.8, 0.12, 0.08, 0x9ac45a, 0, 0.22, -0.28),
      box(0.8, 0.12, 0.08, 0x9ac45a, 0, 0.22, 0),
      box(0.8, 0.12, 0.08, 0x9ac45a, 0, 0.22, 0.28),
    ),
  // 堰: 杭を打って板を渡した木の堰
  dam: () =>
    merge(
      box(0.98, 0.8, 0.5, WOOD, 0, 0, 0),
      box(0.98, 0.1, 0.62, WOOD_DARK, 0, 0.8),
      cyl(0.05, 0.05, 0.98, 4, POST, -0.36, 0, 0.24),
      cyl(0.05, 0.05, 0.98, 4, POST, 0.36, 0, 0.24),
    ),
  // 橋: 桁の上に板を並べ、両脇に低い高欄を立てた木橋
  bridge: () =>
    merge(
      box(1.0, 0.08, 0.16, WOOD_DARK, 0, 0, -0.26),
      box(1.0, 0.08, 0.16, WOOD_DARK, 0, 0, 0.26),
      box(1.0, 0.07, 0.78, WOOD, 0, 0.08, 0),
      cyl(0.035, 0.035, 0.3, 4, POST, -0.4, 0.15, -0.34),
      cyl(0.035, 0.035, 0.3, 4, POST, 0.4, 0.15, -0.34),
      cyl(0.035, 0.035, 0.3, 4, POST, -0.4, 0.15, 0.34),
      cyl(0.035, 0.035, 0.3, 4, POST, 0.4, 0.15, 0.34),
      box(1.0, 0.05, 0.05, WOOD_DARK, 0, 0.42, -0.34),
      box(1.0, 0.05, 0.05, WOOD_DARK, 0, 0.42, 0.34),
    ),
  // 水門: 溝に落とし板をはめた木の門
  floodgate: () =>
    merge(
      box(0.9, 0.86, 0.34, WOOD, 0, 0),
      cyl(0.07, 0.07, 1.05, 4, POST, -0.45, 0, 0),
      cyl(0.07, 0.07, 1.05, 4, POST, 0.45, 0, 0),
      box(1.04, 0.1, 0.44, WOOD_DARK, 0, 1.0),
    ),
}

/** 堰は堰高に合わせて縦に伸ばす。ほかは形を焼き込んであるので伸ばさない */
const STRETCHED = new Set<BuildingKind>(['dam', 'floodgate'])

// 里山の木。細く立つ杉、傘の松、群れて生える竹の三種。
const BARK = 0x6b4c33
const CEDAR = 0x3f6b3a
const PINE = 0x4e7f4a
const BAMBOO = 0x5f8f42

/** 杉。細くまっすぐ立ち、上へ行くほど細る */
function cedar(): THREE.BufferGeometry {
  return merge(
    cyl(0.06, 0.1, 0.5, 5, BARK),
    part(new THREE.ConeGeometry(0.32, 0.85, 7), CEDAR, 0, 0.75),
    part(new THREE.ConeGeometry(0.24, 0.7, 7), 0x497a42, 0, 1.25),
    part(new THREE.ConeGeometry(0.14, 0.5, 7), 0x53884a, 0, 1.65),
  )
}

/** 松。幹が曲がり、葉が層になって傘のように広がる */
function pine(): THREE.BufferGeometry {
  const trunk = cyl(0.07, 0.1, 0.7, 5, 0x74563a)
  const layer = (r: number, y: number, c: number) =>
    part(new THREE.CylinderGeometry(r * 0.35, r, 0.16, 8), c, 0, y, 0)
  return merge(trunk, layer(0.44, 0.72, PINE), layer(0.34, 0.94, 0x588b52), layer(0.2, 1.12, 0x639659))
}

/** 竹。細い稈が数本まとまって立ち、上のほうだけ葉を茂らせる */
function bamboo(): THREE.BufferGeometry {
  const culm = (x: number, z: number, h: number, tilt: number) => {
    const g = new THREE.CylinderGeometry(0.035, 0.05, h, 5)
    g.rotateZ(tilt)
    const lean = tilt * h * 0.5
    return merge(
      part(g, 0x9ab45c, x, h / 2, z),
      part(new THREE.IcosahedronGeometry(0.2, 0), BAMBOO, x + lean, h * 0.86, z),
      part(new THREE.IcosahedronGeometry(0.14, 0), 0x6d9c48, x + lean * 1.2, h * 1.02, z + 0.08),
    )
  }
  return merge(
    culm(-0.16, 0.1, 1.2, 0.06),
    culm(0.12, -0.12, 1.45, -0.05),
    culm(0.02, 0.18, 1.0, 0.02),
  )
}

/** 炎。明かりを落とさない素の色で描くので、暗い大雨の空でもよく目立つ */
function flame(): THREE.BufferGeometry {
  return merge(
    part(new THREE.ConeGeometry(0.2, 0.85, 6), 0xff7a1f, 0, 0.42),
    part(new THREE.ConeGeometry(0.1, 0.5, 6), 0xffe066, 0, 0.78),
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
  private readonly flames: THREE.InstancedMesh
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
      instanced(cedar(), solid(), MAX_TREES),
      instanced(pine(), solid(), MAX_TREES),
      instanced(bamboo(), solid(), MAX_TREES),
    ]
    this.people = instanced(person(), solid(), MAX_CITIZENS)
    this.flames = instanced(
      flame(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.9 }),
      MAX_FLAMES,
    )
    this.flames.castShadow = false
    this.flames.receiveShadow = false
    this.group.add(this.sites, ...this.trees, this.people, this.flames)
  }

  update(world: World, alpha: number): void {
    this.updateBuildings(world)
    if (this.treeFrame++ % 15 === 0) this.updateTrees(world)
    this.updatePeople(world, alpha)
    this.updateFlames(world)
  }

  /** 燃えている建物と樹木の上に炎を立てる。勢いに応じて大きくし、少し揺らす */
  private updateFlames(world: World): void {
    const { grid } = world
    let n = 0
    const t = world.tick * 0.35
    const put = (i: number, base: number, heat: number) => {
      if (n >= MAX_FLAMES) return
      const h = Math.min(1, heat)
      const s = 0.32 + h * 0.42 + Math.sin(t + i) * 0.05
      dummy.position.set(grid.xOf(i) + 0.5, base, grid.yOf(i) + 0.5)
      dummy.rotation.set(0, t * 0.5 + i, 0)
      dummy.scale.set(s, s * (1.1 + Math.sin(t * 1.7 + i) * 0.12), s)
      dummy.updateMatrix()
      this.flames.setMatrixAt(n++, dummy.matrix)
    }
    for (const b of world.buildings) {
      // 屋根のあたりから火の手が上がるようにする
      if (b.fire > 0) {
        const top = b.deck > 0 ? b.deck : grid.ground[b.i]
        put(b.i, top + defOf(b.defId).height * 0.85, b.fire)
      }
    }
    for (let i = 0; i < world.treeFire.length; i++) {
      if (world.treeFire[i] > 0) put(i, grid.ground[i] + 0.7, world.treeFire[i])
    }
    this.flames.count = n
    this.flames.instanceMatrix.needsUpdate = true
  }

  private updateBuildings(world: World): void {
    const { grid } = world
    this.counts.clear()
    let sites = 0
    for (const b of world.buildings) {
      const def = defOf(b.defId)
      const x = grid.xOf(b.i) + 0.5
      const z = grid.yOf(b.i) + 0.5
      // 橋は桁の高さに架かる。ほかは地面の上
      const base = b.deck > 0 ? b.deck : grid.ground[b.i]
      if (!b.built) {
        // 傷んだ建物も「建設中」として足場を描く（修理を待っている状態）
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
    const n = [0, 0, 0]
    for (let i = 0; i < world.hasTree.length; i++) {
      if (!world.hasTree[i]) continue
      // 杉が多く、松がまばらに混じり、竹は水辺寄りにひとかたまり
      const r = (Math.imul(i + 7, 2654435761) >>> 0) % 100
      const variant = r < 56 ? 0 : r < 88 ? 1 : 2
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
      const base = grid.walkTop(c.i) // 堰の上にも橋の上にも立つ
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

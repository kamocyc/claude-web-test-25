import * as THREE from 'three'
import { Grid } from '../core/grid'
import { SEASON_RAMP_TICKS } from '../data/constants'
import { Season, SeasonKind } from '../sim/season'

/** 既定の俯角。マウスの上下ドラッグで MIN_PITCH〜MAX_PITCH の間を変えられる */
export const PITCH = 0.92
export const MIN_PITCH = 0.3 // 17°（地平線寄り）
export const MAX_PITCH = 1.45 // 83°（ほぼ真上）
const MIN_DIST = 12
const MAX_DIST = 170

/**
 * 注視点から見たカメラ位置のオフセット（単位ベクトル）。
 * これが視線基底のもとになるので、パンの計算と必ず同じ式から導く。
 */
export function cameraOffset(yaw: number, pitch: number = PITCH): THREE.Vector3 {
  const cp = Math.cos(pitch)
  return new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
}

/**
 * 画面に沿った移動量を世界座標の移動量に直す。
 * dx = 画面右方向、dz = 画面手前方向（奥へ進むときは負の値を渡す）。
 *
 * カメラは target + cameraOffset(yaw) * dist にいて target を見ているので、
 *   画面右   = ( cos yaw, 0, -sin yaw)
 *   画面手前 = ( sin yaw, 0,  cos yaw)
 * となる。yaw の回転を逆向きに当てると、カメラを回したときに W が後退になる。
 */
/** 季節ごとの空と光。平年は澄んだ青、大雨は鉛色で暗く、日照りは白茶けて眩しい */
const SEASON_SKY: Record<SeasonKind, {
  sun: number; sunPower: number; ambient: number; ambientPower: number
  zenith: number; horizon: number; haze: number
}> = {
  normal: {
    sun: 0xfff0d6, sunPower: 2.6, ambient: 0xdcd6c2, ambientPower: 0.72,
    zenith: 0x2f6ea8, horizon: 0xbcd3e0, haze: 0,
  },
  rain: {
    sun: 0x9fb0bc, sunPower: 0.9, ambient: 0xb9c3c9, ambientPower: 0.95,
    zenith: 0x44505c, horizon: 0x8b959c, haze: 0.6,
  },
  drought: {
    sun: 0xffd49a, sunPower: 3.0, ambient: 0xe4d8b8, ambientPower: 0.64,
    zenith: 0x6f7fa0, horizon: 0xdcc9a4, haze: 1,
  },
}

export function panDelta(yaw: number, dx: number, dz: number): { x: number; z: number } {
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  return { x: dx * c + dz * s, z: -dx * s + dz * c }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform float uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  // 地平線より下は遠景の霞として扱う（見下ろす視点では画面の多くがここになる）
  vec3 below = mix(uHorizon, uGround, clamp(-up * 2.2, 0.0, 1.0));
  sky = mix(below, sky, step(0.0, up));
  // 太陽の方向がうっすら明るい
  float sun = pow(max(dot(d, normalize(uSunDir)), 0.0), 8.0);
  sky += vec3(0.35, 0.28, 0.18) * sun * (0.6 + uHaze);
  gl_FragColor = vec4(sky, 1.0);
  // 自前シェーダはトーンマップと sRGB 変換を自分で通す必要がある
  // （通さないと three が線形に直した色をそのまま出してしまい、全体が暗くなる）
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** 3D 見下ろしカメラとレンダラ。 */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly sun: THREE.DirectionalLight
  readonly ambient: THREE.AmbientLight
  private readonly sky: THREE.Mesh
  private readonly skyMat: THREE.ShaderMaterial

  readonly target = new THREE.Vector3()
  yaw = 0.6
  pitch = PITCH
  dist = 60

  private readonly grid: Grid
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly probe = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement, grid: Grid) {
    this.grid = grid
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900)

    // 空。遠景は空の色へ溶かすので、霧の色は地平線と揃える
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0x2f6ea8) },
        uHorizon: { value: new THREE.Color(0xbcd3e0) },
        uGround: { value: new THREE.Color(0x93a4a8) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
        uHaze: { value: 0 },
      },
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    this.scene.add(this.sky)
    this.scene.fog = new THREE.Fog(0xbcd3e0, 90, 330)

    this.ambient = new THREE.AmbientLight(0xdcd6c2, 0.72)
    this.scene.add(this.ambient)
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.6)
    this.sun.position.set(60, 90, 30)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 400
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.08
    // 影の範囲はマップ全体に固定する。カメラに追従させると、範囲の外側で
    // 影マップの端が引き伸ばされて地面に黒い帯が出てしまう。
    // 盤面は 80x80 程度なので、2048px あれば 1 マスあたり十数 px 取れる。
    const span = Math.max(grid.w, grid.h) * 0.8
    const shadowCam = this.sun.shadow.camera
    shadowCam.left = -span
    shadowCam.right = span
    shadowCam.top = span
    shadowCam.bottom = -span
    shadowCam.updateProjectionMatrix()
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
    this.scene.add(new THREE.HemisphereLight(0xaed0e8, 0x9c8b6b, 0.62))

    this.target.set(grid.w / 2, 0, grid.h / 2)
    this.resize()
    addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const w = innerWidth
    const h = innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /**
   * 季節に応じて光と空の色を変える。季節の変わり目は 1 日かけて繋ぐので、
   * 空が徐々に鉛色になっていくのを見て雨支度ができる。
   */
  setSeason(season: Season): void {
    const t = Math.min(1, season.elapsed / SEASON_RAMP_TICKS)
    const a = SEASON_SKY[season.prevKind]
    const b = SEASON_SKY[season.kind]
    const mix = (x: number, y: number) => x + (y - x) * t
    const col = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t)

    this.sun.color.copy(col(a.sun, b.sun))
    this.sun.intensity = mix(a.sunPower, b.sunPower)
    this.ambient.color.copy(col(a.ambient, b.ambient))
    this.ambient.intensity = mix(a.ambientPower, b.ambientPower)
    const u = this.skyMat.uniforms
    ;(u.uZenith.value as THREE.Color).copy(col(a.zenith, b.zenith))
    const horizon = col(a.horizon, b.horizon)
    ;(u.uHorizon.value as THREE.Color).copy(horizon)
    u.uHaze.value = mix(a.haze, b.haze)
    ;(this.scene.fog as THREE.Fog).color.copy(horizon)
  }

  pan(dx: number, dz: number): void {
    const d = panDelta(this.yaw, dx, dz)
    this.target.x += d.x
    this.target.z += d.z
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.grid.w)
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.grid.h)
  }
  zoom(delta: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist * (1 + delta), MIN_DIST, MAX_DIST)
  }
  rotate(delta: number): void {
    this.yaw += delta
  }
  /** 見下ろす角度を変える（正で真上寄り、負で地平線寄り） */
  tilt(delta: number): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch + delta, MIN_PITCH, MAX_PITCH)
  }

  updateCamera(): void {
    const offset = cameraOffset(this.yaw, this.pitch)
    this.camera.position.copy(this.target).addScaledVector(offset, this.dist)
    this.camera.lookAt(this.target)
    this.sky.position.copy(this.camera.position)

    // 太陽はマップ中心の上に固定（影の範囲も固定なので、視点を動かしても影が揺れない）
    const cx = this.grid.w / 2
    const cz = this.grid.h / 2
    this.sun.position.set(cx + 95, 100, cz + 58) // 少し低めの陽射しで影が伸びる
    this.sun.target.position.set(cx, 0, cz)
    this.sun.target.updateMatrixWorld()
  }

  /**
   * 画面座標から地形上の列番号を求める。地形はハイトマップなので、三角形と交差
   * 判定するより視線をレイマーチした方が速くて安定する。当たらなければ -1。
   */
  pickColumn(clientX: number, clientY: number): number {
    this.ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const { origin, direction } = this.raycaster.ray
    const { grid } = this
    const STEP = 0.2
    for (let t = 0; t < 500; t += STEP) {
      this.probe.copy(direction).multiplyScalar(t).add(origin)
      const x = Math.floor(this.probe.x)
      const y = Math.floor(this.probe.z)
      if (!grid.inBounds(x, y)) {
        if (this.probe.y < -2) return -1
        continue
      }
      if (this.probe.y <= grid.ground[grid.idx(x, y)]) return grid.idx(x, y)
    }
    return -1
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}

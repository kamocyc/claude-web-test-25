import * as THREE from 'three'
import { Grid } from '../core/grid'

const PITCH = 0.92
const MIN_DIST = 12
const MAX_DIST = 170

/** 3D 見下ろしカメラとレンダラ。 */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly sun: THREE.DirectionalLight
  readonly ambient: THREE.AmbientLight

  readonly target = new THREE.Vector3()
  yaw = 0.6
  dist = 60

  private readonly grid: Grid
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly probe = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement, grid: Grid) {
    this.grid = grid
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor(0x0d1319)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 800)

    this.scene.fog = new THREE.Fog(0x0d1319, 120, 320)
    this.ambient = new THREE.AmbientLight(0xbfd4e6, 1.1)
    this.scene.add(this.ambient)
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.0)
    this.sun.position.set(60, 90, 30)
    this.scene.add(this.sun)
    this.scene.add(new THREE.HemisphereLight(0x9fc6e8, 0x39301f, 0.6))

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

  /** 季節に応じて日差しの色を変える（乾季は白茶けた強い光） */
  setSeasonLight(drought: number): void {
    const warm = new THREE.Color(0xfff1d8)
    const dry = new THREE.Color(0xffd9a0)
    this.sun.color.copy(warm).lerp(dry, drought)
    this.sun.intensity = 2.0 + drought * 0.5
    this.ambient.intensity = 1.1 - drought * 0.2
  }

  pan(dx: number, dz: number): void {
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    this.target.x += dx * c - dz * s
    this.target.z += dx * s + dz * c
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.grid.w)
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.grid.h)
  }
  zoom(delta: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist * (1 + delta), MIN_DIST, MAX_DIST)
  }
  rotate(delta: number): void {
    this.yaw += delta
  }

  updateCamera(): void {
    const cp = Math.cos(PITCH)
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(PITCH), Math.cos(this.yaw) * cp)
    this.camera.position.copy(this.target).addScaledVector(offset, this.dist)
    this.camera.lookAt(this.target)
    this.sun.position.copy(this.target).add(new THREE.Vector3(40, 80, 25))
    this.sun.target.position.copy(this.target)
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

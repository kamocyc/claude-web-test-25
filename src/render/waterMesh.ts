import * as THREE from 'three'
import { World } from '../core/world'
import { DRY_EPSILON } from '../data/constants'

const VERT = /* glsl */ `
attribute float aDepth;
attribute vec2 aFlow;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorld;
void main() {
  vDepth = aDepth;
  vFlow = aFlow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSunDir;
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorld;
void main() {
  if (vDepth <= 0.004) discard;
  vec3 col = mix(uShallow, uDeep, clamp(vDepth / 1.5, 0.0, 1.0));
  float speed = length(vFlow);
  // 流れの向きに沿ってさざ波をスクロールさせる
  vec2 uv = vWorld.xz * 1.7 - vFlow * uTime * 1.1;
  float ripple = sin(uv.x + uv.y * 0.7) * 0.5 + sin(uv.x * 0.6 - uv.y * 1.3 + uTime * 0.9) * 0.5;
  col += ripple * 0.012 + speed * 0.02;
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
  col += fres * 0.06;
  // 太陽のきらめき
  vec3 h = normalize(normalize(uSunDir) + v);
  col += vec3(1.0, 0.96, 0.88) * pow(max(h.y, 0.0), 220.0) * 0.5;
  // 流れが速いところと岸際に泡
  float foam = smoothstep(0.7, 1.8, speed) + smoothstep(0.2, 0.02, vDepth) * 0.35;
  col = mix(col, vec3(0.55, 0.62, 0.66), clamp(foam, 0.0, 1.0) * 0.45);
  float a = clamp(vDepth * 1.6, 0.0, 0.9) + clamp(foam, 0.0, 1.0) * 0.2;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * 水面メッシュ。列の角ごとに 1 頂点を持つ格子で、頂点の高さは接する列のうち
 * 最も高い水面に合わせる。こうするとダムの越流部が滑らかなスロープになるので、
 * 別途スカートを張らなくても水塊が立体的に見える。
 *
 * 面を張るのは濡れている列だけで、角の水深は「接する 4 列のうち濡れている分」の
 * 平均にする。こうすると水際で水深が 0 に近づき、シェーダ側の discard と
 * アルファで自然に消える。乾いた列にまで面を広げると、片方の角だけが水面に
 * 引っ張られた大きな三角形が陸地の上に描かれてしまう。
 */
export class WaterMesh {
  readonly mesh: THREE.Mesh
  private readonly world: World
  private readonly geom = new THREE.BufferGeometry()
  private readonly positions: Float32Array
  private readonly depths: Float32Array
  private readonly flows: Float32Array
  private readonly index: Uint32Array
  private readonly material: THREE.ShaderMaterial
  private readonly flowTmp = { x: 0, y: 0 }

  constructor(world: World) {
    this.world = world
    const { grid } = world
    const vw = grid.w + 1
    const vh = grid.h + 1
    this.positions = new Float32Array(vw * vh * 3)
    this.depths = new Float32Array(vw * vh)
    this.flows = new Float32Array(vw * vh * 2)

    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const o = (y * vw + x) * 3
        this.positions[o] = x
        this.positions[o + 1] = 0
        this.positions[o + 2] = y
      }
    }
    // 面は毎 tick 組み直す（水のあるセルだけを描く）
    this.index = new Uint32Array(grid.w * grid.h * 6)
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geom.setAttribute('aDepth', new THREE.BufferAttribute(this.depths, 1))
    this.geom.setAttribute('aFlow', new THREE.BufferAttribute(this.flows, 2))
    this.geom.setIndex(new THREE.BufferAttribute(this.index, 1))
    this.geom.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(grid.w / 2, 0, grid.h / 2),
      Math.hypot(grid.w, grid.h),
    )

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0x3f93b4) },
        uDeep: { value: new THREE.Color(0x0e3a55) },
        uSunDir: { value: new THREE.Vector3(45, 85, 28).normalize() },
      },
    })
    this.mesh = new THREE.Mesh(this.geom, this.material)
    this.mesh.renderOrder = 1
    this.mesh.frustumCulled = false
    this.update(0)
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time
    const { grid, water } = this.world
    const vw = grid.w + 1
    const vh = grid.h + 1
    const { positions, depths, flows } = this
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const vi = vy * vw + vx
        let surf = -Infinity
        let sum = 0
        let fx = 0
        let fy = 0
        let n = 0
        let touch = 0
        let solid = 0
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const x = vx + dx
            const y = vy + dy
            if (!grid.inBounds(x, y)) continue
            const i = grid.idx(x, y)
            touch++
            if (grid.ground[i] > solid) solid = grid.ground[i]
            if (water.depth[i] <= DRY_EPSILON) continue
            const s = water.surface(i)
            if (s > surf) surf = s
            sum += water.depth[i]
            water.flowAt(i, this.flowTmp)
            fx += this.flowTmp.x
            fy += this.flowTmp.y
            n++
          }
        }
        // 高さは接する水面のうち最も高いものに合わせる（列の境目に隙間ができない）。
        // 水深は乾いた列を 0 として平均するので、水際へ向かってなだらかに 0 になる。
        positions[vi * 3 + 1] = n > 0 ? surf : solid
        depths[vi] = n > 0 ? sum / touch : 0
        flows[vi * 2] = n > 0 ? fx / n : 0
        flows[vi * 2 + 1] = n > 0 ? fy / n : 0
      }
    }
    ;(this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('aDepth') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('aFlow') as THREE.BufferAttribute).needsUpdate = true
    this.rebuildFaces()
  }

  /**
   * 濡れている列だけ面を張る。乾いた列にまで広げると、その角の高さが隣の地形
   * （崖の天端になることもある）に引っ張られる一方で水深は隣の列のまま残るため、
   * 陸地の上に斜めの水面が描かれてしまう。描画の無駄でもある。
   */
  private rebuildFaces(): void {
    const { grid, water } = this.world
    const vw = grid.w + 1
    const { index } = this
    let n = 0
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (water.depth[grid.idx(x, y)] <= DRY_EPSILON) continue
        const a = y * vw + x
        index[n] = a
        index[n + 1] = a + vw
        index[n + 2] = a + vw + 1
        index[n + 3] = a
        index[n + 4] = a + vw + 1
        index[n + 5] = a + 1
        n += 6
      }
    }
    const attr = this.geom.getIndex() as THREE.BufferAttribute
    attr.needsUpdate = true
    this.geom.setDrawRange(0, n)
  }
}

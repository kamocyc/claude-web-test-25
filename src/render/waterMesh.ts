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
varying float vDepth;
varying vec2 vFlow;
varying vec3 vWorld;
void main() {
  if (vDepth <= 0.004) discard;
  vec3 col = mix(uShallow, uDeep, clamp(vDepth / 2.5, 0.0, 1.0));
  float speed = length(vFlow);
  // 流れの向きに沿ってさざ波をスクロールさせる
  vec2 uv = vWorld.xz * 1.7 - vFlow * uTime * 1.1;
  float ripple = sin(uv.x + uv.y * 0.7) * 0.5 + sin(uv.x * 0.6 - uv.y * 1.3 + uTime * 0.9) * 0.5;
  col += ripple * 0.05 + speed * 0.09;
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0);
  col += fres * 0.22;
  float foam = smoothstep(0.6, 1.6, speed);
  col = mix(col, vec3(0.92, 0.97, 1.0), foam * 0.7);
  // 浅い水ほど薄く。氾濫原の水膜が霞のように見えないようにする
  float a = clamp(vDepth * 1.3, 0.0, 0.82) + foam * 0.25 + fres * 0.1;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
}
`

/**
 * 水面メッシュ。列の角ごとに 1 頂点を持つ格子で、頂点の高さは接する列のうち
 * 最も高い水面に合わせる。こうすると水際は自然に地形へ潜り込み、ダムの越流部は
 * 滑らかなスロープになるので、別途スカートを張らなくても水塊が立体的に見える。
 */
export class WaterMesh {
  readonly mesh: THREE.Mesh
  private readonly world: World
  private readonly geom = new THREE.BufferGeometry()
  private readonly positions: Float32Array
  private readonly depths: Float32Array
  private readonly flows: Float32Array
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
    const index: number[] = []
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const a = y * vw + x
        const b = a + 1
        const c = a + vw
        const d = c + 1
        index.push(a, c, d, a, d, b)
      }
    }
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geom.setAttribute('aDepth', new THREE.BufferAttribute(this.depths, 1))
    this.geom.setAttribute('aFlow', new THREE.BufferAttribute(this.flows, 2))
    this.geom.setIndex(index)
    this.geom.computeBoundingSphere()

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0x63c0d8) },
        uDeep: { value: new THREE.Color(0x14425e) },
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
        let deep = 0
        let fx = 0
        let fy = 0
        let n = 0
        let solid = 0
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const x = vx + dx
            const y = vy + dy
            if (!grid.inBounds(x, y)) continue
            const i = grid.idx(x, y)
            if (grid.ground[i] > solid) solid = grid.ground[i]
            if (water.depth[i] <= DRY_EPSILON) continue
            const s = water.surface(i)
            if (s > surf) surf = s
            if (water.depth[i] > deep) deep = water.depth[i]
            water.flowAt(i, this.flowTmp)
            fx += this.flowTmp.x
            fy += this.flowTmp.y
            n++
          }
        }
        positions[vi * 3 + 1] = n > 0 ? surf : solid
        depths[vi] = n > 0 ? deep : 0
        flows[vi * 2] = n > 0 ? fx / n : 0
        flows[vi * 2 + 1] = n > 0 ? fy / n : 0
      }
    }
    ;(this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('aDepth') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('aFlow') as THREE.BufferAttribute).needsUpdate = true
  }
}

import * as THREE from 'three'
import { World } from '../core/world'
import { BuildingDef } from '../data/buildings'
import { deckHeightFor } from '../sim/structures'

/** 設置プレビュー。置ける場所は青、置けない場所は赤で表示する。 */
export class Ghost {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false })
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material)
    this.mesh.visible = false
    this.mesh.renderOrder = 2
  }

  hide(): void {
    this.mesh.visible = false
  }

  show(world: World, def: BuildingDef, i: number, ok: boolean): void {
    const { grid } = world
    const h = Math.max(0.4, def.kind === 'dig' ? 1 : def.height)
    // 橋は架かる高さ（桁）に浮かせて見せる。掘割は掘ったあとの高さ
    const deck = def.kind === 'bridge' ? deckHeightFor(world, i) : -1
    const base = def.kind === 'dig' ? grid.ground[i] - 1 : deck >= 0 ? deck : grid.ground[i]
    this.mesh.position.set(grid.xOf(i) + 0.5, base + h / 2, grid.yOf(i) + 0.5)
    this.mesh.scale.set(0.95, h, 0.95)
    this.material.color.setHex(ok ? 0x4fc3d9 : 0xd96a5a)
    this.mesh.visible = true
  }
}

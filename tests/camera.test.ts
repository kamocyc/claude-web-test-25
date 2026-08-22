import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PITCH, cameraOffset, panDelta } from '../src/render/scene'

/**
 * パンの向きはカメラの視線から導かれる基底と一致していなければならない。
 * 期待値は panDelta の式ではなく、カメラ位置から cross で求めた実際の基底を使う
 * （式を書き写しただけの自明なテストにしないため）。
 */
function screenBasis(yaw: number): { right: THREE.Vector3; into: THREE.Vector3 } {
  const target = new THREE.Vector3(0, 0, 0)
  const position = target.clone().addScaledVector(cameraOffset(yaw, PITCH), 50)
  const forward = target.clone().sub(position).normalize()
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
  // 画面奥（水平成分だけ取り出す）
  const into = new THREE.Vector3(forward.x, 0, forward.z).normalize()
  return { right, into }
}

const YAWS = [0, 0.6, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, -1.2, 5.7]

describe('カメラのパン', () => {
  it('画面右へのパンはどの向きでもカメラの右方向と一致する', () => {
    for (const yaw of YAWS) {
      const { right } = screenBasis(yaw)
      const d = panDelta(yaw, 1, 0)
      expect(d.x).toBeCloseTo(right.x, 6)
      expect(d.z).toBeCloseTo(right.z, 6)
    }
  })

  it('画面奥へのパン（W）はどの向きでも前進になる', () => {
    for (const yaw of YAWS) {
      const { into } = screenBasis(yaw)
      const d = panDelta(yaw, 0, -1) // main.ts が W で渡す値
      expect(d.x).toBeCloseTo(into.x, 6)
      expect(d.z).toBeCloseTo(into.z, 6)
    }
  })

  it('yaw 90 度では W が -x 方向へ動く（回転しても前進が前進のまま）', () => {
    const d = panDelta(Math.PI / 2, 0, -1)
    expect(d.x).toBeCloseTo(-1, 6)
    expect(d.z).toBeCloseTo(0, 6)
  })

  it('パンは長さを変えない（斜めでも速度が一定）', () => {
    for (const yaw of YAWS) {
      const d = panDelta(yaw, 3, -4)
      expect(Math.hypot(d.x, d.z)).toBeCloseTo(5, 6)
    }
  })
})

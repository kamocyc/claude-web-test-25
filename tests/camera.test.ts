import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MAX_PITCH, MIN_PITCH, PITCH, cameraOffset, panDelta } from '../src/render/scene'

/**
 * パンの向きはカメラの視線から導かれる基底と一致していなければならない。
 * 期待値は panDelta の式ではなく、カメラ位置から cross で求めた実際の基底を使う
 * （式を書き写しただけの自明なテストにしないため）。
 */
function screenBasisAt(yaw: number, pitch = PITCH): { right: THREE.Vector3; into: THREE.Vector3 } {
  const target = new THREE.Vector3(0, 0, 0)
  const position = target.clone().addScaledVector(cameraOffset(yaw, pitch), 50)
  const forward = target.clone().sub(position).normalize()
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
  // 画面奥（水平成分だけ取り出す）
  const into = new THREE.Vector3(forward.x, 0, forward.z).normalize()
  return { right, into }
}

const screenBasis = (yaw: number) => screenBasisAt(yaw)

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

describe('カメラの角度', () => {
  it('俯角を変えてもパンの向きは変わらない（水平面の基底なので）', () => {
    for (const yaw of YAWS) {
      const flat = panDelta(yaw, 1, -1)
      for (const pitch of [MIN_PITCH, 0.6, PITCH, MAX_PITCH]) {
        // dx=1, dz=-1 は「画面右へ 1、画面奥へ 1」
        const { right, into } = screenBasisAt(yaw, pitch)
        expect(flat.x).toBeCloseTo(right.x + into.x, 6)
        expect(flat.z).toBeCloseTo(right.z + into.z, 6)
      }
    }
  })

  it('俯角は決められた範囲に収まり、カメラは必ず注視点より上にいる', () => {
    for (const pitch of [MIN_PITCH, 0.5, PITCH, MAX_PITCH]) {
      const o = cameraOffset(1.0, pitch)
      expect(o.y).toBeGreaterThan(0)
      expect(o.length()).toBeCloseTo(1, 6)
    }
    // 地平線より下や真上を通り越すような角度は許さない
    expect(MIN_PITCH).toBeGreaterThan(0)
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2)
  })
})

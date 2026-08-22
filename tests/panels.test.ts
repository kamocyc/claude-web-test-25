import { describe, expect, it } from 'vitest'
import { parseCollapsed, stringifyCollapsed } from '../src/ui/panels'

/**
 * 畳んであるパネルの覚え書き。ここは localStorage に入る文字列を作るだけで、
 * DOM には触らない（開閉そのものはブラウザで確かめる）。
 */
describe('畳んだパネルの覚え書き', () => {
  it('書いたものがそのまま読める', () => {
    const ids = new Set(['build', 'log'])
    expect(parseCollapsed(stringifyCollapsed(ids))).toEqual(ids)
  })

  it('並びが違っても同じ文字列になる（無駄な書き込みをしない）', () => {
    expect(stringifyCollapsed(new Set(['log', 'build']))).toBe(
      stringifyCollapsed(new Set(['build', 'log'])),
    )
  })

  it('何も無ければ何も畳まない', () => {
    expect(parseCollapsed(null)).toEqual(new Set())
    expect(parseCollapsed('')).toEqual(new Set())
  })

  it('壊れた覚え書きでも落ちず、何も畳まない', () => {
    // ここで例外を投げると、画面が一枚も出ないまま止まる
    expect(parseCollapsed('{')).toEqual(new Set())
    expect(parseCollapsed('{"build":true}')).toEqual(new Set())
    expect(parseCollapsed('"build"')).toEqual(new Set())
  })

  it('文字でないものは捨てる', () => {
    expect(parseCollapsed('["build",3,null,"log"]')).toEqual(new Set(['build', 'log']))
  })
})

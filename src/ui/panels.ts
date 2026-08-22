/**
 * 画面のパネルを畳めるようにする。
 *
 * 見出しの「−」を押すと中身が隠れ、見出しの一行だけが残る（「＋」で戻る）。
 * 村が大きくなると画面の四隅が塞がって地面が見えなくなるので、要らないものを
 * 畳んで避けられるようにする。
 *
 * 中身は **CSS で隠すだけ**で、要素は消さない。建設メニューと住民一覧は
 * ボタンや行の要素を使い回していて、作り直すとクリックが取れなくなるため。
 *
 * 上部のバーだけは `.keep` を付けた行（速度）を残して畳む。丸ごと隠すと
 * 畳んでいるあいだ一時停止も速度も変えられなくなる。
 */

const KEY = 'satoyama.ui.v1'

/** 保存してある「畳んであるパネル」の id。壊れていれば何も畳まない */
export function parseCollapsed(json: string | null): Set<string> {
  if (!json) return new Set()
  try {
    const data = JSON.parse(json) as unknown
    if (!Array.isArray(data)) return new Set()
    return new Set(data.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/** 並びを固定して書き出す（同じ状態なら同じ文字列になる） */
export function stringifyCollapsed(ids: Set<string>): string {
  return JSON.stringify([...ids].sort())
}

/**
 * `.pmin` を持つパネルすべてに開閉を付ける。
 * 畳んだかどうかは localStorage に覚えるので、読み込み直しても畳んだままになる。
 */
export function setupPanels(): void {
  const collapsed = parseCollapsed(read())
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.pmin')) {
    const panel = btn.closest('.panel') as HTMLElement | null
    if (!panel) continue
    apply(panel, btn, collapsed.has(panel.id))
    btn.addEventListener('click', (e) => {
      // 詳細パネルは中のボタンをまとめて拾っているので、そちらへ流さない
      e.stopPropagation()
      const next = !panel.classList.contains('collapsed')
      apply(panel, btn, next)
      if (next) collapsed.add(panel.id)
      else collapsed.delete(panel.id)
      write(stringifyCollapsed(collapsed))
    })
  }
}

function apply(panel: HTMLElement, btn: HTMLButtonElement, collapsed: boolean): void {
  panel.classList.toggle('collapsed', collapsed)
  btn.textContent = collapsed ? '＋' : '−'
  btn.title = collapsed ? '開く' : '畳む'
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function write(json: string): void {
  try {
    localStorage.setItem(KEY, json)
  } catch {
    // 保存できなくても畳めること自体は変わらない
  }
}

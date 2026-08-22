import { World } from '../core/world'
import type { Citizen } from '../core/world'
import {
  AILMENTS,
  AILMENT_LABEL,
  AILMENT_WARN,
  TASK_LABEL,
  ailmentsOf,
  daysText,
  jobNameOf,
  summarize,
  ticksToDeath,
} from '../sim/people'

/** 一覧の 1 行。使い回すために要素を持っておく */
interface Row {
  el: HTMLButtonElement
  name: HTMLElement
  job: HTMLElement
  task: HTMLElement
  marks: HTMLElement
  key: string
}

/**
 * 住民の一覧。
 *
 * 村が大きくなると、誰が飢えているのかを画面の中から探し出せない。
 * 名前・肩書き・いましていること・足りていないものを一枚に並べ、
 * 見出しに「飢え 3」と人数を出す。行を押すとその人を選んで寄る。
 *
 * 行は**使い回す**。毎フレーム innerHTML を作り直すと、押した瞬間に要素が
 * 差し替わってクリックが取れない（並び替えは appendChild で動かすだけなので、
 * 要素は生きたまま入れ替わる）。
 */
export class Roster {
  private readonly panel = document.getElementById('roster') as HTMLElement
  private readonly head = document.getElementById('roster-head') as HTMLElement
  private readonly list = document.getElementById('roster-list') as HTMLElement
  private readonly rows = new Map<number, Row>()
  private lastHead = ''
  private selected = -1
  open = false

  constructor(
    private readonly world: World,
    onSelect: (c: Citizen) => void,
  ) {
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('button')
      if (!row?.dataset.citizen) return
      const c = this.world.citizens.find((x) => x.id === Number(row.dataset.citizen))
      if (c) onSelect(c)
    })
  }

  toggle(): boolean {
    this.open = !this.open
    this.panel.classList.toggle('hidden', !this.open)
    return this.open
  }

  /** 一覧の中で強調する住民（右のパネルで選んでいる人） */
  select(id: number): void {
    if (this.selected === id) return
    this.rows.get(this.selected)?.el.classList.remove('on')
    this.rows.get(id)?.el.classList.add('on')
    this.selected = id
  }

  update(): void {
    if (!this.open) return
    this.updateHead()

    // 困っている人を上に出す。同じ重さなら id 順に固定して、並びが毎フレーム
    // 入れ替わらないようにする
    const order = [...this.world.citizens].sort((a, b) => weight(b) - weight(a) || a.id - b.id)
    const alive = new Set(order.map((c) => c.id))
    for (const [id, row] of this.rows) {
      if (alive.has(id)) continue
      row.el.remove()
      this.rows.delete(id)
    }
    let prev: HTMLElement | null = null
    for (const c of order) {
      const row = this.rows.get(c.id) ?? this.addRow(c)
      this.fill(row, c)
      // 並びが変わったときだけ動かす（動かすだけなので要素は生きている）
      const want: Element | null = prev ? prev.nextElementSibling : this.list.firstElementChild
      if (want !== row.el) this.list.insertBefore(row.el, want)
      prev = row.el
    }
  }

  private updateHead(): void {
    const s = summarize(this.world)
    const chips: string[] = [`<span class="chip">${s.total} 人</span>`]
    for (const kind of AILMENTS) {
      if (s.severe[kind] > 0) {
        chips.push(`<span class="chip bad">${AILMENT_LABEL[kind]} ${s.severe[kind]}</span>`)
      } else if (s.warn[kind] > 0) {
        chips.push(`<span class="chip warn">${AILMENT_WARN[kind]} ${s.warn[kind]}</span>`)
      }
    }
    if (s.jobless > 0) chips.push(`<span class="chip">無役 ${s.jobless}</span>`)
    const html = chips.join('')
    if (html === this.lastHead) return
    this.lastHead = html
    this.head.innerHTML = html
  }

  private addRow(c: Citizen): Row {
    const el = document.createElement('button')
    el.className = 'prow'
    el.dataset.citizen = String(c.id)
    el.innerHTML =
      '<span class="pname"></span><span class="pjob"></span>' +
      '<span class="ptask"></span><span class="pmarks"></span>'
    if (c.id === this.selected) el.classList.add('on')
    this.list.appendChild(el)
    const row: Row = {
      el,
      name: el.querySelector('.pname') as HTMLElement,
      job: el.querySelector('.pjob') as HTMLElement,
      task: el.querySelector('.ptask') as HTMLElement,
      marks: el.querySelector('.pmarks') as HTMLElement,
      key: '',
    }
    this.rows.set(c.id, row)
    return row
  }

  private fill(row: Row, c: Citizen): void {
    const job = jobNameOf(this.world, c)
    const task = TASK_LABEL[c.task]
    const bad = ailmentsOf(c)
    const left = ticksToDeath(c)
    const key = `${job}|${task}|${bad.map((a) => a.kind + (a.severe ? '!' : '')).join(',')}|${
      left === null ? '' : Math.round(left / 12)
    }`
    if (row.key === key) return
    row.key = key
    row.name.textContent = c.name
    row.job.textContent = job
    row.task.textContent = task
    row.marks.innerHTML =
      bad
        .map((a) =>
          a.severe
            ? `<i class="bad">${AILMENT_LABEL[a.kind]}</i>`
            : `<i class="warn">${AILMENT_WARN[a.kind]}</i>`,
        )
        .join('') + (left === null ? '' : `<i class="bad">あと${daysText(left)}</i>`)
    row.el.classList.toggle('dying', left !== null)
  }
}

/** 並べ替えの重み。尽きている人がいちばん上 */
function weight(c: Citizen): number {
  let w = 0
  for (const a of ailmentsOf(c)) w += a.severe ? 10 : 1
  if (c.starveKind !== '') w += 100
  return w
}

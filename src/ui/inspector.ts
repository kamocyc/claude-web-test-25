import { World } from '../core/world'
import type { Building, Citizen } from '../core/world'
import { defOf } from '../data/buildings'
import {
  CROP_GROW_TICKS,
  FLOODGATE_MAX_HEIGHT,
  JOB_PRIORITIES,
  JOB_PRIORITY_LABEL,
  LOAD_CAP,
  NEED_SEEK_THRESHOLD,
  ROUTE_RATE,
} from '../data/constants'
import { Logistics, ROUTE_LABEL } from '../sim/logistics'
import { demolish, setGateHeight } from '../sim/structures'
import { canFlood } from '../sim/flood'
import { idleByWater } from '../sim/production'
import {
  AILMENT_LABEL,
  AILMENT_WARN,
  TASK_LABEL,
  ailmentsOf,
  daysText,
  jobNameOf,
  shortageOf,
  ticksToDeath,
} from '../sim/people'

type Selection = { kind: 'building'; id: number } | { kind: 'citizen'; id: number } | null

/**
 * 右側の選択パネル。水門の堰高もここで変える。
 *
 * 骨組みは選択が変わったときだけ組み立て、毎 tick 変わる値だけを書き換える。
 * 毎フレーム innerHTML を作り直すとボタンが差し替わってクリックできなくなるため。
 */
export class Inspector {
  private readonly el = document.getElementById('inspector') as HTMLElement
  /** 骨組みを書き込む先。畳むための見出しは外に置いてあるので、そこは触らない */
  private readonly body = document.getElementById('insp-body') as HTMLElement
  private selection: Selection = null
  private key = ''
  private dyn: HTMLElement | null = null

  constructor(
    private readonly world: World,
    private readonly logistics: Logistics,
  ) {
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      const b = this.currentBuilding()
      if (!b) return
      if (btn.dataset.gate !== undefined) {
        setGateHeight(this.world, b, Number(btn.dataset.gate))
        this.update()
      } else if (btn.dataset.prio !== undefined) {
        // 次に割り当てを見直す tick（10 tick ごと）で効く
        b.priority = Number(btn.dataset.prio)
        this.update()
      } else if (btn.dataset.action === 'demolish') {
        demolish(this.world, b)
        this.clear()
      }
    })
  }

  selectBuilding(b: Building): void {
    this.selection = { kind: 'building', id: b.id }
    this.update()
  }
  selectCitizen(c: Citizen): void {
    this.selection = { kind: 'citizen', id: c.id }
    this.update()
  }
  clear(): void {
    this.selection = null
    this.key = ''
    this.dyn = null
    this.el.classList.add('hidden')
  }

  private currentBuilding(): Building | undefined {
    if (this.selection?.kind !== 'building') return undefined
    return this.world.buildingById(this.selection.id)
  }

  update(): void {
    const sel = this.selection
    if (!sel) return
    if (sel.kind === 'building') {
      const b = this.world.buildingById(sel.id)
      if (!b) return this.clear()
      this.ensureFrame(`b${b.id}`, () => this.buildingFrame(b))
      if (this.dyn) this.dyn.innerHTML = this.buildingBody(b)
      for (const btn of this.body.querySelectorAll<HTMLButtonElement>('button[data-gate]')) {
        btn.classList.toggle('on', Number(btn.dataset.gate) === b.gateHeight)
      }
      for (const btn of this.body.querySelectorAll<HTMLButtonElement>('button[data-prio]')) {
        btn.classList.toggle('on', Number(btn.dataset.prio) === b.priority)
      }
    } else {
      const c = this.world.citizens.find((x) => x.id === sel.id)
      if (!c) return this.clear()
      this.ensureFrame(`c${c.id}`, () => `<h2>${c.name}</h2><div id="insp-dyn"></div>`)
      if (this.dyn) this.dyn.innerHTML = this.citizenBody(c)
    }
    this.el.classList.remove('hidden')
  }

  private ensureFrame(key: string, html: () => string): void {
    if (this.key === key && this.dyn?.isConnected) return
    this.key = key
    this.body.innerHTML = html()
    this.dyn = this.body.querySelector('#insp-dyn')
  }

  private buildingFrame(b: Building): string {
    const def = defOf(b.defId)
    const parts = [`<h2>${def.name}</h2>`, `<div class="cost">${def.desc}</div>`, '<div id="insp-dyn"></div>']
    if (def.workers > 0) {
      parts.push(
        '<div class="cost" style="margin-top:6px" title="高くすると、手が足りないときに優先度の低い職場から人が移ってくる">働き手の優先</div><div class="gate">',
      )
      // 高いほうを左に並べる（押したときの強さの順が目で分かる）
      for (const p of [...JOB_PRIORITIES].reverse()) {
        parts.push(`<button data-prio="${p}">${JOB_PRIORITY_LABEL[p]}</button>`)
      }
      parts.push('</div>')
    }
    if (def.kind === 'floodgate') {
      parts.push('<div class="cost" style="margin-top:6px">堰の高さ</div><div class="gate">')
      for (let h = 0; h <= FLOODGATE_MAX_HEIGHT; h++) parts.push(`<button data-gate="${h}">${h}</button>`)
      parts.push('</div>')
    }
    parts.push('<div class="gate"><button data-action="demolish">撤去</button></div>')
    return parts.join('')
  }

  private buildingBody(b: Building): string {
    const def = defOf(b.defId)
    const parts: string[] = []
    if (b.fire > 0) {
      parts.push(bar('火の勢い', b.fire))
      parts.push(`<div class="cost">${b.detected ? '火消しが向かっている' : 'まだ誰も気づいていない'}</div>`)
    }
    if (!b.built) {
      parts.push(bar(b.damaged ? '修理' : '建設', b.buildProgress / Math.max(1, def.buildPoints)))
      if (b.damaged) parts.push('<div class="cost">浸水で傷んだ — 直しに来るのを待っている</div>')
      return parts.join('')
    }
    const depth = this.world.water.depth[b.i]
    if (depth > 0.05 && canFlood(b)) {
      parts.push(`<div class="cost">水が来ている（深さ ${depth.toFixed(2)}）</div>`)
    }
    if (def.recipe) {
      const crop = def.kind === 'farm' || def.kind === 'paddy'
      const goal = crop ? CROP_GROW_TICKS : def.recipe.ticks
      parts.push(bar(crop ? '生育' : '生産', b.progress / goal))
      parts.push(`<div class="cost">${b.status || '待機中'}</div>`)
    }
    if (def.recipe && Object.keys(def.recipe.out).length > 0) {
      const route = this.logistics.routeOf(b.id)
      parts.push(
        `<div class="cost">荷 ${Math.floor(b.load)} / ${LOAD_CAP}` +
          ` ・ ${ROUTE_LABEL[route]} ${ROUTE_RATE[route]}／日</div>`,
      )
    }
    if (def.workers > 0) {
      // 人が来ていない持ち場は赤で出す。上部の「人手不足 N」の内訳がここにあたる
      const short = def.workers - b.workers.length > 0 && !idleByWater(this.world, b)
      parts.push(
        `<div class="cost${short ? ' bad-text' : ''}">働き手 ${b.workers.length} / ${def.workers}` +
          `${short ? ' — 人手が足りない' : ''}</div>`,
      )
    }
    if (def.storage) parts.push(`<div class="cost">保管容量 +${def.storage}</div>`)
    if (def.housing) parts.push(`<div class="cost">寝床 ${def.housing}</div>`)
    return parts.join('')
  }

  private citizenBody(c: Citizen): string {
    const parts = [
      `<div class="cost">${jobNameOf(this.world, c)} ・ ${TASK_LABEL[c.task]}</div>`,
    ]
    const bad = ailmentsOf(c)
    if (bad.length > 0) {
      const marks = bad
        .map((a) =>
          a.severe
            ? `<i class="bad">${AILMENT_LABEL[a.kind]}</i>`
            : `<i class="warn">${AILMENT_WARN[a.kind]}</i>`,
        )
        .join('')
      parts.push(`<div class="pmarks">${marks}</div>`)
    }
    // 欲しがっているのに蔵が空なら、当人ではなく村の側に原因がある
    const short = shortageOf(this.world)
    if (short.water && c.needs.water < NEED_SEEK_THRESHOLD) {
      parts.push('<div class="cost bad-text">蔵に水が無い — 飲みに行けない</div>')
    }
    if (short.food && c.needs.food < NEED_SEEK_THRESHOLD) {
      parts.push('<div class="cost bad-text">蔵に食べ物が無い</div>')
    }
    const left = ticksToDeath(c)
    if (left !== null) {
      parts.push(`<div class="cost bad-text">このままだと あと${daysText(left)} で力尽きる</div>`)
    }
    parts.push(bar('水', c.needs.water), bar('食料', c.needs.food), bar('休息', c.needs.sleep))
    return parts.join('')
  }
}

function bar(label: string, v: number): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100)
  return `<div class="cost">${label}</div><div class="bar${p < 30 ? ' low' : ''}"><i style="width:${p}%"></i></div>`
}

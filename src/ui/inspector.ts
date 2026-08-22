import { World } from '../core/world'
import type { Building, Citizen } from '../core/world'
import { defOf } from '../data/buildings'
import { CROP_GROW_TICKS, FLOODGATE_MAX_HEIGHT, LOAD_CAP, ROUTE_RATE } from '../data/constants'
import { Logistics, ROUTE_LABEL } from '../sim/logistics'
import { demolish, setGateHeight } from '../sim/structures'

type Selection = { kind: 'building'; id: number } | { kind: 'citizen'; id: number } | null

const TASK_LABEL: Record<string, string> = {
  idle: '手すき',
  drink: '水を飲みに行く',
  eat: '食事に行く',
  sleep: '休んでいる',
  work: '働いている',
  build: '建設している',
}

/**
 * 右側の選択パネル。水門の堰高もここで変える。
 *
 * 骨組みは選択が変わったときだけ組み立て、毎 tick 変わる値だけを書き換える。
 * 毎フレーム innerHTML を作り直すとボタンが差し替わってクリックできなくなるため。
 */
export class Inspector {
  private readonly el = document.getElementById('inspector') as HTMLElement
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
      for (const btn of this.el.querySelectorAll<HTMLButtonElement>('button[data-gate]')) {
        btn.classList.toggle('on', Number(btn.dataset.gate) === b.gateHeight)
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
    this.el.innerHTML = html()
    this.dyn = this.el.querySelector('#insp-dyn')
  }

  private buildingFrame(b: Building): string {
    const def = defOf(b.defId)
    const parts = [`<h2>${def.name}</h2>`, `<div class="cost">${def.desc}</div>`, '<div id="insp-dyn"></div>']
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
    if (!b.built) {
      parts.push(bar('建設', b.buildProgress / Math.max(1, def.buildPoints)))
      return parts.join('')
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
    if (def.workers > 0) parts.push(`<div class="cost">働き手 ${b.workers.length} / ${def.workers}</div>`)
    if (def.storage) parts.push(`<div class="cost">保管容量 +${def.storage}</div>`)
    if (def.housing) parts.push(`<div class="cost">寝床 ${def.housing}</div>`)
    return parts.join('')
  }

  private citizenBody(c: Citizen): string {
    const job = c.jobId >= 0 ? this.world.buildingById(c.jobId) : undefined
    return [
      `<div class="cost">${TASK_LABEL[c.task] ?? ''}${job ? ` — ${defOf(job.defId).name}` : ''}</div>`,
      bar('水', c.needs.water),
      bar('食料', c.needs.food),
      bar('休息', c.needs.sleep),
    ].join('')
  }
}

function bar(label: string, v: number): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100)
  return `<div class="cost">${label}</div><div class="bar${p < 30 ? ' low' : ''}"><i style="width:${p}%"></i></div>`
}

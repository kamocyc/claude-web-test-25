import { World } from '../core/world'
import { BUILDINGS, BuildingDef, RESOURCE_LABEL, ResourceKind } from '../data/buildings'

const CATEGORY_LABEL: Record<BuildingDef['category'], string> = {
  water: '水を操る',
  terrain: '地形',
  living: '暮らし',
  industry: '生産',
}

/** 左側の建設メニュー。 */
export class BuildMenu {
  selected: BuildingDef | null = null
  private readonly list = document.getElementById('build-list') as HTMLElement
  private readonly buttons = new Map<string, HTMLButtonElement>()

  constructor(private readonly onSelect: (def: BuildingDef | null) => void) {
    const cats: BuildingDef['category'][] = ['water', 'terrain', 'living', 'industry']
    for (const cat of cats) {
      const box = document.createElement('div')
      box.className = 'bcat'
      box.innerHTML = `<h3>${CATEGORY_LABEL[cat]}</h3>`
      for (const def of BUILDINGS) {
        if (def.category !== cat || def.kind === 'district') continue
        const btn = document.createElement('button')
        btn.className = 'bitem'
        btn.innerHTML = `${def.name}<br /><span class="cost">${costText(def)}</span>`
        btn.title = def.desc
        btn.addEventListener('click', () => this.select(def))
        box.appendChild(btn)
        this.buttons.set(def.id, btn)
      }
      this.list.appendChild(box)
    }
  }

  select(def: BuildingDef | null): void {
    this.selected = this.selected === def ? null : def
    for (const [id, btn] of this.buttons) btn.classList.toggle('selected', this.selected?.id === id)
    this.onSelect(this.selected)
  }

  update(world: World): void {
    for (const [id, btn] of this.buttons) {
      const def = BUILDINGS.find((b) => b.id === id)
      if (!def) continue
      btn.classList.toggle('poor', !world.hasStock(def.cost))
    }
  }
}

function costText(def: BuildingDef): string {
  const parts = (Object.keys(def.cost) as ResourceKind[]).map(
    (k) => `${RESOURCE_LABEL[k]}${def.cost[k]}`,
  )
  if (def.workers > 0) parts.push(`働き手${def.workers}`)
  return parts.length > 0 ? parts.join(' / ') : '資材不要'
}

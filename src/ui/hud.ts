import { World } from '../core/world'
import { RESOURCES, RESOURCE_LABEL } from '../data/buildings'

export type StorageAction = 'save' | 'load' | 'sample'

/** 画面上部の資源・季節・速度表示。 */
export class Hud {
  private readonly resources = document.getElementById('resources') as HTMLElement
  private readonly season = document.getElementById('season') as HTMLElement
  private readonly population = document.getElementById('population') as HTMLElement
  private readonly logBox = document.getElementById('log') as HTMLElement
  private lastLog = ''

  constructor(onSpeed: (speed: number) => void, onStorage: (action: StorageAction) => void) {
    const storage = document.getElementById('storage') as HTMLElement
    storage.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (btn?.dataset.store) onStorage(btn.dataset.store as StorageAction)
    })

    const speedBox = document.getElementById('speed') as HTMLElement
    speedBox.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      for (const b of speedBox.querySelectorAll('button')) b.classList.remove('active')
      btn.classList.add('active')
      onSpeed(Number(btn.dataset.speed))
    })
  }

  update(world: World): void {
    const cap = world.capacity
    this.resources.innerHTML = RESOURCES.map((k) => {
      const v = Math.floor(world.stock[k])
      const full = cap > 0 && v >= cap ? ' full' : ''
      return `<span class="res${full}">${RESOURCE_LABEL[k]} <b>${v}</b><span class="cost">/${cap}</span></span>`
    }).join('')

    const s = world.season
    const drought = s.kind === 'drought'
    this.season.className = `chip${drought ? ' drought' : ''}`
    this.season.textContent = `${drought ? '乾季' : '温暖期'} ・ ${s.day + 1}日目 ・ ${
      drought ? '残り' : '次の乾季まで'
    }${s.daysLeft}日`
    this.population.textContent = `人口 ${world.citizens.length} / ${world.housing}`

    // 件数だけで見ると、ロードで中身が入れ替わったときに更新されない
    const logKey = `${world.log.length}:${world.log[world.log.length - 1] ?? ''}`
    if (logKey !== this.lastLog) {
      this.lastLog = logKey
      this.logBox.innerHTML = world.log.slice(-8).map((l) => `<div>${l}</div>`).join('')
      this.logBox.scrollTop = this.logBox.scrollHeight
    }
  }
}

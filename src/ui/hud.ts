import { World } from '../core/world'
import { RESOURCES, RESOURCE_LABEL } from '../data/buildings'

/** 画面上部の資源・季節・速度表示。 */
export class Hud {
  private readonly resources = document.getElementById('resources') as HTMLElement
  private readonly season = document.getElementById('season') as HTMLElement
  private readonly population = document.getElementById('population') as HTMLElement
  private readonly logBox = document.getElementById('log') as HTMLElement
  private lastLog = 0

  constructor(onSpeed: (speed: number) => void, onStorage: (action: 'save' | 'load') => void) {
    const storage = document.getElementById('storage') as HTMLElement
    storage.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (btn?.dataset.store) onStorage(btn.dataset.store as 'save' | 'load')
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

    if (world.log.length !== this.lastLog) {
      this.lastLog = world.log.length
      this.logBox.innerHTML = world.log.slice(-8).map((l) => `<div>${l}</div>`).join('')
      this.logBox.scrollTop = this.logBox.scrollHeight
    }
  }
}

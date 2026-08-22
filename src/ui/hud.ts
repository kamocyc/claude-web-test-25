import { World } from '../core/world'
import { RESOURCES, RESOURCE_LABEL } from '../data/buildings'
import { SEASON_LABEL } from '../sim/season'

export type StorageAction = 'save' | 'load' | 'sample'

/** 画面上部の資源・季節・速度表示。 */
export class Hud {
  private readonly resources = document.getElementById('resources') as HTMLElement
  private readonly season = document.getElementById('season') as HTMLElement
  private readonly population = document.getElementById('population') as HTMLElement
  private readonly logBox = document.getElementById('log') as HTMLElement
  private lastLog = ''
  private lastResources = ''
  private lastSeason = ''

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
    // 毎フレーム innerHTML を書き換えるとレイアウトが走り続けるので、変化したときだけ差し替える
    const cap = world.capacity
    const html = RESOURCES.map((k) => {
      const v = Math.floor(world.stock[k])
      const full = cap > 0 && v >= cap ? ' full' : ''
      return `<span class="res${full}">${RESOURCE_LABEL[k]} <b>${v}</b><span class="cost">/${cap}</span></span>`
    }).join('')
    if (html !== this.lastResources) {
      this.lastResources = html
      this.resources.innerHTML = html
    }

    const s = world.season
    // 次の季節は前触れが出るまで伏せる（残り 2 日を切ると分かる）
    const omen = s.forecast ? `${SEASON_LABEL[s.forecast]}の兆し` : '次は？'
    const season = `${SEASON_LABEL[s.kind]} ・ ${s.day + 1}日目 ・ 残り${s.daysLeft}日 ・ ${omen}` +
      `|${world.citizens.length}/${world.housing}`
    if (season !== this.lastSeason) {
      this.lastSeason = season
      this.season.className = `chip ${s.kind}`
      this.season.textContent = season.split('|')[0]
      this.population.textContent = `人口 ${world.citizens.length} / ${world.housing}`
    }

    // 件数だけで見ると、ロードで中身が入れ替わったときに更新されない
    const logKey = `${world.log.length}:${world.log[world.log.length - 1] ?? ''}`
    if (logKey !== this.lastLog) {
      this.lastLog = logKey
      this.logBox.innerHTML = world.log.slice(-8).map((l) => `<div>${l}</div>`).join('')
      this.logBox.scrollTop = this.logBox.scrollHeight
    }
  }
}

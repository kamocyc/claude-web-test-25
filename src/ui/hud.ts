import { World } from '../core/world'
import { RESOURCES, RESOURCE_LABEL } from '../data/buildings'
import { SEASON_LABEL, severeDayRange } from '../sim/season'
import { AILMENTS, AILMENT_LABEL, summarize } from '../sim/people'

export type StorageAction = 'save' | 'load' | 'sample'

/** 画面上部の資源・季節・速度表示。 */
export class Hud {
  private readonly resources = document.getElementById('resources') as HTMLElement
  private readonly season = document.getElementById('season') as HTMLElement
  private readonly population = document.getElementById('population') as HTMLElement
  private readonly trouble = document.getElementById('trouble') as HTMLElement
  private readonly logBox = document.getElementById('log') as HTMLElement
  private lastLog = ''
  private lastResources = ''
  private lastSeason = ''
  private lastScale = 0
  private lastTrouble = ''
  private readonly harshBox = document.getElementById('harsh') as HTMLElement

  constructor(
    onSpeed: (speed: number) => void,
    onStorage: (action: StorageAction) => void,
    onSevere: (scale: number) => void,
  ) {
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

    this.harshBox.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn?.dataset.harsh) return
      onSevere(Number(btn.dataset.harsh))
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

    // 需要が尽きている人数は、一覧を開いていなくても目に入るようにする
    const people = summarize(world)
    const trouble = AILMENTS.filter((k) => people.severe[k] > 0)
      .map((k) => `${AILMENT_LABEL[k]} ${people.severe[k]}`)
      .join(' ・ ')
    if (trouble !== this.lastTrouble) {
      this.lastTrouble = trouble
      this.trouble.textContent = trouble
      this.trouble.classList.toggle('hidden', trouble === '')
    }

    // 荒天の長さは読み込みでも変わるので、押した瞬間ではなく世界の値を見て塗る
    if (s.severeScale !== this.lastScale) {
      this.lastScale = s.severeScale
      const [lo, hi] = severeDayRange(s.severeScale)
      for (const b of this.harshBox.querySelectorAll('button')) {
        b.classList.toggle('active', Number(b.dataset.harsh) === s.severeScale)
      }
      this.harshBox.title = `大雨と日照りが ${lo}〜${hi} 日続く。次の季節から効く（荒天のさなかなら残りも伸び縮みする）`
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

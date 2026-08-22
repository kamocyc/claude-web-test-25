import { World } from '../core/world'
import type { Citizen } from '../core/world'
import { defOf } from '../data/buildings'
import { NEED_SEEK_THRESHOLD, STARVE_TICKS, TICKS_PER_DAY } from '../data/constants'

/** 住民が抱えている不足。三つの需要にそのまま対応する */
export type Ailment = 'water' | 'food' | 'sleep'

export const AILMENTS: readonly Ailment[] = ['water', 'food', 'sleep']

/** 需要が尽きている（放っておくと死ぬ） */
export const AILMENT_LABEL: Record<Ailment, string> = {
  water: '渇き',
  food: '飢え',
  sleep: '寝不足',
}

/** 需要が減って充足行動に移っている（まだ死なない） */
export const AILMENT_WARN: Record<Ailment, string> = {
  water: '喉が渇いた',
  food: 'ひもじい',
  sleep: '眠い',
}

export const TASK_LABEL: Record<Citizen['task'], string> = {
  idle: '手すき',
  drink: '水を飲みに行く',
  eat: '食事に行く',
  sleep: '休んでいる',
  work: '働いている',
  build: '建設している',
  fight: '火を消している',
}

/** 何を切らしているか。severe = 尽きている、warn = 減ってきている */
export function ailmentsOf(c: Citizen): { kind: Ailment; severe: boolean }[] {
  const out: { kind: Ailment; severe: boolean }[] = []
  for (const kind of AILMENTS) {
    const v = c.needs[kind]
    if (v <= 0) out.push({ kind, severe: true })
    else if (v < NEED_SEEK_THRESHOLD) out.push({ kind, severe: false })
  }
  return out
}

/**
 * 村として切らしているもの。
 *
 * 蔵に水が無ければ、喉が渇いていても住民は飲みに行かない（行っても飲めない）。
 * 判定は citizens.ts の drink / eat の枝とそろえてあり、両方ともこの関数を見る。
 * 「なぜ飲みに行かないのか」を画面に出すのに使う。
 */
export function shortageOf(world: World): { water: boolean; food: boolean } {
  return {
    water: world.stock.water < 1,
    food: world.stock.meal < 1 && world.stock.wheat < 1,
  }
}

/** 力尽きるまでの残り tick（尽きかけていなければ null） */
export function ticksToDeath(c: Citizen): number | null {
  if (c.starveKind === '') return null
  return Math.max(0, STARVE_TICKS - c.starveTicks)
}

/** 住民の肩書き。職場が無ければ何をしているかで代える */
export function jobNameOf(world: World, c: Citizen): string {
  if (c.jobId >= 0) {
    const job = world.buildingById(c.jobId)
    if (job) return defOf(job.defId).name
  }
  return c.task === 'build' ? '普請' : '手間'
}

export interface VillageSummary {
  total: number
  /** 尽きている人数 */
  severe: Record<Ailment, number>
  /** 減ってきている人数 */
  warn: Record<Ailment, number>
  /** 職場に配属されていない人数 */
  jobless: number
  /** いま何もしていない人数 */
  idle: number
  /** このまま何もしなければ力尽きる人数 */
  dying: number
}

/** 村ぜんたいの様子をひとまとめにする（画面上部と一覧の見出しに使う） */
export function summarize(world: World): VillageSummary {
  const zero = (): Record<Ailment, number> => ({ water: 0, food: 0, sleep: 0 })
  const out: VillageSummary = {
    total: world.citizens.length,
    severe: zero(),
    warn: zero(),
    jobless: 0,
    idle: 0,
    dying: 0,
  }
  for (const c of world.citizens) {
    for (const a of ailmentsOf(c)) {
      if (a.severe) out.severe[a.kind]++
      else out.warn[a.kind]++
    }
    if (c.jobId < 0) out.jobless++
    if (c.task === 'idle') out.idle++
    if (c.starveKind !== '') out.dying++
  }
  return out
}

/** 力尽きたときのログ。先に尽きた需要をそのまま理由にする */
export function deathLog(c: Citizen): string {
  const why = c.starveKind === 'water' ? '渇きで' : c.starveKind === 'food' ? '飢えで' : ''
  return `${c.name} が${why}力尽きた…`
}

/** 余命を日数の文字にする */
export function daysText(ticks: number): string {
  const days = ticks / TICKS_PER_DAY
  return days >= 1 ? `${days.toFixed(1)}日` : `${Math.round(days * 24)}時間`
}

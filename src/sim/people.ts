import { World } from '../core/world'
import type { Citizen } from '../core/world'
import { defOf } from '../data/buildings'
import { NEED_SEEK_THRESHOLD, STARVE_TICKS, TICKS_PER_DAY } from '../data/constants'
import { idleByWater } from './production'

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

/** 働き手の足りていない職場ひとつ */
export interface StaffGap {
  /** 建物 id（押してその建物へ寄るのに使う） */
  id: number
  /** 列番号 */
  i: number
  name: string
  /** 足りない人数 */
  missing: number
}

export interface Staffing {
  /** 働き手の要る持ち場の総数 */
  slots: number
  /** 埋まっている数 */
  filled: number
  /** 足りない人数（= slots - filled） */
  missing: number
  /** どこが足りないか。足りない数の多い順、同じなら建て順 */
  gaps: StaffGap[]
}

/**
 * 人手の過不足。
 *
 * 「無役 N」（`summarize().jobless`）とは別のものを数えている。あちらは
 * *職に就いていない人*、こちらは *人の来ていない持ち場*で、村の人数が足りていれば
 * 前者だけが立ち、職場を建てすぎていれば後者だけが立つ。
 *
 * 建設中・修理待ちの建物は数えない（要るのは人手ではなく普請）。水に浸かった職場も
 * 数えない。あそこは assignJobs が承知の上で人を外している（`idleByWater`）ので、
 * 人手不足と言うと直しようのない不足がいつまでも出続ける。
 *
 * 数えるのは *配属* であって *出勤* ではない。出勤（`staffPresent`）は水を飲みに
 * 行っただけでも欠けるので、tick ごとに揺れて読み物にならない。
 */
export function staffingOf(world: World): Staffing {
  const out: Staffing = { slots: 0, filled: 0, missing: 0, gaps: [] }
  for (const b of world.buildings) {
    const def = defOf(b.defId)
    if (!b.built || def.workers <= 0 || idleByWater(world, b)) continue
    out.slots += def.workers
    const filled = Math.min(def.workers, b.workers.length)
    out.filled += filled
    const missing = def.workers - filled
    if (missing > 0) out.gaps.push({ id: b.id, i: b.i, name: def.name, missing })
  }
  out.missing = out.slots - out.filled
  out.gaps.sort((a, b) => b.missing - a.missing || a.id - b.id)
  return out
}

/**
 * 「踏車 1・杣小屋 2」のような一行にまとめる。
 * 同じ種類の職場は足し合わせる（「船着場 1・船着場 1」では読めない）。
 */
export function gapsText(gaps: readonly StaffGap[]): string {
  const byName = new Map<string, number>()
  for (const g of gaps) byName.set(g.name, (byName.get(g.name) ?? 0) + g.missing)
  return [...byName]
    .sort((a, b) => b[1] - a[1])
    .map(([name, missing]) => `${name} ${missing}`)
    .join('・')
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

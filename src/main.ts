import * as THREE from 'three'
import { Game } from './core/game'
import { TICK_DT } from './data/constants'
import { BuildingDef } from './data/buildings'
import { canPlace, place } from './sim/structures'
import { SceneView } from './render/scene'
import { TerrainMesh } from './render/terrainMesh'
import { WaterMesh } from './render/waterMesh'
import { EntityMeshes } from './render/entityMesh'
import { BoatMeshes } from './render/boatMesh'
import { Ghost } from './render/ghost'
import { Hud } from './ui/hud'
import { BuildMenu } from './ui/buildMenu'
import { Inspector } from './ui/inspector'
import { Roster } from './ui/roster'
import { deserializeInto, loadFromStorage, saveToStorage, serialize } from './save/save'
import { createSampleGame } from './data/sampleTown'

const canvas = document.getElementById('view') as HTMLCanvasElement
const game = new Game({ w: 80, h: 80, seed: Math.floor(Math.random() * 1e6) })
const world = game.world

const view = new SceneView(canvas, world.grid)
const terrain = new TerrainMesh(world)
const water = new WaterMesh(world)
const entities = new EntityMeshes()
const boats = new BoatMeshes()
const ghost = new Ghost()
view.scene.add(terrain.group, water.mesh, entities.group, boats.group, ghost.mesh)
centerOn(world.startI)

// デバッグ用に主要オブジェクトを公開する（レイヤの表示切り替えなどに使う）
;(window as unknown as { game: unknown }).game = { game, view, terrain, water, entities, boats }

const inspector = new Inspector(world, game.logistics)
const hud = new Hud(
  (s) => {
    speed = s
  },
  (action) => {
    if (action === 'save') {
      saveToStorage(world)
      world.pushLog('セーブした')
      return
    }
    if (action === 'sample') {
      if (world.buildings.length > 1 && !confirm('今の村を捨ててサンプルの村を読み込みますか？')) return
      world.pushLog('サンプルの町を用意している…')
      // 生成に少し時間がかかるので、上の一行を描いてから始める
      setTimeout(() => {
        const sample = createSampleGame(world.grid.w, world.grid.h)
        if (deserializeInto(world, serialize(sample.world))) afterLoad()
      }, 50)
      return
    }
    if (loadFromStorage(world)) {
      afterLoad()
      world.pushLog('セーブデータを読み込んだ')
    } else {
      world.pushLog('読み込めるセーブデータがない')
    }
  },
  (kind, scale) => world.season.setSevereScale(kind, scale),
)
/** 住民を選んで右のパネルに出し、一覧の行にも印を付ける。寄るのは一覧から選んだときだけ */
function pickCitizen(c: { id: number; i: number }, focus: boolean): void {
  const citizen = world.citizens.find((x) => x.id === c.id)
  if (!citizen) return
  menu.select(null)
  inspector.selectCitizen(citizen)
  roster.select(citizen.id)
  if (focus) {
    centerOn(citizen.i)
    view.dist = Math.min(view.dist, 26)
  }
}

const roster = new Roster(world, (c) => pickCitizen(c, true))
const peopleBtn = document.getElementById('people-btn') as HTMLButtonElement
peopleBtn.addEventListener('click', () => {
  peopleBtn.classList.toggle('active', roster.toggle())
  roster.update()
})

let selectedDef: BuildingDef | null = null
const menu = new BuildMenu((def) => {
  selectedDef = def
  if (def) inspector.clear()
  else ghost.hide()
})

/** その列の地面の高さに注視点を合わせる（y を 0 のままにすると村が画面からずれる） */
function centerOn(i: number): void {
  view.target.set(world.grid.xOf(i) + 0.5, world.grid.ground[i], world.grid.yOf(i) + 0.5)
}

/** ワールドを差し替えた後に描画側とカメラを合わせ直す */
function afterLoad(): void {
  inspector.clear()
  roster.select(-1)
  boats.clear()
  terrain.rebuildAll()
  game.path.refresh(world.water)
  centerOn(world.startI)
}

// --- 入力 -----------------------------------------------------------------
let speed = 1
let hover = -1
/** ドラッグの用途。中ボタン / Shift + 左で回転、右でパン */
let drag: 'pan' | 'rotate' | null = null
let dragX = 0
let dragY = 0
const ROTATE_SENSITIVITY = 0.006
const TILT_SENSITIVITY = 0.004
const keys = new Set<string>()
const tooltip = document.getElementById('tooltip') as HTMLElement

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    if (drag === 'pan') {
      const k = view.dist * 0.0016
      view.pan(-(e.clientX - dragX) * k, -(e.clientY - dragY) * k)
    } else {
      // 右へドラッグするとカメラが右へ回り込む（世界は反時計回りに見える）
      view.rotate(-(e.clientX - dragX) * ROTATE_SENSITIVITY)
      // 上へドラッグすると視点が低くなり、下へドラッグすると見下ろす
      view.tilt((e.clientY - dragY) * TILT_SENSITIVITY)
    }
    dragX = e.clientX
    dragY = e.clientY
    return
  }
  hover = view.pickColumn(e.clientX, e.clientY)
  updateGhost()
  updateTooltip(e.clientX, e.clientY)
})
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0 && !e.shiftKey) {
    onClick()
    return
  }
  if (e.button === 1) e.preventDefault() // 中ボタンのオートスクロールを止める
  drag = e.button === 1 || e.shiftKey ? 'rotate' : 'pan'
  dragX = e.clientX
  dragY = e.clientY
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointerup', (e) => {
  drag = null
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  view.zoom(e.deltaY * 0.0012)
}, { passive: false })
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase())
  if (e.key === 'Escape') {
    menu.select(null)
    inspector.clear()
    ghost.hide()
  }
})
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

function onClick(): void {
  if (hover < 0) return
  if (selectedDef) {
    const def = selectedDef
    if (!canPlace(world, def, hover).ok) return
    place(world, def, hover)
    return
  }
  // 建物か住民を選ぶ
  const b = world.buildingOn(hover)
  if (b) {
    inspector.selectBuilding(b)
    roster.select(-1)
    return
  }
  const cx = world.grid.xOf(hover) + 0.5
  const cy = world.grid.yOf(hover) + 0.5
  let best = null
  let bestD = 1.4
  for (const c of world.citizens) {
    const d = Math.hypot(c.x - cx, c.y - cy)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (best) {
    pickCitizen(best, false)
  } else {
    inspector.clear()
    roster.select(-1)
  }
}

function updateGhost(): void {
  if (!selectedDef || hover < 0) {
    ghost.hide()
    return
  }
  ghost.show(world, selectedDef, hover, canPlace(world, selectedDef, hover).ok)
}

function updateTooltip(x: number, y: number): void {
  if (hover < 0) {
    tooltip.classList.add('hidden')
    return
  }
  const parts: string[] = []
  if (selectedDef) {
    const check = canPlace(world, selectedDef, hover)
    parts.push(check.ok ? selectedDef.name : `${selectedDef.name}：${check.reason}`)
  }
  const depth = world.water.depth[hover]
  parts.push(`標高 ${world.grid.ground[hover]}`)
  if (depth > 0.01) parts.push(`水深 ${depth.toFixed(2)}`)
  const wet = world.irrigation.soilWet[hover]
  if (depth <= 0.01) parts.push(wet > 0.5 ? '湿った土' : '乾いた土')
  if (world.hasTree[hover]) {
    parts.push(world.treeDead[hover] ? '枯れ木' : world.treeGrowth[hover] >= 1 ? '木' : '若木')
  }
  tooltip.innerHTML = parts.join(' ・ ')
  tooltip.style.left = `${x + 14}px`
  tooltip.style.top = `${y + 16}px`
  tooltip.classList.remove('hidden')
}

function handleKeys(dt: number): void {
  const k = view.dist * dt * 1.2
  if (keys.has('w') || keys.has('arrowup')) view.pan(0, -k)
  if (keys.has('s') || keys.has('arrowdown')) view.pan(0, k)
  if (keys.has('a') || keys.has('arrowleft')) view.pan(-k, 0)
  if (keys.has('d') || keys.has('arrowright')) view.pan(k, 0)
  if (keys.has('q')) view.rotate(dt * 1.2)
  if (keys.has('e')) view.rotate(-dt * 1.2)
}

// --- ループ ---------------------------------------------------------------
let acc = 0
let last = performance.now()
setInterval(() => saveToStorage(world), 120000) // 2 分ごとに自動セーブ
let frame = 0
const clock = new THREE.Clock()

function loop(now: number): void {
  requestAnimationFrame(loop)
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  handleKeys(dt)

  acc += dt * speed
  let steps = 0
  while (acc >= TICK_DT && steps < 40) {
    game.step()
    acc -= TICK_DT
    steps++
  }
  const alpha = speed > 0 ? Math.min(1, acc / TICK_DT) : 1

  frame++
  if (steps > 0 || frame % 4 === 0) water.update(clock.getElapsedTime())
  if (frame % 10 === 0) terrain.syncFromGrid()
  if (frame % 30 === 0) terrain.refreshColors()
  entities.update(world, alpha)
  boats.update(world, game.logistics, dt * speed)
  view.setSeason(world.season)
  view.updateRain(dt)
  view.updateCamera()
  view.render()

  hud.update(world)
  menu.update(world)
  inspector.update()
  roster.update()
  if (selectedDef) updateGhost()
}
requestAnimationFrame(loop)

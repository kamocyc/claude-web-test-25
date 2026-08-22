/** 物理・バランス定数を一箇所に集約する。 */

// --- 水力学 ---------------------------------------------------------------
export const CELL = 1 // 1 列の辺長 [m]
export const G = 9.81 // 重力加速度
export const DAMPING = 0.97 // フラックスの減衰（発振抑制）
export const MAX_FLUX = 4 // パイプ 1 本あたりの最大流量
export const WATER_SUBSTEPS = 4 // 1 tick を何分割して解くか
export const DRY_EPSILON = 0.002 // これ未満の水深は 0 とみなす
export const EVAP_RATE = 0.0004 // 蒸発 [m/s]（浅いほど速い）

// --- 時間 -----------------------------------------------------------------
export const TICKS_PER_SEC = 10
export const TICK_DT = 1 / TICKS_PER_SEC
export const TICKS_PER_DAY = 240 // 1 日 = 24 秒（1x 速度）

// --- 地形・移動 -----------------------------------------------------------
export const MAX_Z = 24
export const WALKABLE_MAX_DEPTH = 1.0 // これより深い水は歩けない
export const MAX_STEP = 1 // 登れる段差

// --- 水利設備 -------------------------------------------------------------
export const PUMP_MIN_DEPTH = 0.5 // 揚水ポンプの稼働に必要な取水口水深
export const PUMP_DRAW_PER_UNIT = 0.02 // 水 1 個の生産で減る水深
export const DUMP_ADD_PER_UNIT = 0.02 // 放水設備が水 1 個で足す水深
export const DAM_RESIST = 0.3 // ダム/水門の通水抵抗
export const FLOODGATE_MAX_HEIGHT = 3

// --- 灌漑 -----------------------------------------------------------------
export const MOISTURE_RANGE = 12 // 水辺からの到達距離
export const MOISTURE_UP_COST = 2 // 1 ブロック登るごとの追加コスト
export const IRRIGATION_MIN_DEPTH = 0.1 // 水源とみなす最小水深
export const MOISTURE_RECALC_TICKS = 30
export const SOIL_WET_RATE = 0.02 // 湿る速さ（/tick）
export const SOIL_DRY_RATE = 0.004 // 乾く速さ（/tick）
export const SOIL_GROW_THRESHOLD = 0.5 // 植物が育つ土壌水分

// --- 住民 -----------------------------------------------------------------
export const CITIZEN_SPEED = 2.2 // [m/s]
export const NEED_DECAY = {
  water: 1 / (TICKS_PER_DAY * 1.5),
  food: 1 / (TICKS_PER_DAY * 2.0),
  sleep: 1 / (TICKS_PER_DAY * 1.2),
} as const
export const NEED_SEEK_THRESHOLD = 0.35 // これを割ると充足行動へ
export const STARVE_TICKS = TICKS_PER_DAY * 2 // 需要 0 が続いて死ぬまで
export const GROWTH_STOCK_RATIO = 0.35 // 人口増加に必要な備蓄割合

// --- 植生 -----------------------------------------------------------------
export const TREE_GROW_TICKS = TICKS_PER_DAY * 6
export const CROP_GROW_TICKS = TICKS_PER_DAY * 3
export const PLANT_DIE_TICKS = TICKS_PER_DAY * 2 // 乾燥に耐えられる時間

// --- 季節 -----------------------------------------------------------------
// 平年・大雨・日照りをランダムに引く。キーは SeasonKind と一致させる。
/** 季節の長さ [日]（下限, 上限）。日照りは通過するたびに下限が伸びる */
export const SEASON_DAYS = {
  normal: [20, 28],
  rain: [6, 10],
  drought: [6, 10],
} as const
export const DROUGHT_DAYS_STEP = 1
export const DROUGHT_DAYS_MAX = 14
/** 直前と違う季節を引くときの重み */
export const SEASON_WEIGHT = { normal: 3, rain: 2, drought: 2 }
/** 水源の流量倍率 */
export const SOURCE_STRENGTH = { normal: 1, rain: 2.2, drought: 0 }
/** 蒸発の倍率 */
export const EVAP_MULT = { normal: 1, rain: 0.4, drought: 3 }
/**
 * 大雨のとき「すでに水のある列」に降る雨 [m/s]。
 *
 * 乾いた列には降らせない。乾いた土は雨を吸い、水は低いところへ流れて水面に集まる、
 * という現実の流出をそのまま模したもの。全列に降らせると、高台の窪地に抜け道のない
 * 水たまりが何百と残り、日が経っても消えない（1 日 = 24 秒しかないので蒸発が追いつかない）。
 * 川・貯水池・水田・水路だけが増水するので、季節が明ければ普通に引いていく。
 * 周りの土地から集まってくる分も込みなので、雨量そのものより強めの値にしてある。
 */
export const RAIN_RATE = 0.004
/** 出火のしやすさの倍率 */
export const IGNITE_MULT = { normal: 1, rain: 0.1, drought: 4 }
export const SEASON_RAMP_TICKS = TICKS_PER_DAY // 季節の切替に要する時間
export const SEASON_OMEN_DAYS = 2 // 次の季節の前触れが出る残り日数

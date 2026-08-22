/** 物理・バランス定数を一箇所に集約する。 */

// --- 水力学 ---------------------------------------------------------------
export const CELL = 1 // 1 列の辺長 [m]
export const G = 9.81 // 重力加速度
export const DAMPING = 0.97 // フラックスの減衰（発振抑制）
export const MAX_FLUX = 4 // パイプ 1 本あたりの最大流量
export const WATER_SUBSTEPS = 4 // 1 tick を何分割して解くか
export const DRY_EPSILON = 0.002 // これ未満の水深は 0 とみなす
export const EVAP_RATE = 0.001 // 蒸発 [m/s]（水面から。浅いほうが少しだけ速い）

// --- 時間 -----------------------------------------------------------------
export const TICKS_PER_SEC = 10
export const TICK_DT = 1 / TICKS_PER_SEC
export const TICKS_PER_DAY = 240 // 1 日 = 24 秒（1x 速度）

// --- 地形・移動 -----------------------------------------------------------
export const MAX_Z = 24
export const WALKABLE_MAX_DEPTH = 1.0 // これより深い水は歩けない
export const MAX_STEP = 1 // 登れる段差
// 水の中は歩きにくい。膝まで浸かれば足は進まないし、荷を担いでいればなおさら。
// 歩ける限界の深さで WADE_COST_MAX 倍の時間がかかる。橋を架ける理由になる。
export const WADE_FREE_DEPTH = 0.15 // くるぶし程度。ここまでは変わらない
export const WADE_COST_MAX = 6 // 水深 WALKABLE_MAX_DEPTH のときの倍率

// --- 水利設備 -------------------------------------------------------------
export const PUMP_MIN_DEPTH = 0.5 // 踏車の稼働に必要な取水口水深
export const PUMP_DRAW_PER_UNIT = 0.02 // 水 1 個の生産で減る水深
export const DUMP_ADD_PER_UNIT = 0.02 // 放水設備が水 1 個で足す水深
export const DAM_RESIST = 0.3 // 堰/水門の通水抵抗
export const FLOODGATE_MAX_HEIGHT = 3
// 堀割で 1 段掘るごとに出る土。土手 1 段（4）と釣り合わせてある。
// 「掘った土で堤を築く」という往復が成り立ち、土の総量は地形の体積で頭打ちになる。
export const DIG_SOIL_YIELD = 4

// --- 灌漑 -----------------------------------------------------------------
export const MOISTURE_RANGE = 12 // 水辺からの到達距離
export const MOISTURE_UP_COST = 2 // 1 ブロック登るごとの追加コスト
export const IRRIGATION_MIN_DEPTH = 0.1 // 水源とみなす最小水深
export const MOISTURE_RECALC_TICKS = 30
export const SOIL_WET_RATE = 0.02 // 湿る速さ（/tick）
export const SOIL_DRY_RATE = 0.004 // 乾く速さ（/tick）
export const SOIL_GROW_THRESHOLD = 0.5 // 植物が育つ土壌水分

// --- 稲作 -----------------------------------------------------------------
// 稲は土壌水分ではなく「田に張った水」で育つ。畑（麦）とはここが違う。
export const PADDY_MIN_DEPTH = 0.05 // これを割ると稲は枯れていく
export const PADDY_MAX_DEPTH = 1.0 // これを超えると水没して生育が止まる（枯れはしない）

// --- 物流 -----------------------------------------------------------------
// 生産物は建物の荷置き場にいったん積まれ、蔵へは 1 日に運べる量しか流れない。
export const LOAD_CAP = 24 // 荷置き場の容量。埋まると建物は止まる
export const LAND_NEAR = 12 // ここまでなら「村の中」。荷運びに困らない
export const LAND_FAR = 30 // ここを超えると人が背負うしかない
export const ROAD_COST = 0.4 // 道の上は 1 マスをこれだけとして数える
/** 経路ごとに 1 日で運べる量 */
export const ROUTE_RATE = { boat: 100, near: 60, cart: 8, foot: 2 }
export const BOAT_MIN_DEPTH = 0.8 // 舟が通れる水深
export const WHARF_RADIUS = 8 // 船着場の集荷範囲
export const LOGISTICS_RECALC_TICKS = 30

// --- 住民 -----------------------------------------------------------------
export const CITIZEN_SPEED = 2.2 // [m/s]
export const NEED_DECAY = {
  water: 1 / (TICKS_PER_DAY * 1.5),
  food: 1 / (TICKS_PER_DAY * 2.0),
  sleep: 1 / (TICKS_PER_DAY * 1.2),
} as const
export const NEED_SEEK_THRESHOLD = 0.35 // これを割ると充足行動へ
// 働き手を回す優先度（建物ごと）。遊ぶ側が 低・並・高 で切り替える。
// 建物ごとの指定が先で、同じ段のなかを BuildingDef.jobPriority が並べる。
export const JOB_PRIORITIES = [0, 1, 2] as const
export const JOB_PRIORITY_NORMAL = 1
export const JOB_PRIORITY_LABEL = ['低', '並', '高'] as const
export const STARVE_TICKS = TICKS_PER_DAY * 2 // 需要 0 が続いて死ぬまで
// 現在の人口をこの日数だけ維持できる備蓄があると人が増える。
// 必要量は NEED_DECAY から算出するため、消費速度の変更にも追従する。
export const GROWTH_RESERVE_DAYS = 3
// 麦 1 個が満たす食料需要。米 1 個 = 1 に対し、麦は半分。
export const WHEAT_FOOD_VALUE = 0.5

// --- 植生 -----------------------------------------------------------------
export const TREE_GROW_TICKS = TICKS_PER_DAY * 6
export const CROP_GROW_TICKS = TICKS_PER_DAY * 3
export const PLANT_DIE_TICKS = TICKS_PER_DAY * 2 // 乾燥に耐えられる時間

// --- 浸水 -----------------------------------------------------------------
// 深さで段階が分かれる。浅い浸水は不便、深い浸水は損害。
export const FLOOD_CROP_DEPTH = 0.1 // 畑の作物が流される水深（水田は別）
// 木は多少の冠水では枯れない。根まで水に沈む深さ（＝人が歩けない深さ）が続いて
// はじめて根腐れする。大雨のたびに山が丸裸になると立て直しようがないため。
export const FLOOD_TREE_DEPTH = 2.0 // 木が根腐れを起こす水深
export const FLOOD_ROAD_DEPTH = 0.3 // 道が流される水深
export const FLOOD_ROAD_WASH_CHANCE = 0.25 // 日ごとに道が流される確率
export const FLOOD_STOP_DEPTH = 0.35 // 床上まで水が来て建物が働けなくなる水深
export const FLOOD_SPOIL_RATE = 0.12 // 浸かった蔵で日ごとに傷む蓄えの割合
export const FLOOD_DAMAGE_DEPTH = 0.5 // 建物が傷み始める水深
export const FLOOD_DAMAGE_CHANCE = 0.1 // 日ごとに傷む確率（水深 1.0 のとき）
export const FLOOD_LEFTOVER = 0.3 // 傷んだ建物に残る建設の進み具合

// --- 火事 -----------------------------------------------------------------
// 木と紙と藁の村なので、火が出れば町ごと持っていかれる。
export const FIRE_TICK_INTERVAL = 10 // 延焼判定の間隔
export const IGNITE_CHANCE_PER_DAY = 0.008 // 火を使う建物 1 軒あたりの出火率（季節で増減）
export const FIRE_GROW = 0.004 // 勢いの増し方 /tick（0 → 1 でおよそ 1 日）
export const FIRE_BURN_TICKS = 120 // 勢いが頭打ちになってから焼け落ちるまで
export const FIRE_SPREAD_MIN = 0.35 // これ未満の火は燃え移らない
export const FIRE_SPREAD_RADIUS = 2
export const FIRE_SPREAD_CHANCE = 0.05
export const FIRE_BREAK_FACTOR = 0.05 // 間に水があるときの延焼しやすさ
export const FIRE_WATER_DEPTH = 0.3 // 防火用水とみなす水深
export const FIRE_WATER_RADIUS = 6 // 火元から水までの距離
export const EXTINGUISH_RATE = 0.008 // 火消しひとりが 1 tick で削る勢い
export const EXTINGUISH_DRY_FACTOR = 0.25 // 防火用水が無いときの倍率
export const FIRE_UNSEEN_TICKS = 150 // 火の見櫓の範囲外だと発見が遅れる
export const FIRE_RAIN_QUENCH = 0.01 // 大雨が火を消す速さ /tick
export const TREE_FIRE_GROW = 0.01
export const TREE_SPREAD_CHANCE = 0.06

// --- 季節 -----------------------------------------------------------------
// 平年・大雨・日照りをランダムに引く。キーは SeasonKind と一致させる。
/**
 * 季節の長さ [日]（下限, 上限）。日照りは通過するたびに下限が伸びる。
 *
 * 大雨は日照りより短くしてある。日照りは蓄えを食いつぶす消耗戦なので長く効くが、
 * 大雨は畑も道も建物も一度に止めてしまうので、同じだけ続くと立て直す前に村が終わる。
 */
export const SEASON_DAYS = {
  normal: [20, 28],
  rain: [4, 7],
  drought: [6, 10],
} as const
export const DROUGHT_DAYS_STEP = 1
export const DROUGHT_DAYS_MAX = 14
/**
 * 大雨・日照りの長さの倍率の既定値。上の表は素の日数なので、実際は
 * 大雨 8〜14 日、日照り 12〜20 日になる。ゲーム中に「大雨／日照り 短・並・長」で
 * 別々に変えられる（Season.setSevereScale）。
 */
export const SEVERE_SCALE_DEFAULT = 2
export const SEVERE_SCALES = [1, 2, 3] as const
/** 直前と違う季節を引くときの重み */
export const SEASON_WEIGHT = { normal: 3, rain: 2, drought: 2 }
/** 水源の流量倍率 */
/**
 * 水源の流量倍率。
 * 大雨は「堰が無くても氾濫原が浸かる」ところまで上げてある（実測: 6 日で氾濫原の
 * 8 割が水を被り、平均 0.2 m。10 日で 0.3 m）。一段高い微高地と段丘は浸からないので、
 * 逃げ場は残る。
 */
export const SOURCE_STRENGTH = { normal: 1, rain: 5, drought: 0 }
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
// 季節の切替に要する時間。大雨と日照りは 6〜10 日しかないので、
// 1 日かけて繋ぐと季節の 1〜2 割が中途半端な状態になってしまう
export const SEASON_RAMP_TICKS = Math.round(TICKS_PER_DAY / 3)
export const SEASON_OMEN_DAYS = 2 // 次の季節の前触れが出る残り日数

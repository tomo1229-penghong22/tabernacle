// dimensions.js
// 幕屋・中庭の全寸法／部材数を一元管理する。他モジュールは必ずここから値を参照し、
// 数値を直書きしない（T2要件）。
//
// 単位: CUBIT = 1キュビト = 0.445m（新世界訳の換算値）。1 THREE unit = 1m。
// 座標系: +x = 東, +z = 南, +y = 上（PLAN.md A7）。
//
// 出典章はすべて出エジプト記（新世界訳）。各値の note に PLAN.md 上の根拠・仮定番号を記す。

export const CUBIT = 0.445; // m
export const cub = (n) => n * CUBIT; // キュビト → メートル変換ヘルパー

// ---------------------------------------------------------------------------
// 中庭 (27章) — T3
// ---------------------------------------------------------------------------
export const COURTYARD = {
  // 外形 100×50キュビト。x: 東西 [-50,50]キュビト, z: 南北 [-25,25]キュビト
  lengthCubit: 100,
  widthCubit: 50,
  get length() { return cub(this.lengthCubit); }, // ≈44.5m (PLAN表記45mと誤差1.1%、許容2%以内)
  get width() { return cub(this.widthCubit); }, // ≈22.25m (PLAN表記22mと誤差1.1%)

  hangingHeightCubit: 5, // 掛け布の高さ
  get hangingHeight() { return cub(this.hangingHeightCubit); }, // ≈2.225m ("2.2m"に対し誤差1.1%)

  postCounts: {
    north: 20,
    south: 20,
    west: 10,
    east: 6, // 入口を除く東側
    entrance: 4, // 入口幕を支える柱
  },
  get totalPosts() {
    const p = this.postCounts;
    return p.north + p.south + p.west + p.east + p.entrance; // = 60 (C2)
  },

  postDiameter: 0.15, // 実装上の細部（PLAN未記載の太さ）
  pedestalSize: { x: 0.3, y: 0.2, z: 0.3 }, // 銅の台座（実装上の細部）
  capitalHeight: 0.06, // 銀の柱頭バンド（実装上の細部）

  entranceWidthCubit: 20, // 入口幕の幅
  get entranceWidth() { return cub(this.entranceWidthCubit); }, // ≈8.9m
};

// ---------------------------------------------------------------------------
// 幕屋本体 (26章) — T4
// 内寸 30×10×10キュビト（聖所20 + 至聖所10、幅10、高さ10） … A3
// ---------------------------------------------------------------------------
export const FRAME = {
  heightCubit: 10,
  widthCubit: 1.5,
  thickness: 0.1, // A1: 板厚の仮定値
  get height() { return cub(this.heightCubit); }, // 4.45m
  get width() { return cub(this.widthCubit); }, // 0.6675m

  counts: { north: 20, south: 20, west: 6, corner: 2 },
  get total() {
    const c = this.counts;
    return c.north + c.south + c.west + c.corner; // 48 (C2)
  },
  socketsPerFrame: 2, // A4
};

export const TABERNACLE = {
  // 内寸境界（キュビト）: 至聖所 x∈[-30,-20], 聖所 x∈[-20,0], 幅 z∈[-5,5], 高さ y∈[0,10]
  innerLengthCubit: 30,
  innerWidthCubit: 10,
  innerHeightCubit: 10,
  get innerLength() { return cub(this.innerLengthCubit); }, // 13.35m
  get innerWidth() { return cub(this.innerWidthCubit); }, // 4.45m
  get innerHeight() { return cub(this.innerHeightCubit); }, // 4.45m

  xEntrance: 0,
  xVeil: -cub(20), // 聖所/至聖所境界 (-8.9m)
  xBack: -cub(30), // 西壁外側基準 (-13.35m)
  zHalf: cub(5), // ±2.225m

  crossbars: {
    perSide: 5,
    sides: ['north', 'south', 'west'],
    get total() { return this.perSide * this.sides.length; }, // 15
    diameter: 0.08, // 実装上の細部
  },

  veil: {
    // 聖所/至聖所を仕切る垂れ幕。柱4本＋銀台座4（PLAN記載）。
    // 高さは本文に明記なし → 内部高さ(10キュビト)と同一と仮定（構造上の必然、軽微な仮定）。
    pillarCount: 4,
    pedestalMaterial: 'silver',
    heightCubit: 10,
    get height() { return cub(this.heightCubit); },
    widthCubit: 10,
    get width() { return cub(this.widthCubit); },
    passable: true, // T1要件: 垂れ幕は通過可（衝突判定から除外）
  },

  entranceScreen: {
    // 幕屋入口の幕。柱5本＋銅台座5（PLAN記載）。
    pillarCount: 5,
    pedestalMaterial: 'bronze',
    heightCubit: 10, // 本文に高さ明記なし→垂れ幕と同様に内部高さと仮定
    get height() { return cub(this.heightCubit); },
    widthCubit: 10,
    get width() { return cub(this.widthCubit); },
    passable: true, // T1要件: 入口の幕は通過可
  },

  silverSocketsTotal: 100, // A4: 枠48×2 + 垂れ幕柱4 = 100
};

// 屋根4層（26章）。A2: 平屋根＋自重のたるみ（T11, 人間決定2026-09-25）、側面・背面に垂らす。
// 各層は個別ON/OFF可能(T4要件)。
// 内側の布とヤギ毛は枚数・パネル寸法がPLANに明記。組み立て後の全体寸法は
// 出エジプト記26章の伝統的解釈（内側の布は側面に9キュビト・背面に10キュビト垂れる。
// ヤギ毛は側面に10キュビト＝地面まで垂れる）に基づく実装上の算出値。
// 赤い雄羊皮・アザラシ皮は本文に寸法記載が無いため、ヤギ毛層と同じ被覆範囲と仮定（要確認事項として最終報告に列挙）。
//
// T11 たるみ: 布は枠の上端(南北壁)に載っているだけで、基本のたるみ方向は南北壁の
// 上端の2本のライン(東西方向に連続)の間(topWidth ≈ zHalf*2 のスパン)。
// sagMaxM: スパン中央での最大たるみ量。スパン(topWidth≈4.47m)に対して比 1:12.8
// (≈7.8%)。「中程度、枠の間ではっきり弧を描く」(人間決定)の目安として採用。
// 4層とも同じ絶対量でたるませる(層ごとの積み重ねオフセットgapと合わせて平行移動
// するだけになるため、内側の層が外側の層を貫通しない)。
//
// T11 差し戻し(D1, 2026-09-25): 東西方向に一定のたるみだと、東西方向にも「全幅を
// 支持する構造」がある位置(西壁=枠が隙間なく全幅を支持、垂れ幕/入口の幕=柱の間を
// 布が全幅つなぐ)で、その支持物の上端を屋根が突き抜けてしまうことが判明(実測: 西壁
// 最大48cm、垂れ幕23cm、入口の幕28cm貫通)。そのため東西位置ごとに「たるみを
// どれだけ許すか」をゲートし、西壁(xBack)・垂れ幕の柱(xVeil)・入口の幕の柱
// (xEntrance)の位置ではたるみを0まで抑え、そこから離れるほど通常のたるみに戻す。
// sagGateMarginM: ゲート位置から何mでたるみが100%に戻るか。枠2枚分弱(0.6675m×2
// ≈1.34m)を目安に1.2mとした。西壁〜垂れ幕は4.45m、垂れ幕〜入口は8.9mの間隔が
// あり、両端をこの幅だけ平らにしても「中程度にはっきり弧を描く」区間が十分残る
// (それぞれ約2.05m・6.5m)。
export const ROOF_SAG_GATE_MARGIN_M = 1.2;
export const ROOF = {
  sagMaxM: 0.35,
  innerLinen: {
    nameJa: '内側の布（ケルブ刺しゅう）',
    panelCount: 10,
    panelSizeCubit: { w: 4, l: 28 },
    source: '出エジプト記26:1-6',
    topLengthCubit: 30, // 幕屋長さと同一（前面は覆わない）
    sideOverhangCubit: 9, // 側面: 地面まで1キュビト残して垂れる
    backOverhangCubit: 10, // 背面: 地面まで届く
    colorNote: '亜麻・青・紫・緋色、ケルブ刺しゅう',
  },
  goatHair: {
    nameJa: 'ヤギ毛の天幕',
    panelCount: 11,
    panelSizeCubit: { w: 4, l: 30 },
    source: '出エジプト記26:7-13',
    topLengthCubit: 30,
    frontOverhangCubit: 4, // 入口側に垂れる二重折り分（26:9）
    sideOverhangCubit: 10, // 側面: 地面まで届く
    backOverhangCubit: 10,
  },
  ramSkins: {
    nameJa: '赤く染めた雄羊の皮の覆い',
    source: '出エジプト記26:14',
    note: '寸法本文記載なし。ヤギ毛層と同じ被覆範囲と仮定（要確認）',
    topLengthCubit: 30,
    sideOverhangCubit: 10,
    backOverhangCubit: 10,
  },
  sealSkins: {
    nameJa: 'アザラシの皮の覆い',
    source: '出エジプト記26:14',
    note: '寸法本文記載なし。ヤギ毛層と同じ被覆範囲と仮定（要確認）',
    topLengthCubit: 30,
    sideOverhangCubit: 10,
    backOverhangCubit: 10,
  },
};

// ---------------------------------------------------------------------------
// 調度品 (25章・27章・30章) — T5。配置は A7。
// ---------------------------------------------------------------------------
export const FURNITURE = {
  ark: {
    nameJa: '契約の箱',
    source: '出エジプト記25:10-22',
    sizeCubit: { l: 2.5, w: 1.5, h: 1.5 },
    get size() { return { l: cub(this.sizeCubit.l), w: cub(this.sizeCubit.w), h: cub(this.sizeCubit.h) }; },
    material: 'gold',
    position: { xCubit: -25, zCubit: 0 }, // 至聖所中央
    cherubim: true,
    poles: true,
  },
  table: {
    nameJa: '供えのパンの机',
    source: '出エジプト記25:23-30',
    sizeCubit: { l: 2, w: 1, h: 1.5 },
    get size() { return { l: cub(this.sizeCubit.l), w: cub(this.sizeCubit.w), h: cub(this.sizeCubit.h) }; },
    material: 'gold',
    position: { xCubit: -15, zCubit: -3.5 }, // 聖所 北側(26:35)。+z=南のため北側はzCubit負
  },
  lampstand: {
    nameJa: '燭台（メノーラー）',
    source: '出エジプト記25:31-40',
    material: 'gold',
    lamps: 7,
    position: { xCubit: -15, zCubit: 3.5 }, // 聖所 南側(26:35)。+z=南のため南側はzCubit正
    heightCubit: 1.5, // 実装上の細部（本文に全高記載なし、伝統的高さの目安）
  },
  incenseAltar: {
    nameJa: '香の祭壇',
    source: '出エジプト記30:1-6（A5: 含める）',
    sizeCubit: { l: 1, w: 1, h: 2 },
    get size() { return { l: cub(this.sizeCubit.l), w: cub(this.sizeCubit.w), h: cub(this.sizeCubit.h) }; },
    material: 'gold',
    position: { xCubit: -19, zCubit: 0 }, // 垂れ幕の手前(聖所側)
    horns: true,
  },
  laver: {
    nameJa: '洗盤',
    source: '出エジプト記30:17-21（A5: 寸法仮定）',
    material: 'bronze',
    diameter: 1.2, // A5仮定値(m)
    height: 1.0, // A5仮定値(m)
    position: { xCubit: 12, zCubit: 0 },
  },
  altar: {
    nameJa: '燔祭の祭壇',
    source: '出エジプト記27:1-8',
    sizeCubit: { l: 5, w: 5, h: 3 },
    get size() { return { l: cub(this.sizeCubit.l), w: cub(this.sizeCubit.w), h: cub(this.sizeCubit.h) }; },
    material: 'bronze',
    position: { xCubit: 25, zCubit: 0 },
    horns: true,
    grating: true,
  },
};

// 材料キーの一覧（materials.js が実装）。ここでは名称のみを一元管理。
export const MATERIALS = {
  GOLD: 'gold',
  SILVER: 'silver',
  BRONZE: 'bronze',
  WOOD: 'acaciaWood',
  LINEN: 'linen',
  LINEN_CHERUB: 'linenCherub',
  GOAT_HAIR: 'goatHair',
  RAM_SKIN: 'ramSkin',
  SEAL_SKIN: 'sealSkin',
  SAND: 'sand',
  MOUNTAIN: 'mountain',
  SHRUB: 'shrub',
};

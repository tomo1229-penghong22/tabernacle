// cloth.js — T7 補助
// 布ジオメトリに「風でどれだけ自由に動けるか」を表す windFree 頂点属性(0-1)を焼き込む。
// 実際の揺れの計算(振幅・方向・時間変化)は materials.js の onBeforeCompile 内、
// 頂点シェーダーで windFree を読み取って行う（マテリアルは複数の布種別で共有されるため、
// 「どこがどれだけ揺れるか」はマテリアルではなくジオメトリ側の属性で表現する）。
//
// kind:
//  - 'wallHanging'    中庭の掛け布。上端(柱)・下端(杭, 27:19)とも固定 → 振幅小、中央がわずかに膨らむ
//  - 'entranceCurtain' 入口の幕(中庭・幕屋とも)。上端固定・下端自由 → 振幅大
//  - 'roofDrape'      屋根覆いの垂れ下がり部分。上端(枠)固定・下端はほぼ自由だが全体に振幅小さめ
//  - それ以外/未指定   揺れない(常に0)

import * as THREE from 'three';

// 各布種別の最大自由度(windFreeの最大値)。検証(C5)で理論上の最大変位量を
// 計算する際にも、この値と materials.js の風シェーダーの式(同じ定数)を用いる。
export const WIND_FREE_MAX = {
  wallHanging: 0.28,
  entranceCurtain: 1.0,
  roofDrape: 0.32,
  none: 0,
};

// applyRoofSag: 屋根布(T11)が枠の上端の間で自重によりたるむ様子を頂点位置に
// 焼き込む(放物線状、中央で最大・支持端で0)。実際の風揺れ(materials.jsの頂点
// シェーダー)はこの「たるんだ形状」に対してさらに変位を加える(このジオメトリが
// 風の基準姿勢になる)。
//
// spanAxis: たるみが変化する方向のローカル軸('x'|'y')。回転前のジオメトリで
//   枠の間の未支持スパン(南北方向)に対応する軸を指定する。
// liftAxis: たるみをワールド下方向として表現するために動かすローカル軸('y'|'z')。
//   メッシュのrotationにより、この軸の変化がワールドの-y(重力方向)になるものを選ぶ。
// halfSpan: spanAxis上での支持端までの距離(この位置でたるみ0)。
// maxSag: スパン中央(spanAxis=0)での最大たるみ量(m)。
// liftSign: liftAxisへ加える符号。ワールドで必ず下方向(-y)になるよう呼び出し側で指定する。
// taperMin/taperMax: 指定時、liftAxis座標の値に応じてたるみ量を0〜1で線形に弱める
//   (taperMinで0倍・taperMaxで1倍)。垂れ幕状のパネル(例: 背面の垂れ)で、上端は
//   屋根のたるみに追従させつつ、下端(地面付近)は元の位置から動かさないために使う。
// gateAxis/gateWorldOffset/gates: T11差し戻し(D1)対応。spanAxis方向(南北)だけでなく
//   もう一方の水平方向(東西, 通常はワールドx)にも「全幅にわたる支持」がある場合に、
//   その位置ではspanAxis方向のたるみ自体を0まで抑える(ゲート)。西壁(枠が隙間なく
//   全幅を支持)・垂れ幕/入口の幕(柱の間を布が全幅つなぐ)がこれに当たる。
//   gates: [{ x: 支持位置のワールドx, margin: そこから何mでたるみが100%に戻るか }]
//   複数指定時は最も近い(最も厳しい)ものが効く(min)。滑らかにするためsmoothstepを使う。
export function applyRoofSag(geometry, {
  spanAxis, liftAxis, halfSpan, maxSag, liftSign = -1, taperMin, taperMax,
  gateAxis, gateWorldOffset = 0, gates,
}) {
  const pos = geometry.attributes.position;
  const hasTaper = taperMin != null && taperMax != null;
  const hasGate = gates && gates.length > 0;
  for (let i = 0; i < pos.count; i++) {
    const s = spanAxis === 'x' ? pos.getX(i) : pos.getY(i);
    const t = THREE.MathUtils.clamp(s / halfSpan, -1, 1);
    let sag = maxSag * (1 - t * t); // 放物線: 端(|t|=1)で0, 中央(t=0)でmaxSag
    if (hasTaper) {
      const liftCoord = liftAxis === 'y' ? pos.getY(i) : pos.getZ(i);
      const taper = THREE.MathUtils.clamp((liftCoord - taperMin) / (taperMax - taperMin), 0, 1);
      sag *= taper;
    }
    if (hasGate) {
      const gCoord = (gateAxis === 'x' ? pos.getX(i) : pos.getY(i)) + gateWorldOffset;
      let gate = 1;
      for (const g of gates) {
        const f = THREE.MathUtils.clamp(Math.abs(gCoord - g.x) / g.margin, 0, 1);
        const smooth = f * f * (3 - 2 * f); // smoothstep: 支持位置で0、marginで1
        gate = Math.min(gate, smooth);
      }
      sag *= gate;
    }
    if (liftAxis === 'y') pos.setY(i, pos.getY(i) + liftSign * sag);
    else pos.setZ(i, pos.getZ(i) + liftSign * sag);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function applyWindFree(geometry, kind) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const range = Math.max(1e-6, max.y - min.y);
  const pos = geometry.attributes.position;
  const arr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const v = THREE.MathUtils.clamp((pos.getY(i) - min.y) / range, 0, 1); // 0=下端, 1=上端
    let free = 0;
    if (kind === 'wallHanging') free = WIND_FREE_MAX.wallHanging * 4 * v * (1 - v); // 上下固定、中央のみ小さく膨らむ
    else if (kind === 'entranceCurtain') free = WIND_FREE_MAX.entranceCurtain * (1 - v); // 上端固定・下端自由
    else if (kind === 'roofDrape') free = WIND_FREE_MAX.roofDrape * Math.pow(1 - v, 2); // 下端付近のみ小さく
    arr[i] = free;
  }
  geometry.setAttribute('windFree', new THREE.BufferAttribute(arr, 1));

  // T14: pillarGate/pillarScreenMask は柱の近接情報を持つ布(入口の幕2枚)専用の
  // 属性。既定は全頂点0(=柱情報なし=ゲート無効)。materials.js の頂点シェーダーは
  // これらが0のとき既存の変位式と完全に同じ結果になるため、ここで既定値を敷いて
  // おくことで wallHanging・roofDrape 等の既存の揺れは一切変えずに、
  // entranceCurtainの2枚だけ applyPillarGate() で上書きして柱回避を効かせられる。
  if (!geometry.attributes.pillarGate) {
    geometry.setAttribute('pillarGate', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  }
  if (!geometry.attributes.pillarScreenMask) {
    geometry.setAttribute('pillarScreenMask', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  }
  // T15: wallOutSign/drapeUV は壁際の屋根の垂れ(側面・背面)専用。既定は0
  // (=壁情報なし。シェーダーは position を使い、内向き拘束もかけない)。
  if (!geometry.attributes.wallOutSign) {
    geometry.setAttribute('wallOutSign', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  }
  if (!geometry.attributes.drapeUV) {
    geometry.setAttribute('drapeUV', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  }
}

// T15: 壁際の屋根の垂れ(側面・背面、kind='roofDrape')専用の属性を焼き込む。
//  - wallOutSign: ローカルz軸のうち壁の外側へ向かう向きの符号(+1/-1)。シェーダーは
//    この値が非0の頂点だけ、ローカルzの変位のうち内向き成分を頭打ちにする。
//  - drapeUV: 風の波の位相計算に使う「基準座標」(ローカルx, 高さy)。4層で同じ
//    基準座標を持たせることで、層ごとの頂点位置・高さのずれ(外側へのオフセットや
//    入口側の継ぎ目調整)があっても、同じ格子番号の頂点は4層で完全に同じ風変位を
//    受ける。内側の層が外側の層より外へ出る(順序逆転)ことが構造的に起きない。
//  - windFree: 垂れの高さ canonY を、4層共通の基準(yTopRef..yBotRef)で正規化して
//    roofDrape の分布(上端0・下端最大、二乗)を与える(層ごとの垂れの長さの違いで
//    同じ高さの自由度が層によって変わらないようにする)。
// canonXY: 頂点ごとの基準座標(長さ pos.count*2 の配列、[x0,y0,x1,y1,...])。
export function applyRoofDrapeWall(geometry, { outSign, canonXY, yTopRef, yBotRef }) {
  const pos = geometry.attributes.position;
  const free = new Float32Array(pos.count);
  const sign = new Float32Array(pos.count).fill(outSign);
  const uv = new Float32Array(canonXY);
  for (let i = 0; i < pos.count; i++) {
    const v = THREE.MathUtils.clamp((canonXY[i * 2 + 1] - yBotRef) / (yTopRef - yBotRef), 0, 1);
    free[i] = WIND_FREE_MAX.roofDrape * Math.pow(1 - v, 2);
  }
  geometry.setAttribute('windFree', new THREE.BufferAttribute(free, 1));
  geometry.setAttribute('wallOutSign', new THREE.BufferAttribute(sign, 1));
  geometry.setAttribute('drapeUV', new THREE.BufferAttribute(uv, 2));
}

// T14: 入口の幕(width方向)の頂点グリッドが、柱の近くで「辺(隣接頂点間)が柱を
// 切らない」ことを解像度によらず保証するために必要な最小の幅分割数を計算する。
// 証明の要旨(詳細はlog/t14_report.md):
//  - applyPillarGate() は柱までのローカルx距離が
//    plateauEnd = offsetHalfExtent + 頂点間隔 以下では pillarGate=1(=変位が
//    定数になる「平坦部」)にする。頂点間隔ちょうど1つ分だけ offsetHalfExtent
//    より広く取ることで、「offsetHalfExtent以内の頂点」から1辺で
//    「plateauEndの外の頂点」へ飛ぶことは構造的に起こらない(隣接頂点は
//    高々1間隔しか離れていないため)。
//  - よって全ての辺は (a) 両端がplateauEnd以内で変位が定数(=安全な定数距離)、
//    または (b) 少なくとも近い方の端が既にoffsetHalfExtentの外(=柱の断面が
//    取りうる最大半径/半幅より遠い。柱の高さ方向のどの断面よりも遠いので、
//    変位がいくら大きくても柱には当たらない)のどちらかになり、辺の線形補間
//    (三角形の面)が柱を切ることはない。
// これが成り立つには、plateauEnd = offsetHalfExtent + 頂点間隔 が、隣の柱との
// 間の「自由に膨らむべき区間」を食い潰さない程度(柱間隔に対して
// PLATEAU_END_SPACING_FRACTION以下)である必要があり、そのために頂点間隔
// (=頂点解像度)を十分細かくする。
const PLATEAU_END_SPACING_FRACTION = 0.3;
export function pillarClearanceSegments(width, pillarSpacing, offsetHalfExtent, minSegments) {
  const maxVertexSpacing = Math.max(1e-3, pillarSpacing * PLATEAU_END_SPACING_FRACTION - offsetHalfExtent);
  const neededSegments = Math.ceil(width / maxVertexSpacing);
  const intervals = Math.max(1, Math.round(width / pillarSpacing)); // 柱間の区間数(pillarCount-1)
  return Math.ceil(Math.max(neededSegments, minSegments) / intervals) * intervals;
}

// T14: 入口の幕(courtyard入口・幕屋入口)専用。柱のローカルx位置(pillarLocalXs、
// 布のPlaneGeometryのローカルx系。makeHangingPanel/buildScreenいずれもrotation.y=
// 90°で、ローカルx = -ワールドz の関係)に近い頂点ほど1、離れるほど0になる
// 'pillarGate' 属性と、メッシュ全体で一定の 'pillarScreenMask'(=1) 属性を焼き込み、
// applyWindFree()が敷いた既定の0を上書きする。
//
// offsetHalfExtent: この柱の(布が占める高さ範囲内での)断面の最大半径/半幅。
//   呼び出し側(courtyard.js/tabernacle.js)で布の位置オフセット計算にも使う値と
//   同じものを渡し、シェーダー側の停止境界とジオメトリのオフセットを整合させる。
//   呼び出し前に pillarClearanceSegments() で十分な分割数にしておくこと
//   (辺が柱を切らないことの証明の前提)。
const PILLAR_GATE_EXTRA_MULT = 1.0; // 平坦部終端(plateauEnd)の外側にさらに設ける減衰幅の倍率(offsetHalfExtent比)
const PILLAR_GATE_SPACING_FRACTION = 0.4; // 柱間隔に対する減衰帯外縁の上限比率(PLATEAU_END_SPACING_FRACTIONより緩め、平坦部の外に減衰の余地を残す)
export function applyPillarGate(geometry, pillarLocalXs, offsetHalfExtent) {
  const xs = [...pillarLocalXs].sort((a, b) => a - b);
  let minSpacing = Infinity;
  for (let i = 1; i < xs.length; i++) minSpacing = Math.min(minSpacing, xs[i] - xs[i - 1]);
  if (!isFinite(minSpacing)) minSpacing = offsetHalfExtent * 10; // 柱1本のみの場合の保険

  const pos = geometry.attributes.position;
  let vertexSpacing = Infinity;
  {
    const seen = new Set();
    for (let i = 0; i < pos.count; i++) seen.add(Math.round(pos.getX(i) * 1e6) / 1e6);
    const sortedXs = [...seen].sort((a, b) => a - b);
    for (let i = 1; i < sortedXs.length; i++) vertexSpacing = Math.min(vertexSpacing, sortedXs[i] - sortedXs[i - 1]);
    if (!isFinite(vertexSpacing)) vertexSpacing = minSpacing;
  }

  const plateauEnd = offsetHalfExtent + vertexSpacing;
  let falloffOuterEdge = Math.max(plateauEnd + offsetHalfExtent * PILLAR_GATE_EXTRA_MULT, plateauEnd + vertexSpacing);
  falloffOuterEdge = Math.min(falloffOuterEdge, minSpacing * PILLAR_GATE_SPACING_FRACTION);
  falloffOuterEdge = Math.max(falloffOuterEdge, plateauEnd + vertexSpacing * 0.5);

  const arr = new Float32Array(pos.count);
  const maskArr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let dist = Infinity;
    for (const px of pillarLocalXs) dist = Math.min(dist, Math.abs(x - px));
    const t = THREE.MathUtils.smoothstep(dist, plateauEnd, falloffOuterEdge);
    arr[i] = 1 - t;
    maskArr[i] = 1;
  }
  geometry.setAttribute('pillarGate', new THREE.BufferAttribute(arr, 1));
  geometry.setAttribute('pillarScreenMask', new THREE.BufferAttribute(maskArr, 1));
  return { plateauEnd, falloffOuterEdge, vertexSpacing, minSpacing };
}

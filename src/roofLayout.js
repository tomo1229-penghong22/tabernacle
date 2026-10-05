// roofLayout.js — T15
// 屋根1層分(上面・側面の垂れ2枚・背面の垂れ・入口上の折り返し)のジオメトリと
// 配置(position/rotation)を、マテリアルに依存しない形で生成する。
// tabernacle.js(描画)と tools/verify_t15.mjs(Node上の数値検証。materials.js は
// canvas に依存するため Node では読み込めない)が同じ関数を使い、検証が本番の
// ジオメトリそのものを対象にできるようにするための分離。
//
// 配置の考え方(T15):
//  - 垂れは枠・横木・台座の外面より外側へ、層の順で間隔を空けて置く。壁の内側ラインから
//    の距離 d_k = frameOuterExtentM() + ROOF_DRAPE_CLEAR_M + ROOF_DRAPE_STEP_M×層番号。
//  - 屋根上面・入口上の折り返しの幅は、垂れの面(d_k)まで広げる(上面の端=垂れ上端)。
//    上面の長さも西側を d_k だけ広げ、背面の垂れの面まで届かせる。
//  - 4層の垂れは同じ格子番号の頂点が同じ「基準座標」(windの位相と自由度の計算用、
//    cloth.js applyRoofDrapeWall)を持つ。見た目の位置は、先頭の列(壁の角)と先頭の行
//    (上端)だけが層ごとにずれる(角と上面の継ぎ目に合わせるため)。

import * as THREE from 'three';
import {
  FRAME, TABERNACLE, ROOF, ROOF_SAG_GATE_MARGIN_M, PEDESTAL_H,
  ROOF_DRAPE_CLEAR_M, ROOF_DRAPE_STEP_M, frameOuterExtentM, cub,
} from './dimensions.js';
import { applyWindFree, applyRoofSag, applyRoofDrapeWall } from './cloth.js';

export const ROOF_BASE_Y = PEDESTAL_H + FRAME.height; // 枠上端の実際のワールドy(T11差し戻し参照)

// 壁の内側ライン(南北壁:z=±zHalf、西壁:x=xBack)から層kの垂れの面までの距離
export function drapeOffsetM(layerIndex) {
  return frameOuterExtentM() + ROOF_DRAPE_CLEAR_M + ROOF_DRAPE_STEP_M * layerIndex;
}
// 層ごとの上面の高さの積み上げ(z-fighting回避)
export function roofGapM(layerIndex) { return 0.025 * (layerIndex + 1); }

// 垂れ1枚分のジオメトリ。ローカル座標系は「ワールドのx,y」または「背面メッシュ用
// (ローカルx=-ワールドz)」で、メッシュ位置はy=0(+垂直方向は頂点に焼き込み済み)。
function makeDrape({ restX, canonX, overhang, rows, topY, yTopRef, yBotRef, outSign }) {
  const cols = restX.length - 1;
  const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
  const pos = geo.attributes.position;
  const canon = new Array(pos.count * 2);
  const step = overhang / rows;
  for (let iy = 0; iy <= rows; iy++) {
    const yCanon = yTopRef - iy * step;
    const yRest = iy === 0 ? topY : yCanon; // 先頭の行だけ上面の高さ(層の積み上げ込み)に合わせる
    for (let ix = 0; ix <= cols; ix++) {
      const i = iy * (cols + 1) + ix;
      pos.setXYZ(i, restX[ix], yRest, 0);
      canon[i * 2] = canonX[ix];
      canon[i * 2 + 1] = yCanon;
    }
  }
  pos.needsUpdate = true;
  applyWindFree(geo, 'none'); // 追加属性の既定値を敷いてから roofDrape 用に上書き
  applyRoofDrapeWall(geo, { outSign, canonXY: canon, yTopRef, yBotRef });
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// cfg: ROOF.* の1層分。layerIndex: 0=亜麻布..3=アザラシ。
// 戻り値の各メッシュ記述: { geo, position:[x,y,z], rotationX?, rotationY? }
export function buildRoofLayerParts(cfg, layerIndex) {
  const { xBack, xEntrance, xVeil, zHalf } = TABERNACLE;
  const d = drapeOffsetM(layerIndex);
  const gap = roofGapM(layerIndex);
  const yTopRef = ROOF_BASE_Y + 0.05; // 層の積み上げ(gap)を含まない共通基準
  const topY = yTopRef + gap;
  const yBotRef = yTopRef - cub(10); // 10キュビトの垂れの下端(地面近く)
  const halfW = zHalf + d;
  const topWidth = halfW * 2;
  const xWest = xBack - d;
  const xEast = xBack + cub(cfg.topLengthCubit); // = xEntrance
  const topLength = xEast - xWest;
  const topCenterX = (xWest + xEast) / 2;

  // T11差し戻し(D1)のゲート(西壁・垂れ幕・入口の幕の位置でたるみを0へ)。
  // T15: 西側のゲート位置は、上面の西端(=背面の垂れの面 xBack-d)に合わせる。xBack の
  // ままだと西端でたるみが残り(層0で最大約2cm)、背面の垂れの上端(平ら)との間に
  // すき間ができるため。西壁の枠上端(xBack-0.1..xBack)の上では、残るたるみ
  // (xBackでd/margin分の smoothstep)は数mm〜2cmで、屋根は枠上端より 7.5cm 以上上にある。
  const roofSagGates = [
    { x: xWest, margin: ROOF_SAG_GATE_MARGIN_M },
    { x: xVeil, margin: ROOF_SAG_GATE_MARGIN_M },
    { x: xEntrance, margin: ROOF_SAG_GATE_MARGIN_M },
  ];

  const parts = { d, gap, topY, yTopRef, yBotRef, halfW, topWidth, xWest, xEast, sides: [] };

  const topGeo = new THREE.PlaneGeometry(topLength, topWidth, 48, 8);
  applyWindFree(topGeo, 'none');
  applyRoofSag(topGeo, {
    spanAxis: 'y', liftAxis: 'z', halfSpan: topWidth / 2, maxSag: ROOF.sagMaxM, liftSign: -1,
    gateAxis: 'x', gateWorldOffset: topCenterX, gates: roofSagGates,
  });
  parts.top = { geo: topGeo, position: [topCenterX, topY, 0], rotationX: -Math.PI / 2 };

  const colsSide = 24;
  const stepX = (xEast - xBack) / colsSide;
  const canonSideX = [], restSideX = [];
  for (let i = 0; i <= colsSide; i++) {
    canonSideX.push(xBack + i * stepX);
    restSideX.push(i === 0 ? xWest : xBack + i * stepX);
  }

  if (cfg.sideOverhangCubit) {
    const overhang = cub(cfg.sideOverhangCubit);
    const rows = Math.round(cfg.sideOverhangCubit * 2);
    for (const side of [1, -1]) {
      const geo = makeDrape({ restX: restSideX, canonX: canonSideX, overhang, rows, topY, yTopRef, yBotRef, outSign: side });
      parts.sides.push({ side, geo, position: [0, 0, side * halfW] });
    }
  }
  if (cfg.backOverhangCubit) {
    const overhang = cub(cfg.backOverhangCubit);
    const rows = Math.round(cfg.backOverhangCubit * 2);
    const colsBack = 16;
    const stepZ = (zHalf * 2) / colsBack;
    // ローカルx = -ワールドz(rotation.y=+90°)。両端の列だけ垂れの面(±halfW)まで広げる
    const canonX = [], restX = [];
    for (let i = 0; i <= colsBack; i++) {
      const lx = -zHalf + i * stepZ;
      canonX.push(lx);
      restX.push(i === 0 ? -halfW : i === colsBack ? halfW : lx);
    }
    // 背面はrotation.y=+90°でローカル+zがワールド+x(幕屋の内側)を向くため、外向きは-z
    const geo = makeDrape({ restX, canonX, overhang, rows, topY, yTopRef, yBotRef, outSign: -1 });
    parts.back = { geo, position: [xWest, 0, 0], rotationY: Math.PI / 2 };
  }
  if (cfg.frontOverhangCubit) {
    const overhang = cub(cfg.frontOverhangCubit);
    const flapCenterX = xEntrance + overhang / 2;
    const geo = new THREE.PlaneGeometry(overhang, topWidth, 8, 8);
    applyWindFree(geo, 'none');
    applyRoofSag(geo, {
      spanAxis: 'y', liftAxis: 'z', halfSpan: topWidth / 2, maxSag: ROOF.sagMaxM, liftSign: -1,
      gateAxis: 'x', gateWorldOffset: flapCenterX, gates: roofSagGates,
    });
    parts.flap = { geo, position: [flapCenterX, topY, 0], rotationX: -Math.PI / 2 };
  }
  return parts;
}

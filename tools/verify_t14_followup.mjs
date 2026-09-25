// tools/verify_t14_followup.mjs
//
// T14 差し戻し対応(opus指摘、幕屋の入口の幕のみ。中庭は屋根がないため対象外):
//  1. T11屋根のたるみゲートは x=xEntrance(0) を中心に smoothstep(margin=ROOF_SAG_GATE_MARGIN_M)
//     で0まで抑えているが、入口の幕の布は今回 x=-0.245 へオフセットされ、ゲート中心から
//     ずれたため、その位置でわずかにたるみが残る可能性がある。入口の幕の上端(柱の頂上、
//     x=0のまま)・布の上端(x=-0.245)が、たるんだ屋根の裏面より常に下にあるか
//     (貫通0件・最小クリアランス)を確認する。風による変位(上端行)がゼロであることも確認する。
//  2. 布の側端(z=±zHalf付近)が北壁・南壁の枠(x=-0.245は壁の支持範囲内)に入り込んでいないか
//     (貫通0件・最小クリアランス)を確認する。
//
// 同等性: 屋根のたるみは src/cloth.js の applyRoofSag() を実物のままimportして使用。
// 布の変位式は tools/verify_t14.mjs の shaderDisp()(materials.jsからの書き写し、
// 既にE1で使用・検証済み)を再利用。壁枠の位置は src/tabernacle.js buildFrameWalls()
// の該当行を転記(値は dimensions.js の定数から算出)。
//
// 実行: node tools/verify_t14_followup.mjs

import * as THREE from 'three';
import { applyRoofSag } from '../src/cloth.js';
import { TABERNACLE, ROOF, ROOF_SAG_GATE_MARGIN_M, FRAME } from '../src/dimensions.js';
import { PEDESTAL_H } from '../src/tabernacle.js';
import {
  buildTabernacleEntranceScreen, shaderDisp, windDirVector, checkPoint, WAVE_PERIOD,
} from './verify_t14.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');

// T14差し戻し(2回目、opus決定): 壁枠チェックは tools/verify_t14.mjs 側(E1本体)に
// 恒久的に組み込んだ(screen.obstacles に北壁・南壁の枠40枚を含める)。以後はE1が
// 壁枠チェックの正本。ここでのCheck 2は同じ構築コード(buildWallFrameObstacles相当)
// を使った独立の再確認として残し、E1と一致することを確認する目的のみ。
const WIND_SPEEDS = [0, 1, 5, 10, 20];
const WIND_DIRS = [];
for (let d = 0; d < 360; d += 15) WIND_DIRS.push(d);
const TIME_SAMPLES = 64;

// ---------------------------------------------------------------------------
// 1) 屋根(内側の布、layerIndex=0)の再構築。src/tabernacle.js buildRoofLayer() の
//    "top" パネル部分のみ転記(入口フラップ/側面オーバーハングは x<=0 のこの領域には
//    無関係)。
// ---------------------------------------------------------------------------
function buildInnerRoofTop() {
  const h = PEDESTAL_H + FRAME.height;
  const xBack = TABERNACLE.xBack;
  const xEntrance = TABERNACLE.xEntrance;
  const xVeil = TABERNACLE.xVeil;
  const zHalf = TABERNACLE.zHalf;
  const topLength = ROOF.innerLinen.topLengthCubit * 0.445;
  const topWidth = zHalf * 2 + 0.02;
  const layerIndex = 0; // innerLinen
  const gap = 0.025 * (layerIndex + 1);
  const topY = h + 0.05 + gap;

  const roofSagGates = [
    { x: xBack, margin: ROOF_SAG_GATE_MARGIN_M },
    { x: xVeil, margin: ROOF_SAG_GATE_MARGIN_M },
    { x: xEntrance, margin: ROOF_SAG_GATE_MARGIN_M },
  ];
  const topCenterX = (xBack + xEntrance) / 2;
  const topGeo = new THREE.PlaneGeometry(topLength, topWidth, 96, 32); // 検証用に元(48,8)より細分化して連続関数に近づける
  applyRoofSag(topGeo, {
    spanAxis: 'y', liftAxis: 'z', halfSpan: topWidth / 2, maxSag: ROOF.sagMaxM, liftSign: -1,
    gateAxis: 'x', gateWorldOffset: topCenterX, gates: roofSagGates,
  });
  const mesh = new THREE.Object3D();
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(topCenterX, topY, 0);
  mesh.updateMatrixWorld(true);

  return { geo: topGeo, mesh, topCenterX, topY, topLength, topWidth };
}

// 屋根の裏面高さ(ワールドy)を、実際の(たるんだ)ジオメトリの最近傍グリッド点から
// 双線形補間して求める(applyRoofSagの結果そのものを使うため、たるみ式を再実装しない)。
function makeRoofSampler(roof) {
  const pos = roof.geo.attributes.position;
  const wSeg = roof.geo.parameters.widthSegments;
  const hSeg = roof.geo.parameters.heightSegments;
  const W = wSeg + 1, H = hSeg + 1;
  // ローカル: x in [-topLength/2, topLength/2] (0..wSeg), y in [-topWidth/2, topWidth/2] (0..hSeg)
  const world = new Array(W * H);
  const tmp = new THREE.Vector3();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      tmp.applyMatrix4(roof.mesh.matrixWorld);
      world[i] = { x: tmp.x, y: tmp.y, z: tmp.z };
    }
  }
  return function sampleRoofY(worldX, worldZ) {
    // worldXはtopCenterX+localX(回転で不変)。worldZはlocalY由来。
    const localXFrac = (worldX - (roof.topCenterX - roof.topLength / 2)) / roof.topLength; // 0..1
    const localZFrac = (worldZ - (-roof.topWidth / 2)) / roof.topWidth; // 0..1 (world.z = localY, 符号は要確認のため下で自動判定)
    const cf = THREE.MathUtils.clamp(localXFrac, 0, 1) * wSeg;
    let rf = THREE.MathUtils.clamp(localZFrac, 0, 1) * hSeg;
    const c0 = Math.min(wSeg - 1, Math.floor(cf)); const c1 = c0 + 1; const ct = cf - c0;
    const r0 = Math.min(hSeg - 1, Math.floor(rf)); const r1 = r0 + 1; const rt = rf - r0;
    const y00 = world[r0 * W + c0].y, y10 = world[r0 * W + c1].y, y01 = world[r1 * W + c0].y, y11 = world[r1 * W + c1].y;
    const yTop = y00 * (1 - ct) + y10 * ct;
    const yBot = y01 * (1 - ct) + y11 * ct;
    return yTop * (1 - rt) + yBot * rt;
  };
}

// ---------------------------------------------------------------------------
// 2) 北壁・南壁の枠(20枚ずつ)。src/tabernacle.js buildFrameWalls() 66-79行目を転記。
// ---------------------------------------------------------------------------
function buildWallFrameBoxes() {
  const w = FRAME.width, t = FRAME.thickness, h = FRAME.height;
  const xBack = TABERNACLE.xBack, zHalf = TABERNACLE.zHalf;
  const boxes = [];
  for (const side of [1, -1]) {
    const z = side * (zHalf + t / 2);
    for (let i = 0; i < FRAME.counts.north; i++) {
      const x = xBack + (i + 0.5) * w;
      const halfX = (w * 0.97) / 2;
      const halfZ = t / 2;
      boxes.push({
        side: side === 1 ? 'south' : 'north', i,
        x, z, halfX, halfZ,
        y0: PEDESTAL_H, y1: PEDESTAL_H + h,
      });
    }
  }
  return boxes;
}

function pointInBox(px, py, pz, box) {
  const inside = Math.abs(px - box.x) <= box.halfX && Math.abs(pz - box.z) <= box.halfZ && py >= box.y0 && py <= box.y1;
  const margin = Math.max(Math.abs(px - box.x) - box.halfX, Math.abs(pz - box.z) - box.halfZ, box.y0 - py, py - box.y1);
  return { inside, margin };
}

// ---------------------------------------------------------------------------
// Check 1: 屋根クリアランス
// ---------------------------------------------------------------------------
function checkRoofClearance(screen) {
  const roof = buildInnerRoofTop();
  const sampleRoofY = makeRoofSampler(roof);

  // 1a. 布の最上段(v=1, windFree=0)の変位が常にゼロであることを確認。
  const posAttr = screen.geo.attributes.position;
  const windFreeAttr = screen.geo.attributes.windFree;
  const pillarGateAttr = screen.geo.attributes.pillarGate;
  const pillarScreenMaskAttr = screen.geo.attributes.pillarScreenMask;
  let maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) if (posAttr.getY(i) > maxY) maxY = posAttr.getY(i);
  const topRowIdx = [];
  for (let i = 0; i < posAttr.count; i++) if (Math.abs(posAttr.getY(i) - maxY) < 1e-6) topRowIdx.push(i);

  const localNormal = new THREE.Vector3(0, 0, 1);
  const worldNormal = localNormal.clone().transformDirection(screen.mesh.matrixWorld);
  let maxTopRowDisp = 0;
  for (const uWindSpeed of WIND_SPEEDS) {
    for (const dirDeg of WIND_DIRS) {
      const uWindDir = windDirVector(dirDeg);
      for (let ti = 0; ti < TIME_SAMPLES; ti++) {
        const uTime = (WAVE_PERIOD * ti) / TIME_SAMPLES;
        for (const i of topRowIdx) {
          const disp = shaderDisp({
            uWindSpeed, uWindDir, uTime,
            posX: posAttr.getX(i), posY: posAttr.getY(i),
            windFree: windFreeAttr.getX(i), pillarGate: pillarGateAttr.getX(i), pillarScreenMask: pillarScreenMaskAttr.getX(i),
            normal: worldNormal,
          });
          const mag = Math.max(Math.abs(disp.x), Math.abs(disp.y), Math.abs(disp.z));
          if (mag > maxTopRowDisp) maxTopRowDisp = mag;
        }
      }
    }
  }

  // 1b. 布の上端(x=screen.mesh.position.x、風変位ゼロ確認済みなので静止形状のみ)と
  //     柱の頂上(x=0)について、z方向に密にサンプリングし、屋根裏面との最小クリアランスを求める。
  const clothTopX = screen.mesh.position.x;
  const clothTopY = screen.height; // 布はy:[0,height]、上端=height (position.y=height/2 + 局所+height/2)
  const pillarTopX = 0;
  const pillarTopY = TABERNACLE.entranceScreen.height;

  const N = 2001;
  let worstClothMargin = Infinity, worstClothZ = null, clothPenetrations = 0;
  let worstPillarMargin = Infinity, worstPillarZ = null, pillarPenetrations = 0;
  for (let k = 0; k < N; k++) {
    const z = -screen.width / 2 + (screen.width * k) / (N - 1);
    const roofYAtCloth = sampleRoofY(clothTopX, z);
    const clothMargin = roofYAtCloth - clothTopY; // >0: 屋根が布上端より上(安全)
    if (clothMargin < worstClothMargin) { worstClothMargin = clothMargin; worstClothZ = z; }
    if (clothMargin < 0) clothPenetrations++;

    const roofYAtPillar = sampleRoofY(pillarTopX, z);
    const pillarMargin = roofYAtPillar - pillarTopY;
    if (pillarMargin < worstPillarMargin) { worstPillarMargin = pillarMargin; worstPillarZ = z; }
    if (pillarMargin < 0) pillarPenetrations++;
  }

  return {
    maxTopRowDisp,
    cloth: { x: clothTopX, topY: clothTopY, worstMargin: worstClothMargin, worstZ: worstClothZ, penetrations: clothPenetrations, sampleCount: N },
    pillarTop: { x: pillarTopX, topY: pillarTopY, worstMargin: worstPillarMargin, worstZ: worstPillarZ, penetrations: pillarPenetrations, sampleCount: N },
    roofMeta: { topCenterX: roof.topCenterX, topY: roof.topY, topLength: roof.topLength, topWidth: roof.topWidth, sagMaxM: ROOF.sagMaxM, gateMarginM: ROOF_SAG_GATE_MARGIN_M },
  };
}

// ---------------------------------------------------------------------------
// Check 2: 壁枠との重なり
// ---------------------------------------------------------------------------
function checkWallFrameOverlap(screen) {
  const boxes = buildWallFrameBoxes();
  const posAttr = screen.geo.attributes.position;
  const windFreeAttr = screen.geo.attributes.windFree;
  const pillarGateAttr = screen.geo.attributes.pillarGate;
  const pillarScreenMaskAttr = screen.geo.attributes.pillarScreenMask;
  const localNormal = new THREE.Vector3(0, 0, 1);
  const worldNormal = localNormal.clone().transformDirection(screen.mesh.matrixWorld);

  let penetrations = 0;
  let worstMargin = Infinity;
  let worstCase = null;
  const tmp = new THREE.Vector3();

  // 候補: 壁枠のうちscreenのx(-0.245)近傍のものだけに絞ると見落とすリスクがあるため、
  // 全40枚(北20+南20)を対象にする(枚数が少ないので計算コストは無視できる)。
  for (const uWindSpeed of WIND_SPEEDS) {
    for (const dirDeg of WIND_DIRS) {
      const uWindDir = windDirVector(dirDeg);
      for (let ti = 0; ti < TIME_SAMPLES; ti++) {
        const uTime = (WAVE_PERIOD * ti) / TIME_SAMPLES;
        for (let i = 0; i < posAttr.count; i++) {
          const posX = posAttr.getX(i), posY = posAttr.getY(i);
          const disp = shaderDisp({
            uWindSpeed, uWindDir, uTime, posX, posY,
            windFree: windFreeAttr.getX(i), pillarGate: pillarGateAttr.getX(i), pillarScreenMask: pillarScreenMaskAttr.getX(i),
            normal: worldNormal,
          });
          tmp.set(posX + disp.x, posY + disp.y, disp.z);
          tmp.applyMatrix4(screen.mesh.matrixWorld);

          for (const box of boxes) {
            const { inside, margin } = pointInBox(tmp.x, tmp.y, tmp.z, box);
            if (inside) {
              penetrations++;
              if (margin < worstMargin) { worstMargin = margin; worstCase = { uWindSpeed, dirDeg, uTime, i, box: { side: box.side, i: box.i }, world: { x: tmp.x, y: tmp.y, z: tmp.z } }; }
            } else if (margin < worstMargin) {
              worstMargin = margin;
            }
          }
        }
      }
    }
  }

  return { penetrations, worstMargin, worstCase, boxCount: boxes.length };
}

// ---------------------------------------------------------------------------
const screen = buildTabernacleEntranceScreen();
console.log(`[tabernacle entranceScreen] clothX=${screen.mesh.position.x}, pillarX=0`);

const t0 = Date.now();
const roofResult = checkRoofClearance(screen);
const t1 = Date.now();
const wallResult = checkWallFrameOverlap(screen);
const t2 = Date.now();

console.log(`roof check: ${t1 - t0}ms, wall check: ${t2 - t1}ms`);
console.log('\n=== Check 1: 屋根クリアランス ===');
console.log('布上端(v=1)の風変位 最大値(全風速×全風向×64時刻):', roofResult.maxTopRowDisp, '(0であるべき)');
console.log('布上端 vs 屋根裏面:', JSON.stringify(roofResult.cloth, null, 2));
console.log('柱頂上(x=0) vs 屋根裏面:', JSON.stringify(roofResult.pillarTop, null, 2));
console.log('roofMeta:', JSON.stringify(roofResult.roofMeta, null, 2));

console.log('\n=== Check 2: 壁枠との重なり ===');
console.log(`penetrations=${wallResult.penetrations}, worstMargin=${wallResult.worstMargin}, boxCount=${wallResult.boxCount}`);
if (wallResult.worstCase) console.log('worstCase:', JSON.stringify(wallResult.worstCase, null, 2));

fs.writeFileSync(path.join(LOG_DIR, 'verify_t14_followup.json'), JSON.stringify({ roofResult, wallResult }, null, 2));
console.log('\n詳細は log/verify_t14_followup.json に保存しました。');

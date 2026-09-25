// tools/verify_t14.mjs
//
// T14 E1(数値検証)。中庭の入口の幕・幕屋の入口の幕の両方について、風速・風向・
// uTimeの格子上で頂点シェーダーの変位式をCPU側で再現し、変位後の頂点が柱の体積
// (台座/柱身/柱頭の実形状)に入らないことを確認する。
//
// 同等性の確保方法:
//  - ジオメトリ生成(PlaneGeometry)・windFree/pillarGate/pillarScreenMask属性の
//    焼き込み・幅方向分割数(pillarClearanceSegments)は、実際のプロダクションコード
//    (src/cloth.js)を「そのままimportして」使う(three.jsも実物をnode_modules/three
//    に配置してimport。DOM非依存の部分のみ使用)。手で再実装していないため、
//    ジオメトリ側は完全に同一。
//  - メッシュの位置・回転(position/rotation.y)は src/courtyard.js・src/tabernacle.js
//    の該当コードを転記(値は import した dimensions.js の定数から算出)。
//    THREE.Object3D.updateMatrixWorld() で実際のmatrixWorldを計算するため、
//    ワールド変換自体は手計算していない。
//  - 頂点シェーダーの変位式(GLSL, src/materials.js 490-525行目)だけは、
//    materials.js が document.createElement (canvas) に依存しておりNode単体では
//    importできないため、この式を1行ずつJSへ書き写した(下記 shaderDisp() )。
//    書き写した式を下部に該当するGLSLと並べてコメントしてあるので目視で照合できる。
//    定数(PILLAR_GAP_M, PILLAR_GATE_SAFETY, SAFE_ALONG_M)も同じ値を手で複製して
//    いるため、materials.js を変更した場合はこのファイルも合わせて更新が必要
//    (このファイル冒頭にその旨のコメントを置いている)。
//
// 実行: node tools/verify_t14.mjs

import * as THREE from 'three';
import { applyWindFree, applyPillarGate, pillarClearanceSegments } from '../src/cloth.js';
import { COURTYARD, TABERNACLE, FRAME, PILLAR_CLEARANCE_GAP_M } from '../src/dimensions.js';
import { PEDESTAL_H } from '../src/tabernacle.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// T14差し戻し対応(屋根・壁枠チェック)用に、tools/verify_t14_followup.mjs から
// shaderDisp()・windDirVector()・checkPoint()・buildTabernacleEntranceScreen()・
// WAVE_PERIOD をimportして再利用できるようexportする。直接実行時のみ下部の
// E1本体(頂点/辺走査)を動かす(import時の二重実行を避けるためのガード)。
const isMainModule = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// シェーダー定数の複製(要: src/materials.js と同じ値を保つこと。変更時は両方
// 更新する)。2026-09-25時点の src/materials.js 478-480行目と同一。
// ---------------------------------------------------------------------------
const PILLAR_GAP_M = PILLAR_CLEARANCE_GAP_M; // materials.js: const float PILLAR_GAP_M = ${PILLAR_CLEARANCE_GAP_M};
const PILLAR_GATE_SAFETY = 0.8;              // materials.js: const float PILLAR_GATE_SAFETY = 0.8;
const SAFE_ALONG_M = 0.1;                    // materials.js: const float SAFE_ALONG_M = 0.1;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function mix(a, b, t) { return a * (1 - t) + b * t; }

// setWind()と同じ変換(src/materials.js 400-408行目)。dirFromDeg: 風が「吹いてくる」方位(度)。
export function windDirVector(dirFromDeg) {
  const rad = THREE.MathUtils.degToRad(dirFromDeg);
  const fromX = Math.sin(rad), fromZ = -Math.cos(rad);
  return { x: -fromX, y: -fromZ }; // uWindDir = (吹いていく方向のx, z)
}

// src/materials.js 493-524行目のGLSLを1行ずつ書き写したもの(vec3を{x,y,z}に展開)。
// 左のコメントに対応するGLSL行を添える。
export function shaderDisp({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, normal }) {
  const amp = uWindSpeed * uWindSpeed * 0.0018; // float amp = uWindSpeed * uWindSpeed * 0.0018;
  const windToDot = normal.x * uWindDir.x + normal.z * uWindDir.y; // windToDot = vEnvWorldNormal.x*uWindDir.x + vEnvWorldNormal.z*uWindDir.y;
  const push = clamp(-windToDot, 0, 1); // push = clamp(-windToDot,0,1)
  const flutterBias = clamp(windToDot, 0, 1); // flutterBias = clamp(windToDot,0,1)
  const wave = Math.sin(posX * 2.2 + posY * 1.3 + uTime * 2.6) * 0.6
             + Math.sin(posX * 5.1 - uTime * 4.3) * 0.4; // wave = sin(...)*0.6 + sin(...)*0.4
  const mag = amp * windFree; // mag = amp*windFree
  let dispX = uWindDir.x * mag * (push * 0.5 + (0.5 + flutterBias) * wave); // disp = vec3(uWindDir.x,0,uWindDir.y)*mag*(...)
  let dispZ = uWindDir.y * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
  let dispY = mag * 0.25 * Math.sin(uTime * 6.0 + posX * 7.0 + posY * 3.0); // disp.y += mag*0.25*sin(...)

  const pillarAllowOut = Math.max(PILLAR_GAP_M * PILLAR_GATE_SAFETY, 1e-5); // pillarAllowOut
  const dispZGated = dispZ > 0.0 ? pillarAllowOut * (1.0 - Math.exp(-dispZ / pillarAllowOut)) : dispZ; // dispZGated
  dispZ = mix(dispZ, dispZGated, pillarGate); // disp.z = mix(disp.z, dispZGated, pillarGate);

  const alongCapped = dispX >= 0.0
    ? SAFE_ALONG_M * (1.0 - Math.exp(-dispX / SAFE_ALONG_M))
    : -SAFE_ALONG_M * (1.0 - Math.exp(dispX / SAFE_ALONG_M)); // alongCapped
  dispX = mix(dispX, alongCapped, pillarScreenMask); // disp.x = mix(disp.x, alongCapped, pillarScreenMask);
  dispX = mix(dispX, 0.0, pillarGate); // disp.x = mix(disp.x, 0.0, pillarGate); (T14差し戻しOption1)

  return { x: dispX, y: dispY, z: dispZ };
}

// ---------------------------------------------------------------------------
// 画面(スクリーン)構築: src/courtyard.js・src/tabernacle.js の該当箇所を転記。
// ---------------------------------------------------------------------------
function postsAlongEdge(n, length, center = 0) {
  const positions = [];
  if (n === 1) { positions.push(center); return positions; }
  const step = length / (n - 1);
  for (let i = 0; i < n; i++) positions.push(center - length / 2 + i * step);
  return positions;
}

function buildCourtyardEntranceScreen() {
  const halfL = (COURTYARD.lengthCubit * 0.445) / 2;
  const hangH = COURTYARD.hangingHeight;
  const x = halfL;
  const zs = postsAlongEdge(COURTYARD.postCounts.entrance, COURTYARD.entranceWidth, 0);
  const offsetHalfExtent = COURTYARD.entrancePostHalfExtent;
  const offset = offsetHalfExtent + PILLAR_CLEARANCE_GAP_M;
  const clothX = x - offset;
  const pillarSpacing = COURTYARD.entranceWidth / (COURTYARD.postCounts.entrance - 1);
  const baseWidthSegments = Math.max(4, Math.round(COURTYARD.entranceWidth * 2));
  const widthSegments = pillarClearanceSegments(COURTYARD.entranceWidth, pillarSpacing, offsetHalfExtent, baseWidthSegments);

  const geo = new THREE.PlaneGeometry(COURTYARD.entranceWidth, hangH, widthSegments, 12);
  applyWindFree(geo, 'entranceCurtain');
  const gateInfo = applyPillarGate(geo, zs.map((z) => -z), offsetHalfExtent);

  const mesh = new THREE.Object3D();
  mesh.position.set(clothX, hangH / 2, 0);
  mesh.rotation.y = Math.PI / 2;
  mesh.updateMatrixWorld(true);

  // 柱(makePost): 台座(銅)・柱身・柱頭(銀)
  const pedH = COURTYARD.pedestalSize.y;
  const capitalR = COURTYARD.postDiameter / 2 + COURTYARD.capitalRadiusGrowth;
  const pillars = zs.map((z) => ({
    x, z,
    parts: [
      { type: 'box', cy0: 0, cy1: pedH, halfX: COURTYARD.pedestalSize.x / 2, halfZ: COURTYARD.pedestalSize.z / 2, name: '台座' },
      { type: 'cyl', cy0: pedH, cy1: hangH, r: COURTYARD.postDiameter / 2, name: '柱身' },
      { type: 'cyl', cy0: hangH - COURTYARD.capitalHeight, cy1: hangH, r: capitalR, name: '柱頭' },
    ],
  }));

  return { name: 'courtyard', geo, mesh, gateInfo, pillars, obstacles: pillars, offsetHalfExtent, width: COURTYARD.entranceWidth, height: hangH, widthSegments, heightSegments: 12 };
}

// T14差し戻し(opus指摘): 幕屋の入口の幕のみ対象。北壁・南壁の枠(各20枚)を、
// checkPoint()が扱う「柱」と同じ形({x,z,parts:[{type:'box',...}]})で構築する。
// src/tabernacle.js buildFrameWalls() 66-79行目を転記。
function buildWallFrameObstacles() {
  const w = FRAME.width, t = FRAME.thickness, h = FRAME.height;
  const xBack = TABERNACLE.xBack, zHalf = TABERNACLE.zHalf;
  const halfX = (w * 0.97) / 2;
  const halfZ = t / 2;
  const obstacles = [];
  for (const side of [1, -1]) {
    const z = side * (zHalf + t / 2);
    for (let i = 0; i < FRAME.counts.north; i++) {
      const x = xBack + (i + 0.5) * w;
      obstacles.push({
        x, z,
        parts: [{ type: 'box', cy0: PEDESTAL_H, cy1: PEDESTAL_H + h, halfX, halfZ, name: `${side === 1 ? '南' : '北'}壁枠#${i}` }],
      });
    }
  }
  return obstacles;
}

export function buildTabernacleEntranceScreen() {
  const { pillarCount, height, width } = TABERNACLE.entranceScreen;
  const x = TABERNACLE.xEntrance;
  const step = width / (pillarCount - 1);
  const zs = [];
  for (let i = 0; i < pillarCount; i++) zs.push(-width / 2 + i * step);

  const offsetHalfExtent = TABERNACLE.screenPillar.halfExtent;
  const offset = offsetHalfExtent + PILLAR_CLEARANCE_GAP_M;
  const clothX = x - offset;
  const baseWidthSegments = 20;
  const widthSegments = pillarClearanceSegments(width, step, offsetHalfExtent, baseWidthSegments);

  const geo = new THREE.PlaneGeometry(width, height, widthSegments, 14);
  applyWindFree(geo, 'entranceCurtain');
  const gateInfo = applyPillarGate(geo, zs.map((z) => -z), offsetHalfExtent);

  const mesh = new THREE.Object3D();
  mesh.position.set(clothX, height / 2, 0);
  mesh.rotation.y = Math.PI / 2;
  mesh.updateMatrixWorld(true);

  const pedH = 0.2; // pedestalMaterial: 'bronze' => pedH=0.2 (buildScreen)
  const pillars = zs.map((z) => ({
    x, z,
    parts: [
      { type: 'box', cy0: 0, cy1: pedH, halfX: TABERNACLE.screenPillar.socketHalfExtent, halfZ: TABERNACLE.screenPillar.socketHalfExtent, name: '台座' },
      { type: 'cyl', cy0: pedH, cy1: height, r: TABERNACLE.screenPillar.radius, name: '柱身' },
    ],
  }));

  const wallObstacles = buildWallFrameObstacles();
  return { name: 'tabernacle', geo, mesh, gateInfo, pillars, wallObstacles, obstacles: [...pillars, ...wallObstacles], offsetHalfExtent, width, height, widthSegments, heightSegments: 14 };
}

// ---------------------------------------------------------------------------
// 貫通判定
// ---------------------------------------------------------------------------
export function partContainment(px, py, pz, pillar, part) {
  if (py < part.cy0 || py > part.cy1) return { inside: false, margin: Infinity };
  const dx = px - pillar.x, dz = pz - pillar.z;
  if (part.type === 'box') {
    const inside = Math.abs(dx) <= part.halfX && Math.abs(dz) <= part.halfZ;
    const margin = Math.max(Math.abs(dx) - part.halfX, Math.abs(dz) - part.halfZ);
    return { inside, margin }; // margin<0 のとき内部(貫通深さ=-margin)
  }
  const dist = Math.sqrt(dx * dx + dz * dz);
  const margin = dist - part.r;
  return { inside: margin < 0, margin };
}

// 1点についてすべての柱・部位をチェックし、貫通の有無と最小マージンを返す。
export function checkPoint(px, py, pz, pillars) {
  let anyInside = false;
  let minMargin = Infinity;
  for (const pillar of pillars) {
    for (const part of pillar.parts) {
      const { inside, margin } = partContainment(px, py, pz, pillar, part);
      if (inside) anyInside = true;
      if (margin < minMargin) minMargin = margin;
    }
  }
  return { inside: anyInside, minMargin };
}

// ---------------------------------------------------------------------------
// 検証本体
// ---------------------------------------------------------------------------
export const WAVE_PERIOD = (2 * Math.PI) / 2.6; // uTime*2.6 が最も遅い項(周期 ≈2.4166s)
const TIME_SAMPLES = 64;
const WIND_SPEEDS_BASE = [0, 10, 20];
// T14差し戻し(opus指摘): 壁枠チェックを含む幕屋入口の幕は、貫通が低風速でも
// 発生しうることが分かったため(以前のOption1適用前の実測)、1・5 m/sも追加する。
const WIND_SPEEDS_WALL = [0, 1, 5, 10, 20];
const WIND_DIRS = [];
for (let d = 0; d < 360; d += 15) WIND_DIRS.push(d);

function windSpeedsFor(screen) {
  return screen.wallObstacles && screen.wallObstacles.length ? WIND_SPEEDS_WALL : WIND_SPEEDS_BASE;
}

function runScreen(screen) {
  const posAttr = screen.geo.attributes.position;
  const windFreeAttr = screen.geo.attributes.windFree;
  const pillarGateAttr = screen.geo.attributes.pillarGate;
  const pillarScreenMaskAttr = screen.geo.attributes.pillarScreenMask;

  // 静止時のワールド法線 (0,0,1)をmatrixWorldで変換(実物のシェーダーと同じ計算)。
  const localNormal = new THREE.Vector3(0, 0, 1);
  const worldNormal = localNormal.clone().transformDirection(screen.mesh.matrixWorld);

  let penetrations = 0;
  let worstMargin = Infinity;
  let worstCase = null;
  let maxBulgeBetween = -Infinity; // 柱の間(pillarGate低)での外側(+x)への最大変位
  let maxBulgeCase = null;
  const restWorldX = screen.mesh.position.x;

  const tmp = new THREE.Vector3();
  const windSpeeds = windSpeedsFor(screen);

  for (const uWindSpeed of windSpeeds) {
    for (const dirDeg of WIND_DIRS) {
      const uWindDir = windDirVector(dirDeg);
      for (let ti = 0; ti < TIME_SAMPLES; ti++) {
        const uTime = (WAVE_PERIOD * ti) / TIME_SAMPLES;
        for (let i = 0; i < posAttr.count; i++) {
          const posX = posAttr.getX(i);
          const posY = posAttr.getY(i);
          const windFree = windFreeAttr.getX(i);
          const pillarGate = pillarGateAttr.getX(i);
          const pillarScreenMask = pillarScreenMaskAttr.getX(i);

          const disp = shaderDisp({
            uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, normal: worldNormal,
          });

          tmp.set(posX + disp.x, posY + disp.y, 0 + disp.z);
          tmp.applyMatrix4(screen.mesh.matrixWorld);

          const { inside, minMargin } = checkPoint(tmp.x, tmp.y, tmp.z, screen.obstacles);
          if (inside) {
            penetrations++;
            if (minMargin < worstMargin) {
              worstMargin = minMargin;
              worstCase = { uWindSpeed, dirDeg, uTime, i, world: { x: tmp.x, y: tmp.y, z: tmp.z } };
            }
          } else if (minMargin < worstMargin) {
            worstMargin = minMargin;
          }

          if (pillarGate < 0.05) {
            const bulge = tmp.x - restWorldX; // +方向(外側)への変位
            if (bulge > maxBulgeBetween) {
              maxBulgeBetween = bulge;
              maxBulgeCase = { uWindSpeed, dirDeg, uTime, i, world: { x: tmp.x, y: tmp.y, z: tmp.z } };
            }
          }
        }
      }
    }
  }

  return { penetrations, worstMargin, worstCase, maxBulgeBetween, maxBulgeCase, restWorldX };
}

// ---------------------------------------------------------------------------
// 辺(頂点間の三角形の辺)サンプリング: 最大風速・全風向・粗めのuTimeで、
// 隣接頂点間(横・縦・対角)を細かく補間してチェックする。頂点解像度によらず
// 安全であることの数学的根拠は cloth.js のコメント参照。ここでは実装ミスの
// 検出を主目的として、実際にサンプリングして確認する。
function runEdges(screen) {
  const posAttr = screen.geo.attributes.position;
  const windFreeAttr = screen.geo.attributes.windFree;
  const pillarGateAttr = screen.geo.attributes.pillarGate;
  const pillarScreenMaskAttr = screen.geo.attributes.pillarScreenMask;
  const localNormal = new THREE.Vector3(0, 0, 1);
  const worldNormal = localNormal.clone().transformDirection(screen.mesh.matrixWorld);

  const W = screen.widthSegments + 1, H = screen.heightSegments + 1;
  const idx = (c, r) => r * W + c;

  function vertexWorld(i, uWindSpeed, uWindDir, uTime) {
    const posX = posAttr.getX(i), posY = posAttr.getY(i);
    const windFree = windFreeAttr.getX(i), pillarGate = pillarGateAttr.getX(i), pillarScreenMask = pillarScreenMaskAttr.getX(i);
    const disp = shaderDisp({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, normal: worldNormal });
    const v = new THREE.Vector3(posX + disp.x, posY + disp.y, disp.z);
    v.applyMatrix4(screen.mesh.matrixWorld);
    return v;
  }

  const EDGE_SAMPLES = 12; // 区間内部の補間点数
  const TIME_SAMPLES_EDGE = 24;
  let penetrations = 0;
  let worstMargin = Infinity;
  let worstCase = null;
  let checkedEdges = 0;

  const uWindSpeed = 20; // 最も変位が大きい(=最も危険な)風速のみ、全方位・粗めの時刻で辺を確認
  for (const dirDeg of WIND_DIRS) {
    const uWindDir = windDirVector(dirDeg);
    for (let ti = 0; ti < TIME_SAMPLES_EDGE; ti++) {
      const uTime = (WAVE_PERIOD * ti) / TIME_SAMPLES_EDGE;
      // 各セルについて、横・縦・対角の3辺をチェック(隣接セルと共有するため
      // 全体としてグリッドの全辺+両対角をカバーする)。
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const iCur = idx(c, r);
          const vCur = vertexWorld(iCur, uWindSpeed, uWindDir, uTime);
          const neighbors = [];
          if (c + 1 < W) neighbors.push(idx(c + 1, r));
          if (r + 1 < H) neighbors.push(idx(c, r + 1));
          if (c + 1 < W && r + 1 < H) neighbors.push(idx(c + 1, r + 1));
          for (const iNb of neighbors) {
            const vNb = vertexWorld(iNb, uWindSpeed, uWindDir, uTime);
            checkedEdges++;
            for (let s = 1; s < EDGE_SAMPLES; s++) {
              const t = s / EDGE_SAMPLES;
              const px = vCur.x + (vNb.x - vCur.x) * t;
              const py = vCur.y + (vNb.y - vCur.y) * t;
              const pz = vCur.z + (vNb.z - vCur.z) * t;
              const { inside, minMargin } = checkPoint(px, py, pz, screen.obstacles);
              if (inside) {
                penetrations++;
                if (minMargin < worstMargin) { worstMargin = minMargin; worstCase = { uWindSpeed, dirDeg, uTime, t, world: { x: px, y: py, z: pz } }; }
              } else if (minMargin < worstMargin) {
                worstMargin = minMargin;
              }
            }
          }
        }
      }
    }
  }

  return { penetrations, worstMargin, worstCase, checkedEdges };
}

// ---------------------------------------------------------------------------
// wallHanging/roofDrape 回帰確認: pillarGate=pillarScreenMask=0 のとき、
// 今回追加したmix()系の分岐がすべて恒等(=元の disp と完全一致)になることを
// 数値的に確認する(T14変更前のdisp式 = vec3(uWindDir.x,0,uWindDir.y)*mag*(...)
// + 垂直成分、のみ)。
function checkNonEntranceUnchanged() {
  const originalDisp = ({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, normal }) => {
    const amp = uWindSpeed * uWindSpeed * 0.0018;
    const windToDot = normal.x * uWindDir.x + normal.z * uWindDir.y;
    const push = clamp(-windToDot, 0, 1);
    const flutterBias = clamp(windToDot, 0, 1);
    const wave = Math.sin(posX * 2.2 + posY * 1.3 + uTime * 2.6) * 0.6
               + Math.sin(posX * 5.1 - uTime * 4.3) * 0.4;
    const mag = amp * windFree;
    const dispX = uWindDir.x * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
    const dispZ = uWindDir.y * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
    const dispY = mag * 0.25 * Math.sin(uTime * 6.0 + posX * 7.0 + posY * 3.0);
    return { x: dispX, y: dispY, z: dispZ };
  };

  let maxDiff = 0;
  let samples = 0;
  const normal = { x: 1, y: 0, z: 0 };
  for (const uWindSpeed of [0, 10, 20]) {
    for (let dirDeg = 0; dirDeg < 360; dirDeg += 30) {
      const uWindDir = windDirVector(dirDeg);
      for (let ti = 0; ti < 16; ti++) {
        const uTime = (WAVE_PERIOD * ti) / 16;
        for (let posX = -3; posX <= 3; posX += 0.7) {
          for (let posY = -1; posY <= 1; posY += 0.5) {
            for (const windFree of [0, 0.14, 0.28, 0.32]) { // wallHanging最大0.28, roofDrape最大0.32
              samples++;
              const a = originalDisp({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, normal });
              const b = shaderDisp({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate: 0, pillarScreenMask: 0, normal });
              const diff = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
              if (diff > maxDiff) maxDiff = diff;
            }
          }
        }
      }
    }
  }
  return { samples, maxDiff };
}

// ---------------------------------------------------------------------------
if (isMainModule) {
const results = {};
const screens = [buildCourtyardEntranceScreen(), buildTabernacleEntranceScreen()];

for (const screen of screens) {
  console.log(`[${screen.name}] widthSegments=${screen.widthSegments} (${screen.width}m / ${screen.widthSegments} = ${(screen.width / screen.widthSegments).toFixed(4)}m spacing), offsetHalfExtent=${screen.offsetHalfExtent}, gate=${JSON.stringify(screen.gateInfo)}, obstacles=${screen.obstacles.length}(pillars=${screen.pillars.length}${screen.wallObstacles ? ', wallFrames=' + screen.wallObstacles.length : ''}), windSpeeds=${JSON.stringify(windSpeedsFor(screen))}`);
  const t0 = Date.now();
  const vertexResult = runScreen(screen);
  const t1 = Date.now();
  const edgeResult = runEdges(screen);
  const t2 = Date.now();
  console.log(`  vertex sweep: ${(t1 - t0)}ms, edge sweep: ${(t2 - t1)}ms`);
  results[screen.name] = { vertexResult, edgeResult, meta: { widthSegments: screen.widthSegments, offsetHalfExtent: screen.offsetHalfExtent, gateInfo: screen.gateInfo, restWorldX: screen.mesh.position.x, windSpeeds: windSpeedsFor(screen), obstacleCount: screen.obstacles.length } };
}

const regression = checkNonEntranceUnchanged();

const summary = {
  timestamp: new Date().toISOString(),
  windSpeedsBase: WIND_SPEEDS_BASE,
  windSpeedsWall: WIND_SPEEDS_WALL,
  windDirs: WIND_DIRS,
  timeSamples: TIME_SAMPLES,
  wavePeriodSec: WAVE_PERIOD,
  screens: results,
  wallHangingRoofDrapeRegression: regression,
};

fs.writeFileSync(path.join(LOG_DIR, 'verify_t14.json'), JSON.stringify(summary, null, 2));

console.log('\n=== E1 結果 ===');
for (const [name, r] of Object.entries(results)) {
  console.log(`\n[${name}]`);
  console.log(`  頂点走査: penetrations=${r.vertexResult.penetrations}, minMargin=${r.vertexResult.worstMargin.toFixed(5)}m`);
  if (r.vertexResult.worstCase) console.log('  worstCase(頂点):', JSON.stringify(r.vertexResult.worstCase));
  console.log(`  辺走査(20m/s,全方位,${24}時刻,辺${r.edgeResult.checkedEdges}本×内分点11): penetrations=${r.edgeResult.penetrations}, minMargin=${r.edgeResult.worstMargin.toFixed(5)}m`);
  if (r.edgeResult.worstCase) console.log('  worstCase(辺):', JSON.stringify(r.edgeResult.worstCase));
  console.log(`  柱の間の最大外側バルジ(pillarGate<0.05の頂点でのworldX-restX最大値): ${r.vertexResult.maxBulgeBetween.toFixed(4)}m`);
}
console.log(`\n[wallHanging/roofDrape回帰] samples=${regression.samples}, maxDiff=${regression.maxDiff} (0であるべき)`);
console.log('\n詳細は log/verify_t14.json に保存しました。');
}

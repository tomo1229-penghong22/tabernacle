// tools/verify_t15.mjs
//
// T15 G1/G2/G3(数値検証)。幕屋の南北側面・西の背面の屋根の垂れ4層について、
//   G1 風速・風向・uTimeの格子で頂点シェーダーの変位式をCPU側で再現し、変位後の頂点が
//      枠・横木・銀の台座の体積に入らないこと
//   G2 同じ条件で4層の重なり順(壁の外向き: 亜麻布<ヤギ毛<雄羊<アザラシ)が保たれること
//   G3 屋根上面が枠の上端を外面まで覆い、上面と垂れの継ぎ目にすき間がないこと
//      (+ T11 D1: 内側の層が外側の層より上に出ない)
// を数値で出す。
//
// 同等性の確保方法(verify_t14.mjs と同じ):
//  - 屋根のジオメトリ・メッシュの位置と回転は src/roofLayout.js の buildRoofLayerParts()
//    を「そのままimportして」使う(tabernacle.js はこの関数の結果をメッシュ化しているだけ)。
//    windFree/wallOutSign/drapeUV/pillarGate等の属性も本番のcloth.jsが焼いたものを読む。
//  - 枠・横木・台座の体積は src/dimensions.js の寸法定数(FRAME, TABERNACLE, PEDESTAL_H,
//    silverSocketSize など)から、tabernacle.js buildFrameWalls/buildCrossbars の配置規則に
//    従って計算する(テスト側で寸法を独自に持たない)。
//  - 頂点シェーダーの変位式(src/materials.js の beginVertexInject)は、materials.js が
//    canvas に依存してNode単体ではimportできないため、1行ずつJSへ書き写した
//    (下記 shaderDisp15。GLSLの該当行を右にコメントで併記)。定数は dimensions.js から
//    import する。materials.js のその部分を変更した場合はこのファイルも更新すること。
//
// 実行: node tools/verify_t15.mjs   (結果は log/verify_t15.json)

import * as THREE from 'three';
import { FRAME, TABERNACLE, ROOF, PEDESTAL_H, FRAME_SOCKET_W_RATIO, silverSocketSize,
  ROOF_DRAPE_INWARD_CAP_M, PILLAR_CLEARANCE_GAP_M, cub } from '../src/dimensions.js';
import { buildRoofLayerParts, drapeOffsetM, ROOF_BASE_Y } from '../src/roofLayout.js';
import { shaderDisp as shaderDispT14, windDirVector } from './verify_t14.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
fs.mkdirSync(LOG_DIR, { recursive: true });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a * (1 - t) + b * t;

// --- シェーダー定数(materials.js と同じ値) ---
const PILLAR_GAP_M = PILLAR_CLEARANCE_GAP_M;
const PILLAR_GATE_SAFETY = 0.8;
const SAFE_ALONG_M = 0.1;
const DRAPE_INWARD_CAP_M = ROOF_DRAPE_INWARD_CAP_M;

// src/materials.js の beginVertexInject を書き写したもの。out に {x,y,z}(ローカル変位)を返す。
function shaderDisp15(a, out) {
  const { uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, wallOutSign, drapeU, drapeV, normal } = a;
  const amp = uWindSpeed * uWindSpeed * 0.0018;
  const windToDot = normal.x * uWindDir.x + normal.z * uWindDir.y;
  const push = clamp(-windToDot, 0, 1);
  const flutterBias = clamp(windToDot, 0, 1);
  const k = Math.abs(wallOutSign);
  const wpx = mix(posX, drapeU, k); // vec2 wp = mix(position.xy, drapeUV, abs(wallOutSign));
  const wpy = mix(posY, drapeV, k);
  const wave = Math.sin(wpx * 2.2 + wpy * 1.3 + uTime * 2.6) * 0.6 + Math.sin(wpx * 5.1 - uTime * 4.3) * 0.4;
  const mag = amp * windFree;
  let dx = uWindDir.x * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
  let dz = uWindDir.y * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
  const dy = mag * 0.25 * Math.sin(uTime * 6.0 + wpx * 7.0 + wpy * 3.0);
  const pillarAllowOut = Math.max(PILLAR_GAP_M * PILLAR_GATE_SAFETY, 1e-5);
  const dzGated = dz > 0 ? pillarAllowOut * (1 - Math.exp(-dz / pillarAllowOut)) : dz;
  dz = mix(dz, dzGated, pillarGate);
  const alongCapped = dx >= 0 ? SAFE_ALONG_M * (1 - Math.exp(-dx / SAFE_ALONG_M)) : -SAFE_ALONG_M * (1 - Math.exp(dx / SAFE_ALONG_M));
  dx = mix(dx, alongCapped, pillarScreenMask);
  dx = mix(dx, 0, pillarGate);
  const outward = dz * wallOutSign; // float outward = disp.z * wallOutSign;
  const outwardCapped = outward >= 0 ? outward : -DRAPE_INWARD_CAP_M * (1 - Math.exp(outward / DRAPE_INWARD_CAP_M));
  dz = mix(dz, outwardCapped * wallOutSign, k);
  out.x = dx; out.y = dy; out.z = dz;
  return out;
}

// ---------------------------------------------------------------------------
// 屋根の垂れ4層(本番ジオメトリ)
// ---------------------------------------------------------------------------
const LAYER_DEFS = [
  { key: 'innerLinen', name: '亜麻布', cfg: ROOF.innerLinen },
  { key: 'goatHair', name: 'ヤギ毛', cfg: ROOF.goatHair },
  { key: 'ramSkins', name: '雄羊の皮', cfg: ROOF.ramSkins },
  { key: 'sealSkins', name: 'アザラシの皮', cfg: ROOF.sealSkins },
];
const { xBack, xEntrance, zHalf } = TABERNACLE;
const FRAME_T = FRAME.thickness;
const FRAME_TOP_Y = PEDESTAL_H + FRAME.height;

function makeMatrix(part) {
  const o = new THREE.Object3D();
  o.position.set(...part.position);
  if (part.rotationX) o.rotation.x = part.rotationX;
  if (part.rotationY) o.rotation.y = part.rotationY;
  o.updateMatrixWorld(true);
  return o.matrixWorld.clone();
}

// panel: { wall:'south'|'north'|'back', layer, geo, matrix, outSign, cols, rows, attrs... }
function buildLayers() {
  const layers = LAYER_DEFS.map((def, k) => {
    const parts = buildRoofLayerParts(def.cfg, k);
    const panels = [];
    for (const s of parts.sides) panels.push(makePanel(s.side === 1 ? 'south' : 'north', k, s));
    if (parts.back) panels.push(makePanel('back', k, parts.back));
    return { k, def, parts, panels, topMatrix: makeMatrix(parts.top), flapMatrix: parts.flap ? makeMatrix(parts.flap) : null };
  });
  return layers;
}

function makePanel(wall, k, part) {
  const geo = part.geo;
  const pos = geo.attributes.position;
  const gx = geo.parameters.widthSegments + 1, gy = geo.parameters.heightSegments + 1;
  const matrix = makeMatrix(part);
  const attr = (n) => geo.attributes[n];
  const n = pos.count;
  const px = new Float64Array(n), py = new Float64Array(n), wf = new Float64Array(n), pg = new Float64Array(n),
    pm = new Float64Array(n), ws = new Float64Array(n), du = new Float64Array(n), dv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = pos.getX(i); py[i] = pos.getY(i);
    wf[i] = attr('windFree').getX(i); pg[i] = attr('pillarGate').getX(i); pm[i] = attr('pillarScreenMask').getX(i);
    ws[i] = attr('wallOutSign').getX(i);
    du[i] = attr('drapeUV').getX(i); dv[i] = attr('drapeUV').getY(i);
  }
  const nrm = new THREE.Vector3(geo.attributes.normal.getX(0), geo.attributes.normal.getY(0), geo.attributes.normal.getZ(0));
  const normal = nrm.transformDirection(matrix);
  // 壁の外向きの符号(ワールド): 南+z=+1, 北-z=-1, 背面 -x=-1 → 外向き距離 O の定義
  const outDir = wall === 'south' ? new THREE.Vector3(0, 0, 1) : wall === 'north' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0);
  // ワールドでの外向き方向が、ローカルz軸のどちらかと wallOutSign が一致することの確認
  const localZ = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  const expectSign = Math.sign(localZ.dot(outDir));
  if (expectSign !== ws[0]) throw new Error(`wallOutSign mismatch: ${wall} layer${k} attr=${ws[0]} expected=${expectSign}`);
  // 風向きの検査は壁の外向き座標系の相対値(O)で行う: wall線(南北: |z|=zHalf, 背面: x=xBack)からの距離
  const wallLine = wall === 'back' ? xBack : zHalf;
  return { wall, k, geo, matrix, gx, gy, n, px, py, wf, pg, pm, ws, du, dv, normal, outDir, wallLine, vcount: n,
    // rest(ローカル)での各軸の座標列(G2補間用): 列ix・行iyごと
    restX: Array.from({ length: gx }, (_, ix) => px[ix]),
    restY: Array.from({ length: gy }, (_, iy) => py[iy * gx]) };
}

// ワールド座標→外向き距離O(壁の内側ライン基準)
function outwardOf(panel, wx, wz) {
  if (panel.wall === 'south') return wz - zHalf;
  if (panel.wall === 'north') return -wz - zHalf;
  return xBack - wx;
}

// ---------------------------------------------------------------------------
// 枠・横木・銀の台座の体積(AABB)。tabernacle.js buildFrameWalls/buildCrossbars の配置規則を
// dimensions.js の定数から再構成(ここで独自の寸法値は持たない)。
// ---------------------------------------------------------------------------
function box(cx, cy, cz, hx, hy, hz, name) {
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0: cz - hz, z1: cz + hz, name };
}
function buildObstacles() {
  const w = FRAME.width, t = FRAME.thickness, h = FRAME.height;
  const boxes = [];
  const socketBase = w * FRAME_SOCKET_W_RATIO;
  const sock = silverSocketSize(socketBase);
  // 南北壁
  for (const side of [1, -1]) {
    const z = side * (zHalf + t / 2);
    for (let i = 0; i < FRAME.counts.north; i++) {
      const x = xBack + (i + 0.5) * w;
      boxes.push(box(x, PEDESTAL_H + h / 2, z, (w * 0.97) / 2, h / 2, t / 2, `${side === 1 ? '南' : '北'}枠#${i}`));
      for (const dx of [-w * 0.28, w * 0.28]) boxes.push(box(x + dx, sock.h / 2, z, sock.w / 2, sock.h / 2, sock.d / 2, `${side === 1 ? '南' : '北'}台座#${i}`));
    }
  }
  // 西壁(rotation.y=90°: 板のx方向厚みt、z方向幅)
  const x = xBack - t / 2;
  const regularSpan = FRAME.counts.west * w;
  for (let i = 0; i < FRAME.counts.west; i++) {
    const z = -regularSpan / 2 + (i + 0.5) * w;
    boxes.push(box(x, PEDESTAL_H + h / 2, z, t / 2, h / 2, (w * 0.97) / 2, `西枠#${i}`));
    for (const dz of [-w * 0.28, w * 0.28]) boxes.push(box(x, sock.h / 2, z + dz, sock.w / 2, sock.h / 2, sock.d / 2, `西台座#${i}`));
  }
  const remaining = (zHalf * 2 - regularSpan) / 2;
  const cornerSock = silverSocketSize(remaining * 0.9);
  for (const s of [-1, 1]) {
    const z = s * (regularSpan / 2 + remaining / 2);
    boxes.push(box(x, PEDESTAL_H + h / 2, z, t / 2, h / 2, (remaining * 0.95) / 2, `西隅枠(${s})`));
    boxes.push(box(x, cornerSock.h / 2, z, cornerSock.w / 2, cornerSock.h / 2, cornerSock.d / 2, `西隅台座(${s})`));
  }
  // 横木(円柱は外接AABBで保守的に判定。y = h*(i+1)/(n+1) は buildCrossbars の規則どおり)
  const { perSide, diameter } = TABERNACLE.crossbars;
  const r = diameter / 2;
  const length = xEntrance - xBack;
  for (let i = 0; i < perSide; i++) {
    const y = h * (i + 1) / (perSide + 1);
    for (const side of [1, -1]) boxes.push(box((xBack + xEntrance) / 2, y, side * (zHalf + t / 2), (length * 0.99) / 2, r, r, `${side === 1 ? '南' : '北'}横木#${i}`));
    boxes.push(box(x, y, 0, r, r, (zHalf * 2 * 0.99) / 2, `西横木#${i}`));
  }
  const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const b of boxes) { bb.x0 = Math.min(bb.x0, b.x0); bb.x1 = Math.max(bb.x1, b.x1); bb.y0 = Math.min(bb.y0, b.y0); bb.y1 = Math.max(bb.y1, b.y1); bb.z0 = Math.min(bb.z0, b.z0); bb.z1 = Math.max(bb.z1, b.z1); }
  // 壁ごとの外向き最大到達距離(外面): 南=z1(南枠), 北, 西
  const outer = {
    south: Math.max(...boxes.filter((b) => b.name.startsWith('南')).map((b) => b.z1)) - zHalf,
    north: Math.max(...boxes.filter((b) => b.name.startsWith('北')).map((b) => -b.z0)) - zHalf,
    back: xBack - Math.min(...boxes.filter((b) => b.name.startsWith('西')).map((b) => b.x0)),
  };
  return { boxes, bb, outer };
}

// 点が体積に入っていれば(厳密に内部)その箱を返す
function insideBox(obs, x, y, z) {
  const bb = obs.bb;
  if (x < bb.x0 || x > bb.x1 || y < bb.y0 || y > bb.y1 || z < bb.z0 || z > bb.z1) return null;
  for (const b of obs.boxes) {
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 変位後のワールド座標(本番の transformed += disp → modelMatrix と同じ順序)
// ---------------------------------------------------------------------------
const _d = { x: 0, y: 0, z: 0 };
function displacedWorld(panel, i, uWindSpeed, uWindDir, uTime, outV) {
  shaderDisp15({
    uWindSpeed, uWindDir, uTime, posX: panel.px[i], posY: panel.py[i], windFree: panel.wf[i],
    pillarGate: panel.pg[i], pillarScreenMask: panel.pm[i], wallOutSign: panel.ws[i],
    drapeU: panel.du[i], drapeV: panel.dv[i], normal: panel.normal,
  }, _d);
  outV.set(panel.px[i] + _d.x, panel.py[i] + _d.y, _d.z).applyMatrix4(panel.matrix);
  return outV;
}

// ---------------------------------------------------------------------------
// G2: 三角形(PlaneGeometryと同じ分割)による、restのローカル(x,y)位置でのO補間
// ---------------------------------------------------------------------------
function findCell(arr, v, descending) {
  // arr は単調(列は昇順、行は降順)。v を挟む区間の下限添字を返す。範囲外は -1。
  const n = arr.length;
  const lo0 = descending ? arr[n - 1] : arr[0], hi0 = descending ? arr[0] : arr[n - 1];
  if (v < lo0 - 1e-9 || v > hi0 + 1e-9) return -1;
  let lo = 0, hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const ok = descending ? arr[mid] >= v : arr[mid] <= v;
    if (ok) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function interpO(panel, Oarr, lx, ly) {
  const ix = findCell(panel.restX, lx, false);
  const iy = findCell(panel.restY, ly, true);
  if (ix < 0 || iy < 0) return null;
  const x0 = panel.restX[ix], x1 = panel.restX[ix + 1];
  const y0 = panel.restY[iy], y1 = panel.restY[iy + 1];
  const u = (lx - x0) / (x1 - x0), v = (y0 - ly) / (y0 - y1);
  const gx = panel.gx;
  const a = Oarr[iy * gx + ix], b = Oarr[(iy + 1) * gx + ix], c = Oarr[(iy + 1) * gx + ix + 1], d = Oarr[iy * gx + ix + 1];
  if (u + v <= 1) return a + u * (d - a) + v * (b - a);
  return c + (1 - u) * (b - c) + (1 - v) * (d - c);
}

// ---------------------------------------------------------------------------
// 検証本体
// ---------------------------------------------------------------------------
const WIND_SPEEDS = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]; // UI最大値は20 m/s(ui.js・materials.js setWind)
const WIND_DIRS = []; for (let d = 0; d < 360; d += 15) WIND_DIRS.push(d);
const TIME_SAMPLES = 64, TIME_STEP = 0.9; // 0..56.7秒。波の周期2.42/1.46/1.05秒の位相の組が十分ばらつく刻み
const G2_TIME_STRIDE = 4;
const EDGE_SPEED = 20; // 面内サンプリング(辺の中点・セル中心)は最大風速で実施

function runG1G2(layers, obs) {
  const tmp = new THREE.Vector3();
  const pen = { count: 0, worst: null };
  let minClear = Infinity, minClearCase = null; // 外向き距離O - 壁の外面(体積の外向き最大到達)
  let evals = 0;
  const g2 = { comparisons: 0, inversions: 0, minMargin: Infinity, minMarginCase: null, pairs: {} };
  const surf = { pen: 0, samples: 0 };
  const maxOutward = {}; // 外向きへの最大変位(参考)
  const O = layers.map((L) => L.panels.map((p) => new Float64Array(p.n)));
  const wallKeys = ['south', 'north', 'back'];
  const minInward = {};

  for (const uWindSpeed of WIND_SPEEDS) {
    for (const dirDeg of WIND_DIRS) {
      const uWindDir = windDirVector(dirDeg);
      for (let ti = 0; ti < TIME_SAMPLES; ti++) {
        const uTime = ti * TIME_STEP;
        const doG2 = ti % G2_TIME_STRIDE === 0;
        // 変位後座標・Oを全頂点で計算
        for (const L of layers) {
          L.panels.forEach((p, pi) => {
            const Oa = O[L.k][pi];
            for (let i = 0; i < p.n; i++) {
              displacedWorld(p, i, uWindSpeed, uWindDir, uTime, tmp);
              evals++;
              const o = outwardOf(p, tmp.x, tmp.z);
              Oa[i] = o;
              const b = insideBox(obs, tmp.x, tmp.y, tmp.z);
              const clear = o - obs.outer[p.wall];
              if (clear < minClear) { minClear = clear; minClearCase = { layer: L.def.name, wall: p.wall, uWindSpeed, dirDeg, uTime, i, world: tmp.toArray() }; }
              if (b) {
                pen.count++;
                if (!pen.worst) pen.worst = { layer: L.def.name, wall: p.wall, uWindSpeed, dirDeg, uTime, i, box: b.name, world: tmp.toArray() };
              }
              // 参考: 静止位置からの外向き変位
              const o0 = o - (L.parts.d);
              const key = p.wall;
              if (o0 < (minInward[key] ?? Infinity)) minInward[key] = o0;
              if (o0 > (maxOutward[key] ?? -Infinity)) maxOutward[key] = o0;
            }
          });
        }
        // 面内(辺の中点・セル中心)サンプリング: 線形補間のため理論上は頂点の最小Oで足りるが実測で確認
        if (uWindSpeed === EDGE_SPEED && doG2) {
          const v3 = new THREE.Vector3();
          for (const L of layers) {
            L.panels.forEach((p) => {
              const W = [];
              for (let i = 0; i < p.n; i++) { displacedWorld(p, i, uWindSpeed, uWindDir, uTime, v3); W.push(v3.clone()); }
              for (let iy = 0; iy < p.gy - 1; iy++) for (let ix = 0; ix < p.gx - 1; ix++) {
                const a = W[iy * p.gx + ix], b = W[(iy + 1) * p.gx + ix], c = W[(iy + 1) * p.gx + ix + 1], d = W[iy * p.gx + ix + 1];
                const pts = [a.clone().add(b).multiplyScalar(0.5), b.clone().add(c).multiplyScalar(0.5), c.clone().add(d).multiplyScalar(0.5),
                  d.clone().add(a).multiplyScalar(0.5), a.clone().add(c).multiplyScalar(0.5), b.clone().add(d).multiplyScalar(0.5)];
                for (const q of pts) { surf.samples++; if (insideBox(obs, q.x, q.y, q.z)) surf.pen++; }
              }
            });
          }
        }
        // G2: 同じ壁・同じrest位置での層間の順序
        if (doG2) {
          for (const wall of wallKeys) {
            for (let a = 0; a < layers.length; a++) for (let b = a + 1; b < layers.length; b++) {
              const pa = layers[a].panels.find((p) => p.wall === wall), pb = layers[b].panels.find((p) => p.wall === wall);
              const Oa = O[a][layers[a].panels.indexOf(pa)], Ob = O[b][layers[b].panels.indexOf(pb)];
              const pairKey = `${LAYER_DEFS[a].name}<${LAYER_DEFS[b].name}`;
              const st = (g2.pairs[pairKey] ??= { comparisons: 0, inversions: 0, minMargin: Infinity });
              // a(内側)の各頂点 vs bの補間、bの各頂点 vs aの補間
              for (let i = 0; i < pa.n; i++) {
                const ob = interpO(pb, Ob, pa.px[i], pa.py[i]);
                if (ob === null) continue;
                const m = ob - Oa[i];
                st.comparisons++; g2.comparisons++;
                if (m < st.minMargin) st.minMargin = m;
                if (m < g2.minMargin) { g2.minMargin = m; g2.minMarginCase = { wall, pair: pairKey, from: 'inner', uWindSpeed, dirDeg, uTime, i }; }
                if (m <= 0) { st.inversions++; g2.inversions++; }
              }
              for (let i = 0; i < pb.n; i++) {
                const oa = interpO(pa, Oa, pb.px[i], pb.py[i]);
                if (oa === null) continue;
                const m = Ob[i] - oa;
                st.comparisons++; g2.comparisons++;
                if (m < st.minMargin) st.minMargin = m;
                if (m < g2.minMargin) { g2.minMargin = m; g2.minMarginCase = { wall, pair: pairKey, from: 'outer', uWindSpeed, dirDeg, uTime, i }; }
                if (m <= 0) { st.inversions++; g2.inversions++; }
              }
            }
          }
        }
      }
    }
  }
  return { evals, penetrations: pen, minClearanceToOuterFace: minClear, minClearanceCase: minClearCase, surfaceSamples: surf, g2, outwardDisplacementRange: { min: minInward, max: maxOutward } };
}

// ---------------------------------------------------------------------------
// G3(+T11 D1)
// ---------------------------------------------------------------------------
function topVerts(L) {
  const geo = L.parts.top.geo; const pos = geo.attributes.position;
  const v = new THREE.Vector3(); const out = [];
  for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(L.topMatrix); out.push(v.clone()); }
  return out;
}
function runG3(layers, obs) {
  const res = { perLayer: [], frameOuterFace: { south_z: zHalf + FRAME_T, north_z: -(zHalf + FRAME_T), back_x: xBack - FRAME_T },
    obstacleOuter: obs.outer, frameTopY: FRAME_TOP_Y };
  let allOk = true;
  for (const L of layers) {
    const tv = topVerts(L);
    const maxZ = Math.max(...tv.map((v) => v.z)), minZ = Math.min(...tv.map((v) => v.z)), minX = Math.min(...tv.map((v) => v.x)), maxX = Math.max(...tv.map((v) => v.x));
    const south = L.panels.find((p) => p.wall === 'south'), north = L.panels.find((p) => p.wall === 'north'), back = L.panels.find((p) => p.wall === 'back');
    const topRowWorld = (p) => { const v = new THREE.Vector3(); const out = []; for (let ix = 0; ix < p.gx; ix++) { v.set(p.px[ix], p.py[ix], 0).applyMatrix4(p.matrix); out.push(v.clone()); } return out; };
    const sRow = topRowWorld(south), nRow = topRowWorld(north), bRow = topRowWorld(back);
    // 上面の端 ⇔ 垂れ上端の継ぎ目: 上面の縁の頂点(z=±端、x=西端)と垂れ上端行を比較
    const edgeSouth = tv.filter((v) => Math.abs(v.z - maxZ) < 1e-9);
    const edgeNorth = tv.filter((v) => Math.abs(v.z - minZ) < 1e-9);
    const edgeWest = tv.filter((v) => Math.abs(v.x - minX) < 1e-9);
    const dist = (edge, row, along) => {
      // edgeの各頂点について、row(垂れ上端、ワールド)を along 軸で線形補間した点との距離(yとoutward座標)
      let maxdy = 0, maxdo = 0;
      for (const e of edge) {
        const sorted = row.slice().sort((a, b) => a[along] - b[along]);
        let j = 0; while (j < sorted.length - 2 && sorted[j + 1][along] < e[along]) j++;
        const a = sorted[j], b = sorted[j + 1]; const t = (e[along] - a[along]) / (b[along] - a[along]);
        const y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t, x = a.x + (b.x - a.x) * t;
        maxdy = Math.max(maxdy, Math.abs(e.y - y));
        maxdo = Math.max(maxdo, Math.abs(along === 'x' ? e.z - z : e.x - x));
      }
      return { maxDy: maxdy, maxDOutward: maxdo };
    };
    const seamS = dist(edgeSouth, sRow, 'x'), seamN = dist(edgeNorth, nRow, 'x');
    // 西端は背面の垂れ上端(ワールドz昇順で補間)
    const seamW = dist(edgeWest, bRow, 'z');
    // 枠の上端が覆われる: 上面(サグ込み)が枠の外面の範囲 [zHalf, zHalf+t] で枠上端より上
    // 南北壁・西壁の枠上端領域の上で、上面の高さ(三角形補間)の最小値 - 枠上端
    const topGeo = L.parts.top.geo;
    const nx = topGeo.parameters.widthSegments, ny = topGeo.parameters.heightSegments;
    const yAt = (wx, wz) => {
      const p = new THREE.Vector3(wx, 0, wz).applyMatrix4(L.topMatrix.clone().invert()); // ローカル(x, y=-wz, z=高さ)
      const L_ = topGeo.parameters.width, W_ = topGeo.parameters.height;
      const u = (p.x + L_ / 2) / L_ * nx, v = (W_ / 2 - p.y) / W_ * ny;
      const ix = Math.min(nx - 1, Math.max(0, Math.floor(u))), iy = Math.min(ny - 1, Math.max(0, Math.floor(v)));
      const fu = u - ix, fv = v - iy; const pos = topGeo.attributes.position; const gx = nx + 1;
      const zz = (a, b) => pos.getZ(b * gx + a);
      const za = zz(ix, iy), zb = zz(ix, iy + 1), zc = zz(ix + 1, iy + 1), zd = zz(ix + 1, iy);
      const lz = fu + fv <= 1 ? za + fu * (zd - za) + fv * (zb - za) : zc + (1 - fu) * (zb - zc) + (1 - fv) * (zd - zc);
      return lz + L.topMatrix.elements[13]; // 回転後のワールドy = ローカルz + 位置y
    };
    let minAbove = Infinity, minAboveAt = null;
    for (const sgn of [1, -1]) for (let xi = 0; xi <= 200; xi++) for (let zi = 0; zi <= 10; zi++) {
      const wx = xBack + (xEntrance - xBack) * xi / 200;
      const wz = sgn * (zHalf + FRAME_T * zi / 10);
      const m = yAt(wx, wz) - FRAME_TOP_Y;
      if (m < minAbove) { minAbove = m; minAboveAt = { x: wx, z: wz }; }
    }
    for (let xi = 0; xi <= 10; xi++) for (let zi = 0; zi <= 200; zi++) {
      const wx = xBack - FRAME_T * xi / 10; const wz = -zHalf + 2 * zHalf * zi / 200;
      const m = yAt(wx, wz) - FRAME_TOP_Y;
      if (m < minAbove) { minAbove = m; minAboveAt = { x: wx, z: wz }; }
    }
    const coversFaces = maxZ >= zHalf + FRAME_T && minZ <= -(zHalf + FRAME_T) && minX <= xBack - FRAME_T;
    const ok = coversFaces && minAbove > 0 && seamS.maxDy < 1e-6 && seamS.maxDOutward < 1e-6 && seamN.maxDy < 1e-6 && seamN.maxDOutward < 1e-6 && seamW.maxDy < 1e-6 && seamW.maxDOutward < 1e-6;
    allOk = allOk && ok;
    res.perLayer.push({
      layer: L.def.name, topEdge: { maxZ, minZ, minX, maxX },
      drapeTopRow: { south_z: sRow[0].z, north_z: nRow[0].z, back_x: bRow[0].x, y: sRow[0].y, southRowYRange: [Math.min(...sRow.map((v) => v.y)), Math.max(...sRow.map((v) => v.y))] },
      drapeOffsetFromWall: L.parts.d,
      seam: { south: seamS, north: seamN, back: seamW },
      coversFrameOuterFace: coversFaces, minTopAboveFrameTop: minAbove, minTopAboveFrameTopAt: minAboveAt, ok,
    });
  }
  // T11 D1: 内側の層の上面は、同じ(x,z)で外側の層の上面より下(上に出ない)
  const d1 = { comparisons: 0, violations: 0, minMargin: Infinity };
  const sampleTop = (L, wx, wz) => {
    const topGeo = L.parts.top.geo; const nx = topGeo.parameters.widthSegments, ny = topGeo.parameters.heightSegments;
    const p = new THREE.Vector3(wx, 0, wz).applyMatrix4(L.topMatrix.clone().invert());
    const L_ = topGeo.parameters.width, W_ = topGeo.parameters.height;
    const u = (p.x + L_ / 2) / L_ * nx, v = (W_ / 2 - p.y) / W_ * ny;
    if (u < 0 || u > nx || v < 0 || v > ny) return null;
    const ix = Math.min(nx - 1, Math.floor(u)), iy = Math.min(ny - 1, Math.floor(v)); const fu = u - ix, fv = v - iy;
    const pos = topGeo.attributes.position; const gx = nx + 1; const zz = (a, b) => pos.getZ(b * gx + a);
    const za = zz(ix, iy), zb = zz(ix, iy + 1), zc = zz(ix + 1, iy + 1), zd = zz(ix + 1, iy);
    const lz = fu + fv <= 1 ? za + fu * (zd - za) + fv * (zb - za) : zc + (1 - fu) * (zb - zc) + (1 - fv) * (zd - zc);
    return lz + L.topMatrix.elements[13];
  };
  for (let a = 0; a < layers.length; a++) for (let b = a + 1; b < layers.length; b++) {
    for (let xi = 0; xi <= 120; xi++) for (let zi = 0; zi <= 60; zi++) {
      const wx = layers[a].parts.xWest + (layers[a].parts.xEast - layers[a].parts.xWest) * xi / 120;
      const wz = -layers[a].parts.halfW + 2 * layers[a].parts.halfW * zi / 60;
      const ya = sampleTop(layers[a], wx, wz), yb = sampleTop(layers[b], wx, wz);
      if (ya === null || yb === null) continue;
      d1.comparisons++;
      const m = yb - ya; if (m < d1.minMargin) d1.minMargin = m;
      if (m <= 0) d1.violations++;
    }
  }
  res.d1TopOrdering = d1;
  res.allOk = allOk && d1.violations === 0;
  return res;
}

// ---------------------------------------------------------------------------
// 回帰: wallOutSign=0 / drapeUV=0 の布(中庭の掛け布・入口の幕・屋根の垂れ以外)は
// T14時点の式(verify_t14.mjs shaderDisp)と完全一致
// ---------------------------------------------------------------------------
function runUnchanged() {
  let maxDiff = 0, samples = 0;
  const out = { x: 0, y: 0, z: 0 };
  const normal = { x: 1, y: 0, z: 0 };
  for (const uWindSpeed of [0, 10, 20]) for (let dirDeg = 0; dirDeg < 360; dirDeg += 30) {
    const uWindDir = windDirVector(dirDeg);
    for (let ti = 0; ti < 16; ti++) {
      const uTime = ti * 0.9;
      for (let posX = -3; posX <= 3; posX += 0.7) for (let posY = -1; posY <= 1; posY += 0.5)
        for (const windFree of [0, 0.14, 0.28, 0.32, 1.0]) for (const [pillarGate, pillarScreenMask] of [[0, 0], [1, 1], [0.4, 1]]) {
          samples++;
          const a = shaderDispT14({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, normal });
          shaderDisp15({ uWindSpeed, uWindDir, uTime, posX, posY, windFree, pillarGate, pillarScreenMask, wallOutSign: 0, drapeU: 0, drapeV: 0, normal }, out);
          maxDiff = Math.max(maxDiff, Math.abs(a.x - out.x), Math.abs(a.y - out.y), Math.abs(a.z - out.z));
        }
    }
  }
  return { samples, maxDiff };
}

// ---------------------------------------------------------------------------
const t0 = Date.now();
const layers = buildLayers();
const obs = buildObstacles();
const meta = {
  windSpeeds: WIND_SPEEDS, windDirsDeg: WIND_DIRS, timeSamples: TIME_SAMPLES, timeStepSec: TIME_STEP,
  timeRangeSec: [0, (TIME_SAMPLES - 1) * TIME_STEP], wavePeriodsSec: [2 * Math.PI / 2.6, 2 * Math.PI / 4.3, 2 * Math.PI / 6.0],
  g2TimeStride: G2_TIME_STRIDE, surfaceSamplingSpeed: EDGE_SPEED,
  obstacleBoxes: obs.boxes.length, obstacleOuterExtentFromWallLine: obs.outer,
  drapeOffsets: layers.map((L) => ({ layer: L.def.name, d: L.parts.d })),
  inwardCapM: DRAPE_INWARD_CAP_M, frameOuterExtentFromDims: drapeOffsetM(0) - 0.03,
  roofBaseY: ROOF_BASE_Y,
};
console.log('layers/panels:', layers.map((L) => `${L.def.name}:${L.panels.map((p) => `${p.wall}(${p.n})`).join(',')}`).join(' | '));
console.log('obstacles:', meta.obstacleBoxes, 'outer extents:', JSON.stringify(obs.outer));
const g3 = runG3(layers, obs);
const unchanged = runUnchanged();
const g12 = runG1G2(layers, obs);
const summary = { timestamp: new Date().toISOString(), elapsedSec: (Date.now() - t0) / 1000, sampling: meta, G1: {
  penetrationCount: g12.penetrations.count, firstPenetration: g12.penetrations.worst, vertexEvaluations: g12.evals,
  minClearanceToOuterFace_m: g12.minClearanceToOuterFace, minClearanceCase: g12.minClearanceCase,
  inPlaneSamples: g12.surfaceSamples, outwardDisplacementFromRest_m: g12.outwardDisplacementRange,
}, G2: g12.g2, G3: g3, shaderUnchangedForOtherCloths: unchanged };
fs.writeFileSync(path.join(LOG_DIR, 'verify_t15.json'), JSON.stringify(summary, null, 2));

console.log('\n=== G1 ===');
console.log(`貫通 ${summary.G1.penetrationCount} 件 / 頂点評価 ${summary.G1.vertexEvaluations}、面内サンプル貫通 ${g12.surfaceSamples.pen}/${g12.surfaceSamples.samples}`);
console.log(`外面までの最小クリアランス ${summary.G1.minClearanceToOuterFace_m.toFixed(5)} m`, JSON.stringify(g12.minClearanceCase));
console.log('静止位置からの外向き変位 範囲', JSON.stringify(g12.outwardDisplacementRange));
console.log('\n=== G2 ===');
console.log(`比較 ${g12.g2.comparisons} 件、逆転 ${g12.g2.inversions} 件、最小マージン ${g12.g2.minMargin.toFixed(5)} m`, JSON.stringify(g12.g2.minMarginCase));
for (const [k, v] of Object.entries(g12.g2.pairs)) console.log(`  ${k}: 比較 ${v.comparisons}, 逆転 ${v.inversions}, 最小マージン ${v.minMargin.toFixed(5)}`);
console.log('\n=== G3 ===');
console.log('枠の外面:', JSON.stringify(g3.frameOuterFace), '台座を含む外面(壁線から):', JSON.stringify(g3.obstacleOuter), '枠上端y:', g3.frameTopY);
for (const r of g3.perLayer) {
  console.log(`  ${r.layer}: 上面端 z=[${r.topEdge.minZ.toFixed(4)},${r.topEdge.maxZ.toFixed(4)}] x西端=${r.topEdge.minX.toFixed(4)} | 垂れ上端 z=${r.drapeTopRow.south_z.toFixed(4)}/${r.drapeTopRow.north_z.toFixed(4)} x(背面)=${r.drapeTopRow.back_x.toFixed(4)} y=${r.drapeTopRow.y.toFixed(4)}`
    + ` | 継ぎ目 最大Δy=${Math.max(r.seam.south.maxDy, r.seam.north.maxDy, r.seam.back.maxDy).toExponential(2)} 最大Δ外向き=${Math.max(r.seam.south.maxDOutward, r.seam.north.maxDOutward, r.seam.back.maxDOutward).toExponential(2)}`
    + ` | 枠外面を覆う=${r.coversFrameOuterFace} 上面-枠上端 最小=${r.minTopAboveFrameTop.toFixed(4)} ok=${r.ok}`);
}
console.log(`  D1(上面の層順): 比較 ${g3.d1TopOrdering.comparisons}, 違反 ${g3.d1TopOrdering.violations}, 最小マージン ${g3.d1TopOrdering.minMargin.toFixed(5)} m`);
console.log(`\n[他の布の揺れ不変] samples=${unchanged.samples}, maxDiff=${unchanged.maxDiff} (0であるべき)`);
console.log(`\n経過 ${summary.elapsedSec}s。詳細は log/verify_t15.json`);
const pass = summary.G1.penetrationCount === 0 && g12.surfaceSamples.pen === 0 && g12.g2.inversions === 0 && g3.allOk && unchanged.maxDiff === 0;
console.log(pass ? 'RESULT: all numeric checks 0 violations' : 'RESULT: violations exist');
process.exit(pass ? 0 : 1);

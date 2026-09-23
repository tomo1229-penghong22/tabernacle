// materials.js
// マテリアルはすべてここに集約する。テクスチャは Canvas によるプロシージャル生成のみ
// （外部画像アセットなし）。フェーズ2の劣化パラメータを差し込めるよう、
// 各マテリアルは `key` と `params`（現時点は未使用のプレースホルダ）を userData に保持し、
// applyWeathering(material, params) の差し替えポイントを用意しておく。

import * as THREE from 'three';
import { MATERIALS } from './dimensions.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function noise(ctx, w, h, base, variance, alpha = 1) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * variance;
    img.data[i] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i + 3] = 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function makeTexture(canvas, repeat = [1, 1]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- 砂/礫の地面 --------------------------------------------------------
function buildSandTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, [196, 168, 122], 30);
  // 礫（小石）を散らす
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 2 + 0.5;
    const shade = 90 + Math.random() * 60;
    ctx.fillStyle = `rgba(${shade},${shade * 0.9},${shade * 0.75},0.6)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return makeTexture(c, [40, 40]);
}

// --- アカシア材（木目） ---------------------------------------------------
function buildWoodTexture() {
  const w = 128, h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = `rgba(60,35,15,${0.15 + Math.random() * 0.2})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
    }
    ctx.stroke();
  }
  return makeTexture(c, [1, 2]);
}

// --- 金/銀/銅の金属テクスチャ（微細なムラ） -------------------------------
function buildMetalTexture(baseColor) {
  const size = 64;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, baseColor, 18);
  return makeTexture(c, [4, 4]);
}

// --- 亜麻布（白地、必要に応じ縦縞で青紫緋を表現） --------------------------
function buildLinenTexture(withStripes = false, withCherub = false) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, size, size);
  // 織り目
  ctx.strokeStyle = 'rgba(150,140,110,0.15)';
  for (let i = 0; i < size; i += 3) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  if (withStripes) {
    const colors = ['#2b3a8f', '#5b2a86', '#8f1d2c']; // 青・紫・緋
    colors.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.fillRect((idx + 1) * (size / 4) - 8, 0, 16, size);
    });
    ctx.globalAlpha = 1;
  }
  if (withCherub) {
    // ケルブ刺しゅう柄の簡易表現（抽象的な翼モチーフの繰り返し）
    ctx.fillStyle = 'rgba(180,140,40,0.6)';
    for (let i = 0; i < 4; i++) {
      const cx = size / 2, cy = (i + 0.5) * (size / 4);
      ctx.beginPath();
      ctx.ellipse(cx - 24, cy, 20, 8, Math.PI / 6, 0, Math.PI * 2);
      ctx.ellipse(cx + 24, cy, 20, 8, -Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return makeTexture(c, [2, 1]);
}

// --- ヤギ毛（黒褐色の粗い織り） ------------------------------------------
function buildGoatHairTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, [55, 42, 30], 22);
  ctx.strokeStyle = 'rgba(20,15,10,0.3)';
  for (let i = 0; i < size; i += 4) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i + (Math.random() * 2 - 1)); ctx.stroke();
  }
  return makeTexture(c, [3, 2]);
}

// --- 雄羊の皮（赤染め革） -------------------------------------------------
function buildRamSkinTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, [138, 42, 30], 20);
  return makeTexture(c, [3, 2]);
}

// --- アザラシ(ジュゴン)の皮（灰青の革） ------------------------------------
function buildSealSkinTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, [92, 100, 105], 18);
  return makeTexture(c, [3, 2]);
}

// --- 遠景の山肌 -----------------------------------------------------------
function buildMountainTexture() {
  const size = 128;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  noise(ctx, size, size, [150, 120, 95], 25);
  return makeTexture(c, [1, 1]);
}

const cache = new Map();

function getOrBuild(key, builder) {
  if (cache.has(key)) return cache.get(key);
  const mat = builder();
  mat.userData.materialKey = key;
  mat.userData.weathering = { age: 0 }; // フェーズ2で使用するプレースホルダ
  cache.set(key, mat);
  return mat;
}

// applyWeathering: フェーズ2で劣化パラメータをマテリアルへ反映するための差し替えポイント。
// フェーズ1では no-op。
export function applyWeathering(material, params) {
  material.userData.weathering = { ...material.userData.weathering, ...params };
  // TODO(phase2): 退色・緑青・黒ずみ・摩耗・泥はねをシェーダー/テクスチャに反映する。
}

export function getMaterial(key) {
  switch (key) {
    case MATERIALS.SAND:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildSandTexture(), roughness: 1, metalness: 0,
      }));
    case MATERIALS.WOOD:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildWoodTexture(), roughness: 0.85, metalness: 0,
      }));
    case MATERIALS.GOLD:
      // R3対応: metalness:1だと環境マップの色がそのまま支配的になり、環境マップが
      // 弱い/中立色の場合に金が黒〜暗褐色に見えてしまう。metalnessを少し下げて
      // ベースカラー(黄金色)自体の寄与を残しつつ、envMapIntensityで反射を強めに保つ。
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildMetalTexture([212, 175, 55]), color: 0xd4af37,
        roughness: 0.32, metalness: 0.82, envMapIntensity: 1.6,
      }));
    case MATERIALS.SILVER:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildMetalTexture([200, 200, 205]), color: 0xc7c9cf,
        roughness: 0.35, metalness: 0.85, envMapIntensity: 1.6,
      }));
    case MATERIALS.BRONZE:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildMetalTexture([150, 95, 45]), color: 0xb5793a,
        roughness: 0.5, metalness: 0.8, envMapIntensity: 1.4,
      }));
    case MATERIALS.LINEN:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildLinenTexture(false, false), roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      }));
    case MATERIALS.LINEN_CHERUB:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildLinenTexture(true, true), roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      }));
    case 'linenEntrance':
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildLinenTexture(true, false), roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      }));
    case MATERIALS.GOAT_HAIR:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildGoatHairTexture(), roughness: 1, metalness: 0, side: THREE.DoubleSide,
      }));
    case MATERIALS.RAM_SKIN:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildRamSkinTexture(), roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
      }));
    case MATERIALS.SEAL_SKIN:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildSealSkinTexture(), roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
      }));
    case MATERIALS.MOUNTAIN:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: buildMountainTexture(), roughness: 1, metalness: 0, fog: true,
      }));
    case MATERIALS.SHRUB:
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        color: 0x5b5a3a, roughness: 1, metalness: 0,
      }));
    default:
      return getOrBuild('default', () => new THREE.MeshStandardMaterial({ color: 0x999999 }));
  }
}

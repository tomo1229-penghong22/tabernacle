// materials.js
// マテリアルはすべてここに集約する。テクスチャは Canvas によるプロシージャル生成のみ
// （外部画像アセットなし）。
//
// フェーズ2 (T6/T7/T8): 経年劣化(F3)・天候劣化(F4)・風による布の揺れ(F5の材質側)・
// 雨による濡れ(F6の材質側)を、共有uniform(ENV_UNIFORMS)を介した onBeforeCompile
// シェーダー注入で実装する。すべてのマテリアルが同じuniformオブジェクトを参照するため、
// setWeathering()/setWind()/setRainAmount() を呼ぶだけで全マテリアルに反映される。

import * as THREE from 'three';
import { MATERIALS, TABERNACLE, FRAME } from './dimensions.js';

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

// =============================================================================
// 環境エフェクト（T6経年/天候劣化・T7風・T8雨）共有uniform
// =============================================================================
// すべてのマテリアルがこの「同じオブジェクト」をuniformとして参照するため、
// 値を書き換えるだけで全マテリアルに反映される（マテリアルごとの再コンパイル不要）。
export const ENV_UNIFORMS = {
  uAge: { value: 0 }, // 0-1 (0-40年を正規化)
  uSun: { value: 0.7 }, // 日射強度 0-1
  uRainFreq: { value: 0.3 }, // 降雨頻度(天候劣化の強さ) 0-1
  uWindSpeed: { value: 0 }, // m/s
  uWindDir: { value: new THREE.Vector2(0, 1) }, // 風が吹いていく方向(正規化, x,z)
  uTime: { value: 0 },
  uWetness: { value: 0 }, // 即時降雨による濡れ 0-1（数十秒で乾く）
  uTabBounds: { value: new THREE.Vector4(TABERNACLE.xBack, TABERNACLE.xEntrance, -TABERNACLE.zHalf, TABERNACLE.zHalf) },
  uTabRoofY: { value: FRAME.height + 0.6 },
};

// 経年・日射・降雨頻度（T6 F3/F4）。ageYearsは0-40。
export function setWeathering(ageYears, sunIntensity, rainFreq) {
  ENV_UNIFORMS.uAge.value = THREE.MathUtils.clamp(ageYears / 40, 0, 1);
  if (sunIntensity != null) ENV_UNIFORMS.uSun.value = THREE.MathUtils.clamp(sunIntensity, 0, 1);
  if (rainFreq != null) ENV_UNIFORMS.uRainFreq.value = THREE.MathUtils.clamp(rainFreq, 0, 1);
}

// 風速(m/s)・風向(度、気象学的に「吹いてくる」方位角。0=北, 90=東, 180=南, 270=西)。T7。
export function setWind(speedMs, dirFromDeg) {
  ENV_UNIFORMS.uWindSpeed.value = THREE.MathUtils.clamp(speedMs, 0, 20);
  if (dirFromDeg != null) {
    const rad = THREE.MathUtils.degToRad(dirFromDeg);
    // +x=東, +z=南, 北=-z (dimensions.js A7)。fromVector = (sinθ, -cosθ)。風が吹いていく方向はその逆。
    const fromX = Math.sin(rad), fromZ = -Math.cos(rad);
    ENV_UNIFORMS.uWindDir.value.set(-fromX, -fromZ);
    ENV_UNIFORMS.windDirFromDeg = dirFromDeg;
  }
}

export function getWindToVector() {
  return { x: ENV_UNIFORMS.uWindDir.value.x, z: ENV_UNIFORMS.uWindDir.value.y };
}

// 降雨量(0-1、即時)の目標値。実際の濡れ具合(uWetness)はupdateEnvAnimation()で
// フレームごとに滑らかに追従させ、降雨停止後は数十秒かけて乾かす。
const rainState = { target: 0, wetness: 0 };
export function setRainAmount(amount) {
  rainState.target = THREE.MathUtils.clamp(amount, 0, 1);
}
export function getRainAmount() { return rainState.target; }
export function getWetness() { return rainState.wetness; }

// 毎フレーム呼び出す: 風の時間経過・雨の濡れ具合(上昇は速く、乾燥は数十秒かけてゆっくり)を更新。
export function updateEnvAnimation(dt) {
  ENV_UNIFORMS.uTime.value += dt;
  const tau = rainState.target > rainState.wetness ? 2.0 : 14.0; // 濡れは速く、乾燥は約数十秒
  rainState.wetness += (rainState.target - rainState.wetness) * Math.min(1, dt / tau);
  if (Math.abs(rainState.wetness - rainState.target) < 0.001) rainState.wetness = rainState.target;
  ENV_UNIFORMS.uWetness.value = rainState.wetness;
}

// --- 経年/天候/風/雨の材質ごとの見え方設定 --------------------------------
// fade: 日射(退色・褪色・緑青・黒ずみ)の到達色 / fadeAmt: その強さ
// wear: 摩耗(金張りの下から木地が覗く等)の到達色 / wearAmt: その強さ
// dirt: 雨・砂による汚れ(泥はね)の強さ / soot: 祭壇の煤(特別に暗くする)
// wind: true なら頂点シェーダーで風揺れを適用(布地のみ)
// puddle: true なら低地に水たまり表現を追加(地面のみ)
const WEATHER_CONFIGS = {
  [MATERIALS.LINEN_CHERUB]: { fade: 0xcac2a8, fadeAmt: 0.55, dirt: 0.6, wind: true },
  linenEntrance: { fade: 0xcac2a8, fadeAmt: 0.55, dirt: 0.6, wind: true },
  [MATERIALS.LINEN]: { fade: 0xcdae6e, fadeAmt: 0.4, dirt: 0.6, wind: true },
  [MATERIALS.GOAT_HAIR]: { fade: 0x8a7358, fadeAmt: 0.35, dirt: 0.5, wind: true },
  [MATERIALS.RAM_SKIN]: { fade: 0x9c6a55, fadeAmt: 0.3, dirt: 0.5, wind: true },
  [MATERIALS.SEAL_SKIN]: { fade: 0x7d858c, fadeAmt: 0.25, dirt: 0.45, wind: true },
  [MATERIALS.GOLD]: { wear: 0x6b4423, wearAmt: 0.45, dirt: 0.2 },
  [MATERIALS.SILVER]: { fade: 0x2b2b2e, fadeAmt: 0.6, dirt: 0.3 },
  [MATERIALS.BRONZE]: { fade: 0x2f6f5e, fadeAmt: 0.6, dirt: 0.3 },
  bronzeAltar: { fade: 0x2f6f5e, fadeAmt: 0.6, dirt: 0.3, soot: 1.0 },
  [MATERIALS.WOOD]: { fade: 0x2a1c10, fadeAmt: 0.3, dirt: 0.4 },
  [MATERIALS.SAND]: { dirt: 0, puddle: true },
};

// injectEnv: onBeforeCompile でマテリアルに経年/天候/風/雨のシェーダーコードを追加する。
function injectEnv(material, cfg) {
  const isCloth = !!cfg.wind;
  const isPuddle = !!cfg.puddle;
  material.userData.envConfig = cfg;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ENV_UNIFORMS, {
      uFade: { value: new THREE.Color(cfg.fade ?? 0x000000) },
      uFadeAmt: { value: cfg.fadeAmt ?? 0 },
      uWear: { value: new THREE.Color(cfg.wear ?? 0x000000) },
      uWearAmt: { value: cfg.wearAmt ?? 0 },
      uDirtAmt: { value: cfg.dirt ?? 0 },
      uSoot: { value: cfg.soot ?? 0 },
    });

    // --- 頂点シェーダー ---
    let vertCommon = '#include <common>\nvarying vec3 vEnvWorldPos;\nvarying vec3 vEnvWorldNormal;';
    if (isCloth) vertCommon += '\nattribute float windFree;\nuniform float uWindSpeed, uTime;\nuniform vec2 uWindDir;';
    shader.vertexShader = shader.vertexShader.replace('#include <common>', vertCommon);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nvEnvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
    );

    let beginVertexInject = '#include <begin_vertex>\nvEnvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;';
    if (isCloth) {
      beginVertexInject += `
      {
        float amp = uWindSpeed * uWindSpeed * 0.0018;
        float windToDot = vEnvWorldNormal.x * uWindDir.x + vEnvWorldNormal.z * uWindDir.y;
        float push = clamp(-windToDot, 0.0, 1.0);
        float flutterBias = clamp(windToDot, 0.0, 1.0);
        float wave = sin(position.x * 2.2 + position.y * 1.3 + uTime * 2.6) * 0.6
                   + sin(position.x * 5.1 - uTime * 4.3) * 0.4;
        float mag = amp * windFree;
        vec3 disp = vec3(uWindDir.x, 0.0, uWindDir.y) * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
        disp.y += mag * 0.25 * sin(uTime * 6.0 + position.x * 7.0 + position.y * 3.0);
        transformed += disp;
      }`;
    }
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', beginVertexInject);

    // --- フラグメントシェーダー ---
    const fragCommon = `#include <common>
    varying vec3 vEnvWorldPos;
    varying vec3 vEnvWorldNormal;
    uniform float uAge, uSun, uRainFreq, uWetness, uFadeAmt, uWearAmt, uDirtAmt, uSoot;
    uniform vec3 uFade, uWear;
    uniform vec4 uTabBounds;
    uniform float uTabRoofY;
    float envHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', fragCommon);

    const puddleCode = isPuddle ? `
      float puddleFactor = clamp((-vEnvWorldPos.y - 0.05) / 0.3, 0.0, 1.0);
      col = mix(col, vec3(0.05, 0.08, 0.12), clamp(puddleFactor * wet * 1.5, 0.0, 1.0));
    ` : '';

    const envColorBlock = `
    {
      vec3 N = normalize(vEnvWorldNormal);
      float southFactor = clamp(N.z, 0.0, 1.0); // +z=南(PLAN A7): 南面が最も日射を受ける
      float topFactor = clamp(N.y, 0.0, 1.0); // 屋根上面
      float westFactor = clamp(-N.x, 0.0, 1.0); // -x=西: 冬の偏西風・雨が最も強く当たる面
      float heightFactor = clamp(1.0 - vEnvWorldPos.y / 1.2, 0.0, 1.0); // 下部ほど泥はね・砂の堆積が強い
      float n = envHash(floor(vEnvWorldPos.xz * 3.0));
      float sunExposure = uAge * uSun * clamp(0.3 + 0.45 * southFactor + 0.35 * topFactor, 0.0, 1.0);
      float rainExposure = uAge * uRainFreq * clamp(0.25 + 0.45 * westFactor + 0.55 * heightFactor, 0.0, 1.0);
      vec3 col = gl_FragColor.rgb;
      col = mix(col, uFade, clamp(sunExposure * uFadeAmt, 0.0, 1.0));
      col = mix(col, uWear, clamp((sunExposure * 0.6 + rainExposure * 0.4) * uWearAmt * (0.4 + 0.6 * n), 0.0, 1.0));
      col = mix(col, vec3(0.29, 0.24, 0.16), clamp(rainExposure * uDirtAmt * (0.5 + 0.5 * n), 0.0, 1.0));
      col = mix(col, vec3(0.04), clamp(uSoot * uAge * 0.5, 0.0, 1.0));
      bool insideTab = vEnvWorldPos.x > uTabBounds.x && vEnvWorldPos.x < uTabBounds.y
                     && vEnvWorldPos.z > uTabBounds.z && vEnvWorldPos.z < uTabBounds.w
                     && vEnvWorldPos.y < uTabRoofY;
      float wet = insideTab ? 0.0 : uWetness; // 幕屋内部(屋根の下)には雨を反映しない
      col = mix(col, col * 0.55, clamp(wet * 0.8, 0.0, 1.0));
      ${puddleCode}
      gl_FragColor.rgb = col;
    }
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', envColorBlock + '#include <dithering_fragment>');

    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `env_${cfg.wind ? 1 : 0}_${cfg.puddle ? 1 : 0}`;
}

const cache = new Map();

function getOrBuild(key, builder) {
  if (cache.has(key)) return cache.get(key);
  const mat = builder();
  mat.userData.materialKey = key;
  const cfg = WEATHER_CONFIGS[key];
  if (cfg) injectEnv(mat, cfg);
  cache.set(key, mat);
  return mat;
}

// applyWeathering: 後方互換のためのエイリアス（実体は setWeathering）。
export function applyWeathering(ageYears, sunIntensity, rainFreq) {
  setWeathering(ageYears, sunIntensity, rainFreq);
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
    case 'bronzeAltar':
      // 燔祭の祭壇専用: 銅の緑青に加え、祭壇特有の煤(すす)による黒ずみを別途強める。
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

// --- 検証用: シェーダーと同じ計算式をJSで再現(ヘッドレス環境でのピクセル読み取りに
// 頼らず、経年・方位による色変化を数値で検証できるようにするため) -----------------
export function computeWeatheredColor(materialKey, { normal, worldY = 1, ageYears = 0, sun = 0.7, rainFreq = 0.3 }) {
  const cfg = WEATHER_CONFIGS[materialKey] || {};
  const base = getMaterial(materialKey);
  const baseColor = new THREE.Color(base.color || 0xffffff);
  const age = THREE.MathUtils.clamp(ageYears / 40, 0, 1);
  const N = normal;
  const southFactor = THREE.MathUtils.clamp(N.z, 0, 1);
  const topFactor = THREE.MathUtils.clamp(N.y, 0, 1);
  const westFactor = THREE.MathUtils.clamp(-N.x, 0, 1);
  const heightFactor = THREE.MathUtils.clamp(1 - worldY / 1.2, 0, 1);
  const sunExposure = age * sun * THREE.MathUtils.clamp(0.3 + 0.45 * southFactor + 0.35 * topFactor, 0, 1);
  const rainExposure = age * rainFreq * THREE.MathUtils.clamp(0.25 + 0.45 * westFactor + 0.55 * heightFactor, 0, 1);
  let col = baseColor.clone();
  if (cfg.fade != null) col.lerp(new THREE.Color(cfg.fade), THREE.MathUtils.clamp(sunExposure * (cfg.fadeAmt ?? 0), 0, 1));
  if (cfg.wear != null) col.lerp(new THREE.Color(cfg.wear), THREE.MathUtils.clamp((sunExposure * 0.6 + rainExposure * 0.4) * (cfg.wearAmt ?? 0) * 0.7, 0, 1));
  col.lerp(new THREE.Color(0x4a3d29), THREE.MathUtils.clamp(rainExposure * (cfg.dirt ?? 0) * 0.75, 0, 1));
  if (cfg.soot) col.lerp(new THREE.Color(0x0a0a0a), THREE.MathUtils.clamp(cfg.soot * age * 0.5, 0, 1));
  const hsv = { h: 0, s: 0, v: 0 };
  rgbToHsv(col, hsv);
  return { r: col.r, g: col.g, b: col.b, h: hsv.h, s: hsv.s, v: hsv.v, sunExposure, rainExposure };
}

function rgbToHsv(color, out) {
  const r = color.r, g = color.g, b = color.b;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  out.v = max;
  out.s = max === 0 ? 0 : d / max;
  if (d === 0) { out.h = 0; return; }
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  out.h = h;
}

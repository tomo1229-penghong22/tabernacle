// materials.js
// マテリアルはすべてここに集約する。テクスチャは Canvas によるプロシージャル生成のみ
// （外部画像アセットなし）。
//
// フェーズ2 (T6/T7/T8): 経年劣化(F3)・天候劣化(F4)・風による布の揺れ(F5の材質側)・
// 雨による濡れ(F6の材質側)を、共有uniform(ENV_UNIFORMS)を介した onBeforeCompile
// シェーダー注入で実装する。すべてのマテリアルが同じuniformオブジェクトを参照するため、
// setWeathering()/setWind()/setRainAmount() を呼ぶだけで全マテリアルに反映される。

import * as THREE from 'three';
import { MATERIALS, TABERNACLE, FRAME, PILLAR_CLEARANCE_GAP_M, ROOF_DRAPE_INWARD_CAP_M } from './dimensions.js';

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

// isColor: 色(アルベド)テクスチャはsRGBでデコードする必要があるが、法線マップ/ラフネス
// マップはデータ(線形)として扱うべきなのでcolorSpaceを設定しない(T12/T13)。
function makeTexture(canvas, repeat = [1, 1], isColor = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- ハイトフィールド → 法線マップ変換（T12織り目・T13鋳造肌の共通ヘルパー） -----------
function heightFieldToNormalCanvas(height, size, strength) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = height[y * size + ((x - 1 + size) % size)];
      const hR = height[y * size + ((x + 1) % size)];
      const hD = height[((y - 1 + size) % size) * size + x];
      const hU = height[((y + 1) % size) * size + x];
      let nx = -(hR - hL) * strength;
      let ny = -(hU - hD) * strength;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
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

// --- 銀の台座: 鋳造肌（T13） -----------------------------------------------
// ランダムな丸いブロブ(気泡跡・鋳造痕)を凹凸として重ねたハイトフィールドを作り、
// そこから 色(凹部=黒ずみ寄り, 凸部=摩耗で光る明るい銀)・法線・ラフネス
// (凸部=低ラフネスで光沢, 凹部=高ラフネスでくすむ) を一括生成する。
// 経年による黒ずみ(WEATHER_CONFIGS[MATERIALS.SILVER])はこの上にさらに重なる。
//
// T13差し戻し(D2, 2026-09-25): 「金属感が足りない」との判定を受け、原因を切り分けた。
// 切り分け結果(要確認: 人間の実ブラウザでの見た目を直接は確認できないため、以下は
// コード上の値からの推測): (1)地色(darkRGB/worn)が中間グレーで暗すぎた
// (150-232, さらにmaterial.colorの0xc7c9cfを掛けて実効的にさらに暗化)、
// (2)ラフネスのベースが高すぎた(0.28〜0.78、平均的に見てもマットよりで
// 光沢が弱い)、(3)法線マップの強さ(2.2)が模様のわりに強く、ハイライトが
// 細かく散ってしまい「はっきりしたハイライト」ではなく「ざらついた質感」に
// 見えやすかった、(4)自動テスト(ヘッドレス)経路ではPMREM環境マップが
// 無効化されるため検証SSでは反射が弱く写る(本番の人間の閲覧では有効)。
// 対策: 地色を明るくし(かつmaterial.colorを白に変更して二重に暗くしない)、
// ラフネスを全体的に下げ(0.08〜0.42、磨かれた銀らしい低ラフネス側に寄せる)、
// 法線強度を下げて(2.2→1.0)ハイライトが散らばりすぎないようにし、
// metalness/envMapIntensityを上げて環境の映り込みを強めた(getMaterial側)。
// 凹凸(鋳造痕)自体は「微細な凹凸」の要件を保つため、ブロブ数は維持しつつ
// 振幅を半分程度に抑え、地色コントラストは保ったまま暗すぎないようにした。
function buildSilverCastMaps() {
  const size = 128;
  const height = new Float32Array(size * size);
  const blobCount = 90;
  for (let b = 0; b < blobCount; b++) {
    const cx = Math.random() * size, cy = Math.random() * size, r = 3 + Math.random() * 7;
    const amp = (Math.random() - 0.4) * 0.6; // T13差し戻し: 振幅を1.2→0.6に縮小(凹凸を控えめに)
    const yMin = Math.max(0, Math.floor(cy - r - 1));
    const yMax = Math.min(size, Math.ceil(cy + r + 1));
    const xMin = Math.max(0, Math.floor(cx - r - 1));
    const xMax = Math.min(size, Math.ceil(cx + r + 1));
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) height[y * size + x] += amp * (1 - d * d);
      }
    }
  }
  for (let i = 0; i < height.length; i++) height[i] += (Math.random() - 0.5) * 0.1; // 微細な地肌ノイズ(控えめ)

  const normalCanvas = heightFieldToNormalCanvas(height, size, 1.0); // T13差し戻し: 2.2→1.0

  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < height.length; i++) { if (height[i] < hMin) hMin = height[i]; if (height[i] > hMax) hMax = height[i]; }
  const range = Math.max(1e-6, hMax - hMin);

  const colorCanvas = makeCanvas(size, size);
  const cctx = colorCanvas.getContext('2d');
  const cimg = cctx.createImageData(size, size);
  const roughCanvas = makeCanvas(size, size);
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  // T13差し戻し: 地色を明るい銀寄りに変更(凹部も黒ずみではなく落ち着いた明るい銀にする)。
  const darkRGB = [188, 190, 196]; // 凹部: 控えめな陰
  const worn = [240, 242, 248]; // 凸部: 摩耗で光る明るい銀(ほぼ白に近い)
  for (let i = 0; i < height.length; i++) {
    const t = Math.pow((height[i] - hMin) / range, 1.5); // 0=凹, 1=凸(摩耗)
    const idx = i * 4;
    cimg.data[idx] = darkRGB[0] + (worn[0] - darkRGB[0]) * t;
    cimg.data[idx + 1] = darkRGB[1] + (worn[1] - darkRGB[1]) * t;
    cimg.data[idx + 2] = darkRGB[2] + (worn[2] - darkRGB[2]) * t;
    cimg.data[idx + 3] = 255;
    // T13差し戻し: ラフネスを全体的に下げ(0.08〜0.42)、磨かれた銀らしい光沢に寄せる。
    const rough = 255 * (0.42 - 0.34 * t);
    const rv = Math.max(0, Math.min(255, rough));
    rimg.data[idx] = rimg.data[idx + 1] = rimg.data[idx + 2] = rv;
    rimg.data[idx + 3] = 255;
  }
  cctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  return { colorCanvas, normalCanvas, roughCanvas };
}

// --- 亜麻布（白地、必要に応じ縦縞で青紫緋を表現） --------------------------
// T12: プラ板的な均一さをなくすため、経糸・緯糸を交互に明暗させる織り目と
// 繊維の毛羽・むら(斑点ノイズ)を追加する。法線/ラフネス(凹凸・柔らかい光沢)は
// buildLinenNormalMap/buildLinenRoughnessMapで別途生成する。
// T12差し戻し(D2, 2026-09-25): 「ごわごわしすぎ」との判定を受け、上質な細い亜麻布
// (出エジプト記の「上等の亜麻」)を狙って調整した。
// 根拠(織りの細かさ): 実物の上質亜麻は目安として約150本/インチ程度(繊維の太さ
// 数百μm)だが、そのままの縮尺(スパン数m〜十数mの布に対し1タイル1mm未満)では
// テクスチャ解像度・タイリング回数が非現実的になりモアレの原因にもなるため、
// 「近づくと織り目とわかる程度に細かい」を狙い、1タイルあたりの織り目本数を
// 増やしつつ(THREAD_PXを半分に)、タイル自体の反復回数(repeat)も増やして
// 見かけの糸の間隔を数mm〜1cm程度まで縮小した(以前は1タイルが壁全体に対して
// 大きすぎ、織り目が粗いブロック状に見えていた)。
const LINEN_THREAD_PX = 4;
const LINEN_REPEAT = [8, 4];
function buildLinenTexture(withStripes = false, withCherub = false) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, size, size);
  // 織り目: 経糸・緯糸が交互に上に来る格子(市松状の明暗)＋グリッド線。
  // 上質な亜麻は織り目の色ムラが目立たないため、コントラストは控えめにする。
  for (let gy = 0; gy < size; gy += LINEN_THREAD_PX) {
    for (let gx = 0; gx < size; gx += LINEN_THREAD_PX) {
      const over = (Math.floor(gx / LINEN_THREAD_PX) + Math.floor(gy / LINEN_THREAD_PX)) % 2 === 0;
      ctx.fillStyle = over ? 'rgba(255,252,240,0.05)' : 'rgba(120,110,85,0.05)';
      ctx.fillRect(gx, gy, LINEN_THREAD_PX, LINEN_THREAD_PX);
    }
  }
  ctx.strokeStyle = 'rgba(150,140,110,0.07)';
  for (let i = 0; i < size; i += LINEN_THREAD_PX) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
  }
  // 繊維の毛羽・むら: 遠目では滑らかに見えるよう、点数・不透明度を大きく抑える。
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,250,235,0.18)' : 'rgba(90,80,60,0.14)';
    ctx.fillRect(x, y, 1, 1);
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
  return makeTexture(c, LINEN_REPEAT);
}

// T12差し戻し(D2): 凹凸を控えめにするため、山の振幅・ノイズ量を以前の半分以下にした
// (経糸・緯糸のコントラスト 1.0/0.35→0.4/0.15、毛羽ノイズ ±0.3→±0.08)。
// 亜麻布の法線マップ(経糸・緯糸の織り目の凹凸)。ケルブ刺しゅうがある場合は
// 該当位置(buildLinenTextureの柄と同じ楕円配置)に糸の盛り上がりを追加する。
function buildLinenWeaveHeight(size, threadPx) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x % threadPx) / threadPx;
      const wy = (y % threadPx) / threadPx;
      const over = (Math.floor(x / threadPx) + Math.floor(y / threadPx)) % 2 === 0;
      const bumpX = Math.sin(wx * Math.PI);
      const bumpY = Math.sin(wy * Math.PI);
      let h = over ? bumpX * 0.4 + bumpY * 0.15 : bumpY * 0.4 + bumpX * 0.15;
      h += (Math.random() - 0.5) * 0.08; // 繊維の毛羽・むら(控えめ)
      height[y * size + x] = h;
    }
  }
  return height;
}

function addCherubEmbroideryBump(height, size) {
  // ケルブ刺しゅう＝糸の盛り上がり。buildLinenTexture の柄(楕円2つ×4段)と同じ位置に凸を足す。
  for (let i = 0; i < 4; i++) {
    const cx = size / 2, cy = (i + 0.5) * (size / 4);
    [[-24, Math.PI / 6], [24, -Math.PI / 6]].forEach(([dx, rot]) => {
      const ex = cx + dx, ey = cy, rx = 20, ry = 8;
      const yMin = Math.max(0, Math.floor(ey - ry - 4));
      const yMax = Math.min(size, Math.ceil(ey + ry + 4));
      const xMin = Math.max(0, Math.floor(ex - rx - 4));
      const xMax = Math.min(size, Math.ceil(ex + rx + 4));
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      for (let y = yMin; y < yMax; y++) {
        for (let x = xMin; x < xMax; x++) {
          const lx = (x - ex) * cos - (y - ey) * sin;
          const ly = (x - ex) * sin + (y - ey) * cos;
          const d = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
          if (d < 1) height[y * size + x] += (1 - d) * 1.8;
        }
      }
    });
  }
}

function buildLinenNormalMap(withCherub = false) {
  const size = 256;
  const height = buildLinenWeaveHeight(size, LINEN_THREAD_PX);
  if (withCherub) addCherubEmbroideryBump(height, size);
  // T12差し戻し(D2): 法線の強さを1.4→0.6に下げ、凹凸を控えめにした(「近づくと
  // わかる程度」を狙い、遠目では平滑に見えるようにする)。
  return heightFieldToNormalCanvas(height, size, 0.6);
}

// T12差し戻し(D2): 柔らかい光沢(しなやかさ)を保ちつつ、遠目でのムラを抑えるため
// ラフネスのベース値を下げ(以前0.76〜0.94→0.59〜0.72)、変動幅も縮めた。
function buildLinenRoughnessMap() {
  const size = 256;
  const blotchSize = 20;
  const blotch = makeCanvas(blotchSize, blotchSize);
  const bctx = blotch.getContext('2d');
  const bimg = bctx.createImageData(blotchSize, blotchSize);
  for (let i = 0; i < bimg.data.length; i += 4) {
    const v = 150 + Math.random() * 35;
    bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = v;
    bimg.data[i + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);

  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.drawImage(blotch, 0, 0, size, size); // 拡大描画でにじませ、低周波のムラにする
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    const v = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
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
    if (isCloth) {
      vertCommon += `
      attribute float windFree;
      attribute float pillarGate;
      attribute float pillarScreenMask;
      attribute float wallOutSign;
      attribute vec2 drapeUV;
      uniform float uWindSpeed, uTime;
      uniform vec2 uWindDir;
      const float PILLAR_GAP_M = ${PILLAR_CLEARANCE_GAP_M};
      const float PILLAR_GATE_SAFETY = 0.8;
      const float SAFE_ALONG_M = 0.1;
      const float DRAPE_INWARD_CAP_M = ${ROOF_DRAPE_INWARD_CAP_M};`; // T14: 数値の根拠はcloth.js/log/t14_report.md参照
    }
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
        // T15: wallOutSign!=0 (壁際の屋根の垂れ)の頂点だけ、波の位相に position ではなく
        // 4層共通の基準座標 drapeUV を使う。0(他の布)では mix(position.xy, ., 0) = position.xy
        // で恒等。
        vec2 wp = mix(position.xy, drapeUV, abs(wallOutSign));
        float wave = sin(wp.x * 2.2 + wp.y * 1.3 + uTime * 2.6) * 0.6
                   + sin(wp.x * 5.1 - uTime * 4.3) * 0.4;
        float mag = amp * windFree;
        vec3 disp = vec3(uWindDir.x, 0.0, uWindDir.y) * mag * (push * 0.5 + (0.5 + flutterBias) * wave);
        disp.y += mag * 0.25 * sin(uTime * 6.0 + wp.x * 7.0 + wp.y * 3.0);
        // T14: pillarGate(0=柱情報なし/柱から離れている, 1=柱の位置)、
        // pillarScreenMask(0=柱情報なし, 1=入口の幕メッシュ全体で一定)。この材質は
        // 複数の布種別(壁掛け布・屋根垂れ等)で共有されているため、必ずジオメトリ側の
        // これらの属性で挙動を分岐させる。両方0のとき下のmix()はすべて恒等
        // (mix(a,b,0)=a)になるため、この属性を持たない/常に0の布の揺れは
        // 一切変わらない(cloth.jsのapplyWindFreeが既定値0を敷く)。
        // disp.z はメッシュのrotation.y=90°を経てワールドX(柱のある外側)方向になる
        // (両入口幕とも同じ回転)。柱の位置(pillarGate=1)では外側への変位を
        // PILLAR_GAP_M*PILLAR_GATE_SAFETY 未満に滑らかに(飽和させて)頭打ちにし、
        // 柱の面から出ないようにする。内側(disp.z<0)への変位は制約しない
        // (反対側は自由になびく)。disp.x はワールドZ(沿面)方向になるため、柱から
        // 離れていても大風で隣の柱の位置までサイドに流れ込んで貫通しないよう、
        // 入口の幕全体(pillarScreenMask=1)で沿面変位の絶対値をSAFE_ALONG_M未満に
        // 頭打ちにし、柱の位置(pillarGate=1)では沿面変位を完全に0にする(T14差し戻し:
        // 両端の柱は北壁・南壁の枠の内側面ともゼロ距離で接しており、わずかな沿面変位
        // でも枠に貫通するため、柱位置では横滑りを一切許さない)。
        float pillarAllowOut = max(PILLAR_GAP_M * PILLAR_GATE_SAFETY, 1e-5);
        float dispZGated = disp.z > 0.0 ? pillarAllowOut * (1.0 - exp(-disp.z / pillarAllowOut)) : disp.z;
        disp.z = mix(disp.z, dispZGated, pillarGate);
        float alongCapped = disp.x >= 0.0
          ? SAFE_ALONG_M * (1.0 - exp(-disp.x / SAFE_ALONG_M))
          : -SAFE_ALONG_M * (1.0 - exp(disp.x / SAFE_ALONG_M));
        disp.x = mix(disp.x, alongCapped, pillarScreenMask);
        disp.x = mix(disp.x, 0.0, pillarGate);
        // T15: 壁際の屋根の垂れ(wallOutSign=±1: ローカルzのうち壁の外へ向かう向きの符号)。
        // 壁の内側(枠側)へ向かう変位(outward<0)を DRAPE_INWARD_CAP_M 未満に滑らかに
        // 頭打ちにする。外側(outward>0)は従来のまま。wallOutSign=0 の布は mix の重み0で
        // 変位がそのまま残る。disp.x(沿面)・disp.y(上下)は壁に対して平行/垂直で
        // 枠の外面へ向かう成分がないため拘束しない。
        float outward = disp.z * wallOutSign;
        float outwardCapped = outward >= 0.0 ? outward : -DRAPE_INWARD_CAP_M * (1.0 - exp(outward / DRAPE_INWARD_CAP_M));
        disp.z = mix(disp.z, outwardCapped * wallOutSign, abs(wallOutSign));
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
    case MATERIALS.SILVER: {
      // T13: 鋳造銀。微細な凹凸(気泡跡・打痕)から色/法線/ラフネスを生成し、
      // 摩耗した凸部は明るく低ラフネス(光沢)、凹部はやや控えめな陰にする。
      // 経年の黒ずみ(WEATHER_CONFIGS)はこの上にさらに重なる。環境反射はmain.jsの
      // PMREM(RoomEnvironment)による簡易環境マップを使用(既存)。
      // T13差し戻し(D2): 地色を二重に暗くしないようmaterial.colorは中立の白に変更、
      // metalness/envMapIntensityを上げて「一目で磨かれた銀とわかる」反射を強めた。
      const silverMaps = buildSilverCastMaps();
      return getOrBuild(key, () => new THREE.MeshStandardMaterial({
        map: makeTexture(silverMaps.colorCanvas, [5, 5]),
        normalMap: makeTexture(silverMaps.normalCanvas, [5, 5], false),
        roughnessMap: makeTexture(silverMaps.roughCanvas, [5, 5], false),
        color: 0xffffff, roughness: 1.0, metalness: 0.96, envMapIntensity: 2.4,
      }));
    }
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
    // T12: 亜麻布。織り目の法線マップ・むらのあるラフネスマップ・柔らかく低い光沢
    // (sheen)を追加してプラ板的な均一さをなくす。中庭の掛け布・入口幕も同じ
    // マテリアルキー(linen/linenEntrance)を共有しているため自動的に適用される。
    case MATERIALS.LINEN:
      return getOrBuild(key, () => new THREE.MeshPhysicalMaterial({
        map: buildLinenTexture(false, false),
        normalMap: makeTexture(buildLinenNormalMap(false), LINEN_REPEAT, false),
        roughnessMap: makeTexture(buildLinenRoughnessMap(), LINEN_REPEAT, false),
        roughness: 1.0, metalness: 0, side: THREE.DoubleSide,
        sheen: 0.45, sheenRoughness: 0.62, sheenColor: new THREE.Color(0xfff3df),
      }));
    case MATERIALS.LINEN_CHERUB:
      return getOrBuild(key, () => new THREE.MeshPhysicalMaterial({
        map: buildLinenTexture(true, true),
        normalMap: makeTexture(buildLinenNormalMap(true), LINEN_REPEAT, false), // ケルブ刺しゅう=糸の盛り上がり
        roughnessMap: makeTexture(buildLinenRoughnessMap(), LINEN_REPEAT, false),
        roughness: 1.0, metalness: 0, side: THREE.DoubleSide,
        sheen: 0.45, sheenRoughness: 0.62, sheenColor: new THREE.Color(0xfff3df),
      }));
    case 'linenEntrance':
      return getOrBuild(key, () => new THREE.MeshPhysicalMaterial({
        map: buildLinenTexture(true, false),
        normalMap: makeTexture(buildLinenNormalMap(false), LINEN_REPEAT, false),
        roughnessMap: makeTexture(buildLinenRoughnessMap(), LINEN_REPEAT, false),
        roughness: 1.0, metalness: 0, side: THREE.DoubleSide,
        sheen: 0.45, sheenRoughness: 0.62, sheenColor: new THREE.Color(0xfff3df),
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

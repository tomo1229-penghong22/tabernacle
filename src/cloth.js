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
}

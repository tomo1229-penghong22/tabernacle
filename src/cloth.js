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

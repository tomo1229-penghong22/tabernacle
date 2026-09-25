// courtyard.js — T3
// 中庭: 柱60本(南北各20・西10・東6・入口4)、銅の台座、銀の掛け金具・柱頭、
// 亜麻の掛け布(高さ2.2m)、入口幕(青・紫・緋・亜麻の織り、8.9m)。

import * as THREE from 'three';
import { COURTYARD, cub, CUBIT, PILLAR_CLEARANCE_GAP_M } from './dimensions.js';
import { getMaterial } from './materials.js';
import { applyWindFree, applyPillarGate, pillarClearanceSegments } from './cloth.js';

function makeInfo(nameJa, dims, material, source, note) {
  return { nameJa, dims, material, source, note };
}

function postsAlongEdge(n, length, center = 0) {
  // n>=2: 両端を含め均等配置（実装上の細部。PLANは総本数のみ規定）
  const positions = [];
  if (n === 1) { positions.push(center); return positions; }
  const step = length / (n - 1);
  for (let i = 0; i < n; i++) positions.push(center - length / 2 + i * step);
  return positions;
}

function makePost(x, z, height) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const pedH = COURTYARD.pedestalSize.y;
  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(COURTYARD.pedestalSize.x, pedH, COURTYARD.pedestalSize.z),
    getMaterial('bronze'),
  );
  pedestal.position.y = pedH / 2;
  pedestal.castShadow = pedestal.receiveShadow = true;
  pedestal.userData.info = makeInfo('柱の台座（銅）', `${COURTYARD.pedestalSize.x.toFixed(2)}×${COURTYARD.pedestalSize.y.toFixed(2)}×${COURTYARD.pedestalSize.z.toFixed(2)}m`, '銅', '出エジプト記27:10');
  group.add(pedestal);

  const shaftH = height - pedH;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(COURTYARD.postDiameter / 2, COURTYARD.postDiameter / 2, shaftH, 10),
    getMaterial('acaciaWood'),
  );
  shaft.position.y = pedH + shaftH / 2;
  shaft.castShadow = shaft.receiveShadow = true;
  shaft.userData.info = makeInfo('中庭の柱', `直径${(COURTYARD.postDiameter * 100).toFixed(0)}cm×高さ${height.toFixed(2)}m`, 'アカシア材', '出エジプト記27:10-11');
  group.add(shaft);

  const capitalR = COURTYARD.postDiameter / 2 + COURTYARD.capitalRadiusGrowth;
  const capital = new THREE.Mesh(
    new THREE.CylinderGeometry(capitalR, capitalR, COURTYARD.capitalHeight, 10),
    getMaterial('silver'),
  );
  capital.position.y = height - COURTYARD.capitalHeight / 2;
  capital.castShadow = true;
  capital.userData.info = makeInfo('柱頭（銀）', `高さ${(COURTYARD.capitalHeight * 100).toFixed(0)}cm`, '銀', '出エジプト記27:10-11,17');
  group.add(capital);

  return group;
}

// pillarGate: T14。{ localXs, offsetHalfExtent, pillarSpacing } を渡すと、布の
// 幅方向分割数を pillarClearanceSegments() で(辺が柱を切らないよう)十分な
// 分割数に引き上げた上で、applyPillarGate() で柱近接属性を焼き込む
// (entranceCurtainの入口幕専用。wallHangingでは渡さないため中庭の掛け布の
// 揺れは変わらない)。この関数の呼び出し側で布の位置(x)自体もすでに柱の内側へ
// オフセットしてある。
function makeHangingPanel(width, height, material, x, z, rotY, windKind, pillarGate) {
  // 風(T7)で滑らかに揺れるよう、分割数は高さ方向も十分に取る。
  const baseWidthSegments = Math.max(4, Math.round(width * 2));
  const widthSegments = pillarGate
    ? pillarClearanceSegments(width, pillarGate.pillarSpacing, pillarGate.offsetHalfExtent, baseWidthSegments)
    : baseWidthSegments;
  const geo = new THREE.PlaneGeometry(width, height, widthSegments, 12);
  applyWindFree(geo, windKind);
  if (pillarGate) applyPillarGate(geo, pillarGate.localXs, pillarGate.offsetHalfExtent);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, height / 2, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCourtyard(scene, controls) {
  const group = new THREE.Group();
  group.name = 'courtyard';

  const halfL = cub(COURTYARD.lengthCubit) / 2; // x方向 半長
  const halfW = cub(COURTYARD.widthCubit) / 2; // z方向 半幅
  const hangH = COURTYARD.hangingHeight;
  const postH = hangH; // 柱は掛け布の高さに合わせる（実装上の細部）

  const posts = new THREE.Group(); posts.name = 'courtyardPosts';
  const linenMat = getMaterial('linen');
  const entranceMat = getMaterial('linenEntrance');
  const hangings = new THREE.Group(); hangings.name = 'courtyardHangings';

  // +z=南(PLAN A7)のため 北 (z = -halfW), 南 (z = +halfW): 20本ずつ、x方向に均等
  for (const side of [-1, 1]) {
    const z = side * halfW;
    const dirLabel = side === 1 ? '南' : '北';
    const xs = postsAlongEdge(COURTYARD.postCounts.north, halfL * 2, 0);
    xs.forEach((x) => posts.add(makePost(x, z, postH)));
    const panel = makeHangingPanel(halfL * 2, hangH, linenMat, 0, z, 0, 'wallHanging');
    panel.userData.info = makeInfo(`中庭の掛け布（亜麻・${dirLabel}）`, `長さ${(halfL * 2).toFixed(2)}m×高さ${hangH.toFixed(2)}m`, '亜麻（撚り糸）', '出エジプト記27:9,18');
    hangings.add(panel);
    controls.registerCollider(panel);
  }

  // 西 (x = -halfL): 10本
  {
    const x = -halfL;
    const zs = postsAlongEdge(COURTYARD.postCounts.west, halfW * 2, 0);
    zs.forEach((z) => posts.add(makePost(x, z, postH)));
    const panel = makeHangingPanel(halfW * 2, hangH, linenMat, x, 0, Math.PI / 2, 'wallHanging');
    panel.userData.info = makeInfo('中庭の掛け布（亜麻・西）', `長さ${(halfW * 2).toFixed(2)}m×高さ${hangH.toFixed(2)}m`, '亜麻（撚り糸）', '出エジプト記27:9,18');
    hangings.add(panel);
    controls.registerCollider(panel);
  }

  // 東 (x = +halfL): 入口(20キュビト)を挟んで6本(外側2区画×3)＋入口4本
  {
    const x = halfL;
    const entranceHalf = COURTYARD.entranceWidth / 2;
    const outerLen = halfW - entranceHalf; // 片側の掛け布長さ (15キュビト相当)
    const segCount = COURTYARD.postCounts.east / 2; // 3本/区画

    // 北側区画(+z=南のためcenterZ負=北側) z: [-halfW, -entranceHalf]
    {
      const centerZ = -(halfW + entranceHalf) / 2;
      const zs = postsAlongEdge(segCount, outerLen, centerZ);
      zs.forEach((z) => posts.add(makePost(x, z, postH)));
      const panel = makeHangingPanel(outerLen, hangH, linenMat, x, centerZ, Math.PI / 2, 'wallHanging');
      panel.userData.info = makeInfo('中庭の掛け布（亜麻・東北）', `長さ${outerLen.toFixed(2)}m×高さ${hangH.toFixed(2)}m`, '亜麻（撚り糸）', '出エジプト記27:9,14');
      hangings.add(panel);
      controls.registerCollider(panel);
    }
    // 南側区画(+z=南のためcenterZ正=南側) z: [entranceHalf, halfW]
    {
      const centerZ = (halfW + entranceHalf) / 2;
      const zs = postsAlongEdge(segCount, outerLen, centerZ);
      zs.forEach((z) => posts.add(makePost(x, z, postH)));
      const panel = makeHangingPanel(outerLen, hangH, linenMat, x, centerZ, Math.PI / 2, 'wallHanging');
      panel.userData.info = makeInfo('中庭の掛け布（亜麻・東南）', `長さ${outerLen.toFixed(2)}m×高さ${hangH.toFixed(2)}m`, '亜麻（撚り糸）', '出エジプト記27:9,15');
      hangings.add(panel);
      controls.registerCollider(panel);
    }
    // 入口 4本 + 入口幕（通過可）
    // T14(人間決定2026-09-25): 布は柱の内側(中庭側、-x方向)へオフセットして掛ける。
    // オフセット量 = 柱の断面の最大半径/半幅(entrancePostHalfExtent) + 余裕(PILLAR_CLEARANCE_GAP_M)。
    {
      const zs = postsAlongEdge(COURTYARD.postCounts.entrance, COURTYARD.entranceWidth, 0);
      zs.forEach((z) => posts.add(makePost(x, z, postH)));
      const offset = COURTYARD.entrancePostHalfExtent + PILLAR_CLEARANCE_GAP_M;
      const clothX = x - offset;
      const pillarSpacing = COURTYARD.entranceWidth / (COURTYARD.postCounts.entrance - 1);
      const panel = makeHangingPanel(COURTYARD.entranceWidth, hangH, entranceMat, clothX, 0, Math.PI / 2, 'entranceCurtain',
        { localXs: zs.map((z) => -z), offsetHalfExtent: COURTYARD.entrancePostHalfExtent, pillarSpacing });
      panel.name = 'courtyardEntranceCurtain';
      panel.userData.passable = true;
      panel.userData.info = makeInfo('中庭の入口の幕', `幅${COURTYARD.entranceWidth.toFixed(2)}m×高さ${hangH.toFixed(2)}m`, '青・紫・緋色の撚り糸と亜麻（織り）', '出エジプト記27:16');
      hangings.add(panel);
      controls.registerCollider(panel, { passable: true });
    }
  }

  group.add(posts);
  group.add(hangings);
  scene.add(group);

  return { group, posts, hangings, halfL, halfW, hangH };
}

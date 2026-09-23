// tabernacle.js — T4
// 幕屋本体: 枠48枚(金張り、銀台座2/枚)、横木15本(各側5)、垂れ幕(4柱・銀台座4、ケルブ刺しゅう)、
// 入口の幕(5柱・銅台座5)、屋根4層(平屋根・側面背面に垂らす。個別ON/OFF可能)。

import * as THREE from 'three';
import { FRAME, TABERNACLE, ROOF, cub } from './dimensions.js';
import { getMaterial } from './materials.js';

function makeInfo(nameJa, dims, material, source, note) {
  return { nameJa, dims, material, source, note };
}

const PEDESTAL_H = 0.22; // 台座の高さ（実装上の細部）。
// R1差し戻し対応: 枠そのものが10キュビト(FRAME.height)。台座はその下に別途置かれ、
// 枠メッシュの高さから台座分を差し引くことはしない（外形高さは台座の分だけ4.45mを超える）。

function addSilverSocket(parent, x, z, w) {
  const h = PEDESTAL_H, d = w * 0.9;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h, d), getMaterial('silver'));
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.tag = 'silverSocket';
  mesh.userData.info = makeInfo('銀の台座', `枠1枚あたり2個、計100個 (A4)`, '銀', '出エジプト記26:19,25 / 38:27');
  parent.add(mesh);
  return mesh;
}

function addBronzeSocket(parent, x, z, w) {
  const h = 0.2, d = w * 0.9;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h, d), getMaterial('bronze'));
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.tag = 'bronzeSocket';
  mesh.userData.info = makeInfo('銅の台座', '入口の幕の柱を支える', '銅', '出エジプト記27:17 / 38:17');
  parent.add(mesh);
  return mesh;
}

function makeFrame(width, thickness, totalHeight) {
  // R1: 枠メッシュの高さ=totalHeight(=FRAME.height, 10キュビト)そのもの。台座は差し引かない。
  const geo = new THREE.BoxGeometry(width * 0.97, totalHeight, thickness);
  const mesh = new THREE.Mesh(geo, getMaterial('gold'));
  mesh.position.y = PEDESTAL_H + totalHeight / 2; // 台座の上に載せる
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.tag = 'frame';
  mesh.userData.info = makeInfo('幕屋の枠', `幅${width.toFixed(2)}m×高さ${totalHeight.toFixed(2)}m×厚さ${thickness.toFixed(2)}m(A1仮定)`, 'アカシア材 金張り', '出エジプト記26:15-25');
  return mesh;
}

function buildFrameWalls(group) {
  const w = FRAME.width;
  const t = FRAME.thickness;
  const h = FRAME.height;
  const xBack = TABERNACLE.xBack;
  const xEntrance = TABERNACLE.xEntrance;
  const zHalf = TABERNACLE.zHalf;

  const framesGroup = new THREE.Group(); framesGroup.name = 'frames';
  const socketsGroup = new THREE.Group(); socketsGroup.name = 'frameSockets';
  // 衝突判定は壁ごとに分ける（framesGroup全体を1つのBox3にすると内部(通路)まで
  // 塞いでしまうため）。北壁・南壁・西壁それぞれの薄い直方体のみを衝突対象にする。
  // (THREE.Objectは単一の親しか持てないため、ここでは参照を配列で集めてBox3を個別に計算する)
  const northWallMeshes = []; const southWallMeshes = []; const westWallMeshes = [];

  // 南壁 (z = +zHalf 付近, +z=南), 北壁 (z = -zHalf 付近): 各20枚, x: xBack -> xEntrance
  for (const side of [1, -1]) {
    const z = side * (zHalf + t / 2);
    const wallList = side === 1 ? southWallMeshes : northWallMeshes;
    for (let i = 0; i < FRAME.counts.north; i++) {
      const x = xBack + (i + 0.5) * w;
      const frame = makeFrame(w, t, h);
      frame.position.x = x; frame.position.z = z;
      framesGroup.add(frame);
      wallList.push(frame);
      addSilverSocket(socketsGroup, x - w * 0.28, z, w * 0.3);
      addSilverSocket(socketsGroup, x + w * 0.28, z, w * 0.3);
    }
  }

  // 西壁(背面, x = xBack付近): 通常枠6 + 隅の枠2 = 8枚, z: -zHalf..+zHalf
  {
    const x = xBack - t / 2;
    const regularSpan = FRAME.counts.west * w; // 9キュビト相当
    const startZ = -regularSpan / 2;
    for (let i = 0; i < FRAME.counts.west; i++) {
      const z = startZ + (i + 0.5) * w;
      const frame = makeFrame(w, t, h);
      frame.rotation.y = Math.PI / 2;
      frame.position.x = x; frame.position.z = z;
      framesGroup.add(frame);
      westWallMeshes.push(frame);
      addSilverSocket(socketsGroup, x, z - w * 0.28, w * 0.3);
      addSilverSocket(socketsGroup, x, z + w * 0.28, w * 0.3);
    }
    // 隅の枠2枚: 本文に構造の明記なし(要確認事項)。
    // 西壁の残り幅(左右各0.5キュビト相当)を閉じる最小実装として、狭幅の隅枠を配置する。
    const remaining = (zHalf * 2 - regularSpan) / 2; // 片側の残り幅
    for (const s of [-1, 1]) {
      const z = s * (regularSpan / 2 + remaining / 2);
      const cornerMeshH = h; // R1: 台座分を差し引かない
      const corner = new THREE.Mesh(
        new THREE.BoxGeometry(remaining * 0.95, cornerMeshH, t),
        getMaterial('gold'),
      );
      corner.rotation.y = Math.PI / 2;
      corner.position.set(x, PEDESTAL_H + cornerMeshH / 2, z);
      corner.castShadow = corner.receiveShadow = true;
      corner.userData.info = makeInfo(
        '幕屋の隅の枠',
        `幅${remaining.toFixed(2)}m(要確認: 本文に隅の接合構造の明記なし)`,
        'アカシア材 金張り',
        '出エジプト記26:23-24',
        '隅の枠2枚の正確な形状は伝統的解釈が分かれるため最小実装とした',
      );
      framesGroup.add(corner);
      westWallMeshes.push(corner);
      addSilverSocket(socketsGroup, x, z, remaining * 0.9);
      addSilverSocket(socketsGroup, x, z, remaining * 0.9); // 隅は2個(A4)
    }
  }

  group.add(framesGroup);
  group.add(socketsGroup);

  function boxFromMeshes(meshes) {
    const box = new THREE.Box3();
    meshes.forEach((m) => { m.updateWorldMatrix(true, false); box.union(new THREE.Box3().setFromObject(m)); });
    return box;
  }
  const northWallBox = boxFromMeshes(northWallMeshes);
  const southWallBox = boxFromMeshes(southWallMeshes);
  const westWallBox = boxFromMeshes(westWallMeshes);
  const wallBoxes = [northWallBox, southWallBox, westWallBox];

  return {
    framesGroup,
    socketsGroup,
    wallBoxes,
    northWallBox,
    southWallBox,
    westWallBox,
    sampleFrame: northWallMeshes[0], // C1検証用: 枠1枚の高さをこのメッシュで測る
  };
}

function buildCrossbars(group) {
  const bars = new THREE.Group(); bars.name = 'crossbars';
  const { perSide, diameter } = TABERNACLE.crossbars;
  const h = FRAME.height;
  const xBack = TABERNACLE.xBack;
  const xEntrance = TABERNACLE.xEntrance;
  const zHalf = TABERNACLE.zHalf;
  const length = xEntrance - xBack; // 30キュビト相当(北南壁用)
  const widthZ = zHalf * 2; // 西壁用

  function heightsFor(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(h * (i + 1) / (n + 1));
    return arr;
  }

  // 北・南
  for (const side of [1, -1]) {
    const z = side * (zHalf + FRAME.thickness / 2);
    heightsFor(perSide).forEach((y) => {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(diameter / 2, diameter / 2, length * 0.99, 8),
        getMaterial('gold'),
      );
      bar.rotation.z = Math.PI / 2;
      bar.position.set((xBack + xEntrance) / 2, y, z);
      bar.castShadow = true;
      bar.userData.info = makeInfo('横木', `長さ${length.toFixed(2)}m 金張り`, 'アカシア材 金張り', '出エジプト記26:26-29');
      bars.add(bar);
    });
  }
  // 西
  {
    const x = xBack - FRAME.thickness / 2;
    heightsFor(perSide).forEach((y) => {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(diameter / 2, diameter / 2, widthZ * 0.99, 8),
        getMaterial('gold'),
      );
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, y, 0);
      bar.castShadow = true;
      bar.userData.info = makeInfo('横木（西壁）', `長さ${widthZ.toFixed(2)}m 金張り`, 'アカシア材 金張り', '出エジプト記26:26-29');
      bars.add(bar);
    });
  }
  group.add(bars);
  return bars;
}

function buildScreen({ pillarCount, height, width, pedestalMaterial, x, materialKey, nameJa, source, passable, tag }) {
  const g = new THREE.Group(); g.name = tag;
  const zs = [];
  const step = width / (pillarCount - 1);
  for (let i = 0; i < pillarCount; i++) zs.push(-width / 2 + i * step);

  zs.forEach((z) => {
    const pedH = pedestalMaterial === 'silver' ? 0.22 : 0.2;
    if (pedestalMaterial === 'silver') addSilverSocket(g, x, z, 0.5);
    else addBronzeSocket(g, x, z, 0.5);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, height - pedH, 10),
      getMaterial('gold'),
    );
    pillar.position.set(x, pedH + (height - pedH) / 2, z);
    pillar.castShadow = pillar.receiveShadow = true;
    pillar.userData.info = makeInfo(`${nameJa}の柱`, `高さ${height.toFixed(2)}m`, 'アカシア材 金張り', source);
    g.add(pillar);
  });

  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height, 20, 10),
    getMaterial(materialKey),
  );
  cloth.position.set(x, height / 2, 0);
  cloth.rotation.y = Math.PI / 2;
  cloth.receiveShadow = true;
  cloth.userData.passable = passable;
  cloth.userData.info = makeInfo(nameJa, `幅${width.toFixed(2)}m×高さ${height.toFixed(2)}m`, '青・紫・緋色の撚り糸と亜麻（織り）', source);
  g.add(cloth);

  return { group: g, cloth };
}

function buildRoofLayer({ key, nameJa, material, topLengthCubit, sideOverhangCubit, backOverhangCubit, frontOverhangCubit, source, note, layerIndex = 0 }) {
  const g = new THREE.Group(); g.name = key;
  const mat = getMaterial(material);
  const h = FRAME.height;
  const xBack = TABERNACLE.xBack;
  const xEntrance = TABERNACLE.xEntrance;
  const zHalf = TABERNACLE.zHalf;
  const topLength = cub(topLengthCubit);
  const topWidth = zHalf * 2 + 0.02;
  // 4層が同一平面上でz-fightingしないよう、層ごとに少しずつ外側へオフセットする
  // (内側の布が最下層、アザラシの皮が最上層)。
  const gap = 0.025 * (layerIndex + 1);
  const topY = h + 0.05 + gap;

  const top = new THREE.Mesh(new THREE.PlaneGeometry(topLength, topWidth, 24, 8), mat);
  top.rotation.x = -Math.PI / 2;
  top.position.set((xBack + xEntrance) / 2, topY, 0);
  top.receiveShadow = top.castShadow = true;
  g.add(top);

  if (sideOverhangCubit) {
    const overhang = cub(sideOverhangCubit);
    for (const side of [1, -1]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(topLength, overhang, 24, 10), mat);
      panel.position.set((xBack + xEntrance) / 2, topY - overhang / 2, side * (zHalf + 0.01 + gap));
      panel.castShadow = panel.receiveShadow = true;
      g.add(panel);
    }
  }
  if (backOverhangCubit) {
    const overhang = cub(backOverhangCubit);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(topWidth, overhang, 16, 10), mat);
    panel.rotation.y = Math.PI / 2;
    panel.position.set(xBack - 0.01 - gap, topY - overhang / 2, 0);
    panel.castShadow = panel.receiveShadow = true;
    g.add(panel);
  }
  if (frontOverhangCubit) {
    const overhang = cub(frontOverhangCubit);
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(overhang, topWidth, 8, 8), mat);
    flap.rotation.x = -Math.PI / 2;
    flap.position.set(xEntrance + overhang / 2, topY, 0);
    flap.castShadow = flap.receiveShadow = true;
    g.add(flap);
  }

  g.traverse((o) => {
    if (o.isMesh) o.userData.info = makeInfo(nameJa, `覆い層（表示ON/OFF可）`, '', source, note);
  });
  return g;
}

export function buildTabernacle(scene, controls) {
  const group = new THREE.Group();
  group.name = 'tabernacle';

  const { framesGroup, wallBoxes, northWallBox, southWallBox, westWallBox, sampleFrame } = buildFrameWalls(group);
  wallBoxes.forEach((box) => controls.registerColliderBox(box));
  buildCrossbars(group);

  const veil = buildScreen({
    pillarCount: TABERNACLE.veil.pillarCount,
    height: TABERNACLE.veil.height,
    width: TABERNACLE.veil.width,
    pedestalMaterial: 'silver',
    x: TABERNACLE.xVeil,
    materialKey: 'linenCherub',
    nameJa: '垂れ幕（至聖所の仕切り）',
    source: '出エジプト記26:31-33',
    passable: TABERNACLE.veil.passable,
    tag: 'veil',
  });
  group.add(veil.group);
  controls.registerCollider(veil.cloth, { passable: true });

  const entranceScreen = buildScreen({
    pillarCount: TABERNACLE.entranceScreen.pillarCount,
    height: TABERNACLE.entranceScreen.height,
    width: TABERNACLE.entranceScreen.width,
    pedestalMaterial: 'bronze',
    x: TABERNACLE.xEntrance,
    materialKey: 'linenEntrance',
    nameJa: '幕屋の入口の幕',
    source: '出エジプト記26:36-37',
    passable: TABERNACLE.entranceScreen.passable,
    tag: 'entranceScreen',
  });
  group.add(entranceScreen.group);
  controls.registerCollider(entranceScreen.cloth, { passable: true });

  const roofLayers = {
    innerLinen: buildRoofLayer({ key: 'roofInnerLinen', nameJa: ROOF.innerLinen.nameJa, material: 'linenCherub', ...ROOF.innerLinen, source: ROOF.innerLinen.source, layerIndex: 0 }),
    goatHair: buildRoofLayer({ key: 'roofGoatHair', nameJa: ROOF.goatHair.nameJa, material: 'goatHair', ...ROOF.goatHair, source: ROOF.goatHair.source, layerIndex: 1 }),
    ramSkins: buildRoofLayer({ key: 'roofRamSkins', nameJa: ROOF.ramSkins.nameJa, material: 'ramSkin', ...ROOF.ramSkins, source: ROOF.ramSkins.source, note: ROOF.ramSkins.note, layerIndex: 2 }),
    sealSkins: buildRoofLayer({ key: 'roofSealSkins', nameJa: ROOF.sealSkins.nameJa, material: 'sealSkin', ...ROOF.sealSkins, source: ROOF.sealSkins.source, note: ROOF.sealSkins.note, layerIndex: 3 }),
  };
  Object.values(roofLayers).forEach((g) => group.add(g));

  scene.add(group);

  return {
    group,
    framesGroup,
    veil,
    entranceScreen,
    roofLayers,
    northWallBox,
    southWallBox,
    westWallBox,
    sampleFrame,
  };
}

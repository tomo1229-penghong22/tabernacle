// furniture.js — T5
// 調度品: 契約の箱(ケルブ2体・担ぎ棒)、机、燭台(7ともしび・光源)、香の祭壇、
// 燔祭の祭壇(角・格子)、洗盤。配置は PLAN A7。

import * as THREE from 'three';
import { FURNITURE, cub } from './dimensions.js';
import { getMaterial } from './materials.js';

function makeInfo(nameJa, dims, material, source, note) {
  return { nameJa, dims, material, source, note };
}

function tagInfo(obj, info) {
  obj.traverse((o) => { if (o.isMesh) o.userData.info = info; });
}

function pos(item) {
  return { x: cub(item.position.xCubit), z: cub(item.position.zCubit) };
}

function buildArk() {
  const item = FURNITURE.ark;
  const { l, w, h } = item.size;
  const g = new THREE.Group(); g.name = 'ark';

  const body = new THREE.Mesh(new THREE.BoxGeometry(l, h * 0.8, w), getMaterial('gold'));
  body.position.y = h * 0.4;
  body.castShadow = body.receiveShadow = true;
  body.userData.tag = 'dimBox'; // 検証用: 箱本体の寸法判定はここ(+蓋)のみで行う
  g.add(body);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(l, h * 0.2, w), getMaterial('gold'));
  lid.position.y = h * 0.8 + h * 0.1;
  lid.castShadow = lid.receiveShadow = true;
  lid.userData.tag = 'dimBox';
  g.add(lid);

  // ケルブ2体（翼を広げた簡易形状）
  const cherubMat = getMaterial('gold');
  for (const side of [-1, 1]) {
    const cherub = new THREE.Group();
    const body2 = new THREE.Mesh(new THREE.ConeGeometry(w * 0.12, h * 0.35, 6), cherubMat);
    body2.position.set(side * l * 0.28, h * 0.9 + h * 0.18, 0);
    cherub.add(body2);
    const wing = new THREE.Mesh(new THREE.ConeGeometry(w * 0.3, h * 0.05, 4), cherubMat);
    wing.rotation.z = side * Math.PI / 2.6;
    wing.position.set(side * l * 0.28, h * 0.9 + h * 0.32, 0);
    cherub.add(wing);
    g.add(cherub);
  }

  // 担ぎ棒
  const poleLen = l * 1.6;
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, poleLen, 8), getMaterial('acaciaWood'));
    pole.rotation.z = Math.PI / 2;
    pole.position.set(0, h * 0.4, side * w * 0.42);
    pole.castShadow = true;
    g.add(pole);
  }

  tagInfo(g, makeInfo(item.nameJa, `${l.toFixed(2)}×${w.toFixed(2)}×${h.toFixed(2)}m（ケルブ2体・担ぎ棒付き）`, '金の覆い（アカシア材+金）', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buildTable() {
  const item = FURNITURE.table;
  const { l, w, h } = item.size;
  const g = new THREE.Group(); g.name = 'table';
  const top = new THREE.Mesh(new THREE.BoxGeometry(l, h * 0.12, w), getMaterial('gold'));
  top.position.y = h * 0.94;
  top.castShadow = top.receiveShadow = true;
  top.userData.tag = 'dimBox';
  g.add(top);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, h * 0.88, 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, getMaterial('gold'));
    leg.position.set(sx * (l / 2 - 0.06), h * 0.44, sz * (w / 2 - 0.06));
    leg.castShadow = true;
    leg.userData.tag = 'dimBox';
    g.add(leg);
  }
  tagInfo(g, makeInfo(item.nameJa, `${l.toFixed(2)}×${w.toFixed(2)}×${h.toFixed(2)}m`, 'アカシア材 金張り', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buildLampstand(lights) {
  const item = FURNITURE.lampstand;
  const h = cub(item.heightCubit);
  const g = new THREE.Group(); g.name = 'lampstand';
  const mat = getMaterial('gold');

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.1, 12), mat);
  base.position.y = 0.05;
  g.add(base);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h * 0.8, 10), mat);
  trunk.position.y = 0.1 + h * 0.4;
  g.add(trunk);

  // 燭台の枝: 中央の軸＋左右に3本ずつ、計7つのともしび（25:31-37）。
  // 差し戻し対応: 以前はTorusGeometry(半円)を左右対称に同一中心へ配置しており、
  // 2つの半円が合わさって「円環(トーラス全周)」に見えてしまっていた。
  // 中央軸から外側へ出て上へ曲がる弧(CatmullRomCurve3+TubeGeometry)に描き直し、
  // 7つのともしびがほぼ同じ高さに横一列に並ぶようにする。枝の面はx-y平面(東西・上下)
  // のみに広がり、z方向(南北)には広がらない(現状の向きを維持)。
  const topY = 0.1 + h * 0.8; // 中心の軸の頂上＝中央のともしびの高さ
  const flamePositions = [[0, topY]];
  for (let i = 1; i <= 3; i++) {
    const attachY = topY - i * 0.09; // 外側の枝ほど軸の低い位置から出る
    const armReach = 0.10 + i * 0.07; // 外側の枝ほど横への張り出しが大きい
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, attachY, 0),
        new THREE.Vector3(side * armReach * 0.5, attachY + (topY - attachY) * 0.15, 0),
        new THREE.Vector3(side * armReach * 0.9, topY - (topY - attachY) * 0.1, 0),
        new THREE.Vector3(side * armReach, topY, 0),
      ]);
      const branch = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.014, 6, false), mat);
      g.add(branch);
      flamePositions.push([side * armReach, topY]);
    }
  }

  // 自動テスト時はソフトウェアレンダリングの負荷を抑えるため実光源数を減らす
  // (フレームの炎メッシュは常に7個表示し、見た目・部材数は変えない)。
  const isAutomated = window.__IS_AUTOMATED__ === true;
  flamePositions.slice(0, 7).forEach(([fx, fy], i) => {
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0xffaa33, emissiveIntensity: 1.5 }),
    );
    flame.position.set(fx, fy, 0);
    g.add(flame);
    if (!isAutomated || i === 0 || i === 6) {
      const light = new THREE.PointLight(0xffcc66, 0.8, 4, 2);
      light.position.set(fx, fy, 0);
      g.add(light);
      lights.push(light);
    }
  });

  tagInfo(g, makeInfo(item.nameJa, `純金、7つのともしび、アーモンドの花の装飾`, '純金', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buildIncenseAltar() {
  const item = FURNITURE.incenseAltar;
  const { l, w, h } = item.size;
  const g = new THREE.Group(); g.name = 'incenseAltar';
  const body = new THREE.Mesh(new THREE.BoxGeometry(l, h, w), getMaterial('gold'));
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  body.userData.tag = 'dimBox'; // 検証用: 角は箱本体の寸法に含めない(本文の寸法は箱のみ)
  g.add(body);
  const hornGeo = new THREE.ConeGeometry(0.04, 0.12, 6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const horn = new THREE.Mesh(hornGeo, getMaterial('gold'));
    horn.position.set(sx * (l / 2 - 0.05), h + 0.06, sz * (w / 2 - 0.05));
    g.add(horn);
  }
  tagInfo(g, makeInfo(item.nameJa, `${l.toFixed(2)}×${w.toFixed(2)}×${h.toFixed(2)}m（4隅に角）`, 'アカシア材 金張り', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buildLaver() {
  const item = FURNITURE.laver;
  const g = new THREE.Group(); g.name = 'laver';
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(item.diameter / 2, item.diameter / 2.3, item.height * 0.55, 20), getMaterial('bronze'));
  bowl.position.y = item.height * 0.45 + item.height * 0.275;
  bowl.castShadow = bowl.receiveShadow = true;
  g.add(bowl);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(item.diameter * 0.28, item.diameter * 0.35, item.height * 0.45, 14), getMaterial('bronze'));
  stand.position.y = item.height * 0.225;
  stand.castShadow = stand.receiveShadow = true;
  g.add(stand);
  tagInfo(g, makeInfo(item.nameJa, `直径${item.diameter.toFixed(2)}m×高さ${item.height.toFixed(2)}m（A5仮定）`, '銅', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

function buildAltar() {
  const item = FURNITURE.altar;
  const { l, w, h } = item.size;
  const g = new THREE.Group(); g.name = 'altar';
  // 燔祭の祭壇は「bronzeAltar」専用マテリアルキーを使用し、緑青に加えて
  // 祭壇特有の煤(すす)による黒ずみ(T6)を他の銅製品(洗盤・柱の台座等)とは別に反映する。
  const body = new THREE.Mesh(new THREE.BoxGeometry(l, h, w), getMaterial('bronzeAltar'));
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  body.userData.tag = 'dimBox'; // 検証用: 角・格子は箱本体の寸法に含めない
  g.add(body);

  const hornGeo = new THREE.ConeGeometry(0.12, 0.3, 6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const horn = new THREE.Mesh(hornGeo, getMaterial('bronzeAltar'));
    horn.position.set(sx * (l / 2 - 0.15), h + 0.15, sz * (w / 2 - 0.15));
    g.add(horn);
  }

  // 銅の格子（網目状、祭壇の高さ中央に巻く）
  const latticeGroup = new THREE.Group();
  const barCount = 10;
  for (let i = 0; i < barCount; i++) {
    const t = (i / (barCount - 1)) - 0.5;
    const barH = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, w * 1.01, 6), getMaterial('bronzeAltar'));
    barH.rotation.x = Math.PI / 2;
    barH.position.set(t * l, h * 0.45, 0);
    latticeGroup.add(barH);
    const barV = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, l * 1.01, 6), getMaterial('bronzeAltar'));
    barV.rotation.z = Math.PI / 2;
    barV.position.set(0, h * 0.45, t * w);
    latticeGroup.add(barV);
  }
  g.add(latticeGroup);

  tagInfo(g, makeInfo(item.nameJa, `${l.toFixed(2)}×${w.toFixed(2)}×${h.toFixed(2)}m（4隅に角・銅の格子）`, '銅張り（アカシア材）', item.source));
  const p = pos(item);
  g.position.set(p.x, 0, p.z);
  return g;
}

export function buildFurniture(scene) {
  const group = new THREE.Group();
  group.name = 'furniture';
  const lights = [];

  const ark = buildArk();
  const table = buildTable();
  const lampstand = buildLampstand(lights);
  const incenseAltar = buildIncenseAltar();
  const laver = buildLaver();
  const altar = buildAltar();

  group.add(ark, table, lampstand, incenseAltar, laver, altar);
  scene.add(group);

  return { group, ark, table, lampstand, incenseAltar, laver, altar, lights };
}

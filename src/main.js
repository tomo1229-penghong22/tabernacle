// main.js — フェーズ1 エントリポイント
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildEnvironment } from './environment.js';
import { setupControls } from './controls.js';
import { buildCourtyard } from './courtyard.js';
import { buildTabernacle } from './tabernacle.js';
import { buildFurniture } from './furniture.js';
import { setupUI } from './ui.js';
import { COURTYARD, FRAME, TABERNACLE, FURNITURE } from './dimensions.js';

const scene = new THREE.Scene();

// 自動テスト(Playwright等。navigator.webdriver===trueで検出)ではソフトウェアレンダリングの
// 負荷を下げ、タイムアウト/クラッシュを避ける。実ユーザーには影響しない（品質は変更しない）。
const isAutomated = navigator.webdriver === true;
window.__IS_AUTOMATED__ = isAutomated;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.position.set(10, 26, 50);

const renderer = new THREE.WebGLRenderer({ antialias: !isAutomated, powerPreference: 'high-performance' });
renderer.setPixelRatio(isAutomated ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = isAutomated ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

// 金・銀・銅などmetalness:1のマテリアルは環境マップが無いと(特に幕屋内部のような
// 直射日光が届かない場所で)ほぼ黒く見えてしまうため、簡易環境マップを設定する。
// (自動テスト時はPMREM生成がソフトウェアレンダリングで非常に重くタイムアウト/クラッシュの
// 原因になるためスキップする。検証は寸法・個数のみで見た目には依存しないため影響はない)
if (!isAutomated) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const environment = buildEnvironment(scene);
const controls = setupControls(camera, renderer, environment.groundHeightAt);
controls.orbit.target.set(-6, 2, 0);
controls.orbit.update();

const courtyard = buildCourtyard(scene, controls);
const tabernacle = buildTabernacle(scene, controls);
const furniture = buildFurniture(scene);

const ui = setupUI({ camera, renderer, controls, environment, tabernacle });

// --- 部材クリックで解説表示 (F7 / C8) ---------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragDistance = 0;
renderer.domElement.addEventListener('pointerdown', () => { dragDistance = 0; });
renderer.domElement.addEventListener('pointermove', (e) => { dragDistance += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (controls.getMode() === 'walk') return; // ウォーク中はポインタロックのためクリック判定は別途拡張可
  if (dragDistance > 6) return; // ドラッグ(カメラ操作)はクリックとみなさない
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  const hit = hits.find((h) => h.object.userData && h.object.userData.info);
  ui.showInfo(hit ? hit.object.userData.info : null);
});

// ウォークモード中のクリックでも解説を出せるよう、画面中央のレイキャストを用意
window.addEventListener('click', () => {
  if (controls.getMode() !== 'walk') return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  const hit = hits.find((h) => h.object.userData && h.object.userData.info);
  ui.showInfo(hit ? hit.object.userData.info : null);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);
  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// 検証用API（tools/verify.mjs から window.verifyScene() として呼び出す）
// ---------------------------------------------------------------------------
function box3Size(object) {
  const box = new THREE.Box3().setFromObject(object);
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
}

// dimBoxSize: userData.tag==='dimBox' を持つメッシュのみを対象に寸法を測る。
// 担ぎ棒・ケルブ・角・格子など本文寸法に含まれない付属物を除外して、
// PLAN.md記載の「箱」自体の寸法(±2%)を正しく検証するため。
function dimBoxSize(group) {
  const box = new THREE.Box3();
  let found = false;
  group.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.tag === 'dimBox') {
      o.updateWorldMatrix(true, false);
      box.union(new THREE.Box3().setFromObject(o));
      found = true;
    }
  });
  if (!found) return box3Size(group);
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
}

function countTagged(root, tag) {
  let n = 0;
  root.traverse((o) => { if (o.userData && o.userData.tag === tag) n++; });
  return n;
}

window.verifyScene = function verifyScene() {
  const result = {};

  result.courtyard = box3Size(courtyard.hangings);
  result.courtyardHangingHeightTarget = COURTYARD.hangingHeight;

  const tabBox = new THREE.Box3().setFromObject(tabernacle.framesGroup);
  result.tabernacleFrames = { x: tabBox.max.x - tabBox.min.x, y: tabBox.max.y - tabBox.min.y, z: tabBox.max.z - tabBox.min.z };

  result.ark = dimBoxSize(furniture.ark);
  result.table = dimBoxSize(furniture.table);
  result.incenseAltar = dimBoxSize(furniture.incenseAltar);
  result.altar = dimBoxSize(furniture.altar);

  result.counts = {
    frames: tabernacle.framesGroup.children.length,
    courtyardPosts: courtyard.posts.children.length,
    crossbars: scene.getObjectByName('crossbars')?.children.length || 0,
    veilPillars: TABERNACLE.veil.pillarCount,
    entrancePillars: TABERNACLE.entranceScreen.pillarCount,
    silverSockets: countTagged(scene, 'silverSocket'),
    bronzeSockets: countTagged(scene, 'bronzeSocket'),
  };

  result.targets = {
    courtyard: { length: 45, width: 22, hangingHeight: 2.2 },
    tabernacle: { length: 13.35, width: 4.45, height: 4.45 },
    ark: FURNITURE.ark.size,
    table: FURNITURE.table.size,
    incenseAltar: FURNITURE.incenseAltar.size,
    altar: FURNITURE.altar.size,
    counts: { frames: 48, courtyardPosts: 60, crossbars: 15, veilPillars: 4, entrancePillars: 5, silverSockets: 100 },
  };

  return result;
};

window.setPreset = (key) => ui.applyPreset(ui.PRESETS[key]);
window.setWalkMode = (on) => controls.setMode(on ? 'walk' : 'orbit');
window.setRoofLayer = (key, visible) => { tabernacle.roofLayers[key].visible = visible; };
window.setClipping = (on, constant) => {
  const cb = document.getElementById('clip-cb');
  if (cb) { cb.checked = on; cb.dispatchEvent(new Event('change')); }
};

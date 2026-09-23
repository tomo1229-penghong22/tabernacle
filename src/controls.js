// controls.js — T1
// オービット(OrbitControls) とウォークモード(PointerLockControls + WASD) の切替。
// 衝突: 地面 + 壁・掛け布（簡易AABB）。入口の幕・垂れ幕(userData.passable=true)は通過可。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 4.5; // m/s
const PLAYER_RADIUS = 0.35;

export function setupControls(camera, renderer, groundHeightAt) {
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 2, 0);
  orbit.minDistance = 2;
  orbit.maxDistance = 250;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.update();

  const pointerLock = new PointerLockControls(camera, renderer.domElement);

  const solidBoxes = []; // 衝突対象 THREE.Box3[]
  let mode = 'orbit'; // 'orbit' | 'walk'

  const keys = { forward: false, back: false, left: false, right: false };
  const velocity = new THREE.Vector3();

  function onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = true; break;
      case 'KeyS': case 'ArrowDown': keys.back = true; break;
      case 'KeyA': case 'ArrowLeft': keys.left = true; break;
      case 'KeyD': case 'ArrowRight': keys.right = true; break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = false; break;
      case 'KeyS': case 'ArrowDown': keys.back = false; break;
      case 'KeyA': case 'ArrowLeft': keys.left = false; break;
      case 'KeyD': case 'ArrowRight': keys.right = false; break;
    }
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  function registerCollider(object3d, { passable = false } = {}) {
    if (passable) return;
    object3d.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object3d);
    if (isFinite(box.min.x)) solidBoxes.push(box);
  }

  // registerColliderBox: 事前計算済みのBox3を直接登録する。
  // 複数オブジェクトをまとめて1つのBox3にすると凹形状(コの字の壁など)の内部まで
  // 塞いでしまうため、壁ごとに個別のBox3を渡したい場合に使う。
  function registerColliderBox(box3) {
    if (box3 && isFinite(box3.min.x)) solidBoxes.push(box3.clone());
  }

  function willCollide(x, z) {
    const px0 = x - PLAYER_RADIUS, px1 = x + PLAYER_RADIUS;
    const pz0 = z - PLAYER_RADIUS, pz1 = z + PLAYER_RADIUS;
    for (const b of solidBoxes) {
      if (px1 > b.min.x && px0 < b.max.x && pz1 > b.min.z && pz0 < b.max.z) {
        return true;
      }
    }
    return false;
  }

  function setMode(next) {
    mode = next;
    if (next === 'walk') {
      orbit.enabled = false;
      const p = camera.position;
      camera.position.set(p.x, groundHeightAt(p.x, p.z) + EYE_HEIGHT, p.z);
      pointerLock.lock();
    } else {
      pointerLock.unlock();
      orbit.enabled = true;
    }
  }

  renderer.domElement.addEventListener('dblclick', () => {
    if (mode === 'walk') setMode('orbit');
  });

  function update(dt) {
    if (mode === 'orbit') {
      orbit.update();
      return;
    }
    const dir = new THREE.Vector3();
    const forwardVec = new THREE.Vector3();
    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0; forwardVec.normalize();
    const rightVec = new THREE.Vector3().crossVectors(forwardVec, camera.up).negate();

    dir.set(0, 0, 0);
    if (keys.forward) dir.add(forwardVec);
    if (keys.back) dir.sub(forwardVec);
    if (keys.right) dir.add(rightVec);
    if (keys.left) dir.sub(rightVec);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(WALK_SPEED * dt);

    const cur = camera.position;
    const nx = cur.x + dir.x;
    const nz = cur.z + dir.z;

    // 軸ごとに分離して衝突判定（簡易スライド）
    let x = cur.x, z = cur.z;
    if (!willCollide(nx, z)) x = nx;
    if (!willCollide(x, nz)) z = nz;

    const h = groundHeightAt(x, z) + EYE_HEIGHT;
    camera.position.set(x, h, z);
  }

  return { orbit, pointerLock, setMode, update, registerCollider, registerColliderBox, getMode: () => mode };
}

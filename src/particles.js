// particles.js — T7(砂塵)・T8(雨粒) パーティクル
import * as THREE from 'three';

const BOUNDS = { x: 70, y: 3, z: 45 }; // パーティクルを配置する範囲(中庭・幕屋を覆う程度)
const DUST_SPEED_THRESHOLD = 8; // m/s 以上で砂塵を表示(PLAN指示)

export function buildDustSystem(scene) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * BOUNDS.x * 2;
    positions[i * 3 + 1] = Math.random() * 2.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * BOUNDS.z * 2;
  }
  const geo = new THREE.BufferGeometry();
  // T16: 毎フレーム更新するバッファは DynamicDrawUsage にする(実GPU/ANGLEで更新時の同期待ちを避ける)
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    color: 0xc8a86a, size: 0.12, transparent: true, opacity: 0.35,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'dustParticles';
  points.visible = false;
  points.frustumCulled = false;
  scene.add(points);

  function update(dt, windSpeed, windDir) {
    const active = windSpeed >= DUST_SPEED_THRESHOLD;
    points.visible = active;
    if (!active) return;
    const pos = geo.attributes.position;
    const vx = windDir.x * windSpeed * 0.35;
    const vz = windDir.z * windSpeed * 0.35;
    for (let i = 0; i < count; i++) {
      let x = pos.getX(i) + vx * dt + (Math.random() - 0.5) * 0.05;
      let y = pos.getY(i) + (Math.random() - 0.5) * 0.02;
      let z = pos.getZ(i) + vz * dt + (Math.random() - 0.5) * 0.05;
      if (x > BOUNDS.x) x -= BOUNDS.x * 2;
      if (x < -BOUNDS.x) x += BOUNDS.x * 2;
      if (z > BOUNDS.z) z -= BOUNDS.z * 2;
      if (z < -BOUNDS.z) z += BOUNDS.z * 2;
      if (y < 0) y = 2.2;
      if (y > 2.2) y = 0;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  return { points, update };
}

export function buildRainSystem(scene) {
  const maxCount = 2200;
  const positions = new Float32Array(maxCount * 2 * 3); // 線分(始点・終点)
  const velocities = new Float32Array(maxCount * 3);
  for (let i = 0; i < maxCount; i++) {
    resetDrop(i, positions, velocities, true);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)); // T16: 毎フレーム更新
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color: 0xaecbe0, transparent: true, opacity: 0.5, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'rainParticles';
  lines.visible = false;
  lines.frustumCulled = false;
  scene.add(lines);

  function resetDrop(i, posArr, velArr, initial = false) {
    const x = (Math.random() - 0.5) * BOUNDS.x * 2;
    const z = (Math.random() - 0.5) * BOUNDS.z * 2;
    const y = initial ? Math.random() * BOUNDS.y * 3 : BOUNDS.y * 3;
    const speed = 9 + Math.random() * 3;
    velArr[i * 3] = 0; velArr[i * 3 + 1] = -speed; velArr[i * 3 + 2] = 0;
    const len = 0.35;
    posArr[i * 6] = x; posArr[i * 6 + 1] = y; posArr[i * 6 + 2] = z;
    posArr[i * 6 + 3] = x; posArr[i * 6 + 4] = y - len; posArr[i * 6 + 5] = z;
  }

  function update(dt, rainAmount, windSpeed, windDir) {
    const active = rainAmount > 0.01;
    lines.visible = active;
    if (!active) return;
    const count = Math.floor(maxCount * rainAmount);
    geo.setDrawRange(0, count * 2);
    const pos = geo.attributes.position.array;
    const tiltX = windDir.x * windSpeed * 0.08;
    const tiltZ = windDir.z * windSpeed * 0.08;
    for (let i = 0; i < count; i++) {
      const vy = velocities[i * 3 + 1];
      const dx = tiltX * dt, dz = tiltZ * dt, dy = vy * dt;
      pos[i * 6] += dx; pos[i * 6 + 1] += dy; pos[i * 6 + 2] += dz;
      pos[i * 6 + 3] += dx; pos[i * 6 + 4] += dy; pos[i * 6 + 5] += dz;
      if (pos[i * 6 + 1] < 0) resetDrop(i, pos, velocities);
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { lines, update };
}

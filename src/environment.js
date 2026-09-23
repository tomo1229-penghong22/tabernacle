// environment.js — T1
// 地形（乾燥した砂・礫の荒野）、遠景の山影、疎らな低木、空(Sky)、太陽光＋影、昼夜サイクル。

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { getMaterial } from './materials.js';
import { MATERIALS } from './dimensions.js';

const GROUND_SIZE = 400; // m（中庭±22mの外側まで十分に覆う）

export function buildEnvironment(scene) {
  const group = new THREE.Group();
  group.name = 'environment';

  // --- 地形 -----------------------------------------------------------
  const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 128, 128);
  groundGeo.rotateX(-Math.PI / 2);
  // ざっくりした起伏（乾いた荒野の凹凸）
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const d = Math.sqrt(x * x + z * z);
    let h = Math.sin(x * 0.04) * Math.cos(z * 0.05) * 0.4 + Math.sin(x * 0.13 + z * 0.09) * 0.15;
    // 中庭周辺(半径35m以内)は平坦に近づける
    const flatten = Math.min(1, Math.max(0, (d - 30) / 40));
    h *= flatten;
    posAttr.setY(i, h);
  }
  groundGeo.computeVertexNormals();
  const groundMat = getMaterial(MATERIALS.SAND);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // 地形の高さ取得関数（衝突・カメラ用）。頂点補間はせず簡易近似。
  const groundHeightAt = (x, z) => {
    const d = Math.sqrt(x * x + z * z);
    let h = Math.sin(x * 0.04) * Math.cos(z * 0.05) * 0.4 + Math.sin(x * 0.13 + z * 0.09) * 0.15;
    const flatten = Math.min(1, Math.max(0, (d - 30) / 40));
    return h * flatten;
  };

  // --- 遠景の山影 -------------------------------------------------------
  const mountainGroup = new THREE.Group();
  mountainGroup.name = 'mountains';
  const mountainMat = getMaterial(MATERIALS.MOUNTAIN);
  const ringCount = 14;
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2;
    const dist = 140 + Math.random() * 40;
    const h = 18 + Math.random() * 22;
    const w = 40 + Math.random() * 30;
    const geo = new THREE.ConeGeometry(w, h, 5 + Math.floor(Math.random() * 3));
    const mesh = new THREE.Mesh(geo, mountainMat);
    mesh.position.set(Math.cos(angle) * dist, h / 2 - 3, Math.sin(angle) * dist);
    mesh.rotation.y = Math.random() * Math.PI;
    mountainGroup.add(mesh);
  }
  group.add(mountainGroup);

  // --- 疎らな低木 --------------------------------------------------------
  const shrubGroup = new THREE.Group();
  shrubGroup.name = 'shrubs';
  const shrubMat = getMaterial(MATERIALS.SHRUB);
  const shrubGeo = new THREE.IcosahedronGeometry(0.35, 0);
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 100;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const mesh = new THREE.Mesh(shrubGeo, shrubMat);
    const s = 0.5 + Math.random() * 1.2;
    mesh.scale.set(s, s * (0.6 + Math.random() * 0.5), s);
    mesh.position.set(x, groundHeightAt(x, z) + 0.2 * s, z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = true;
    shrubGroup.add(mesh);
  }
  group.add(shrubGroup);

  scene.add(group);

  // --- 空 (Sky) -----------------------------------------------------------
  const sky = new Sky();
  sky.scale.setScalar(4000); // カメラfar plane(main.js)との整合を考慮したスケール
  scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 3;
  skyUniforms['rayleigh'].value = 1.2;
  skyUniforms['mieCoefficient'].value = 0.006;
  skyUniforms['mieDirectionalG'].value = 0.8;

  // --- 太陽光＋影 ----------------------------------------------------------
  const isAutomated = window.__IS_AUTOMATED__ === true;
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(isAutomated ? 256 : 2048, isAutomated ? 256 : 2048);
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 300;
  sunLight.shadow.bias = -0.0015;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const ambient = new THREE.HemisphereLight(0xbfd6ff, 0x8a7250, 0.55);
  scene.add(ambient);

  // 幕屋内部(聖所・至聖所)は太陽光が直接届かず、HemisphereLightだけでは暗くなりすぎて
  // 調度品が視認しづらいため、ごく弱いフラットな補助光を常時追加する
  // (史実の暗さの厳密な再現よりも、ビューア上での視認性を優先した実装上の判断)。
  const interiorFill = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(interiorFill);

  const sunVec = new THREE.Vector3();

  // 昼夜の時刻(0-24h)を反映する。
  function setTimeOfDay(hour) {
    const theta = (hour / 24) * Math.PI * 2 - Math.PI / 2; // 6時=日の出付近を0radにする
    const elevation = Math.sin(theta);
    const azimuth = Math.PI * 0.35;
    const phi = THREE.MathUtils.degToRad(90 - elevation * 90);
    const theta2 = THREE.MathUtils.degToRad(azimuth * 180 / Math.PI);
    sunVec.setFromSphericalCoords(1, phi, theta2);
    skyUniforms['sunPosition'].value.copy(sunVec);

    const sunHeight = Math.max(0.02, elevation);
    sunLight.position.copy(sunVec).multiplyScalar(150);
    sunLight.target.position.set(0, 0, 0);
    sunLight.intensity = THREE.MathUtils.clamp(sunHeight * 3.2, 0.05, 3.2);
    const isNight = elevation < 0.02;
    ambient.intensity = isNight ? 0.12 : 0.35 + sunHeight * 0.3;
    const dayColor = new THREE.Color(0xfff3d6);
    const nightColor = new THREE.Color(0x1b2a4a);
    scene.background = null; // Sky が描画するため背景色は使わない
    ambient.color.copy(isNight ? new THREE.Color(0x8fa6ff) : new THREE.Color(0xbfd6ff));
    scene.fog && scene.fog.color.lerpColors(nightColor, dayColor, THREE.MathUtils.clamp(sunHeight * 2, 0, 1));
  }

  scene.fog = new THREE.Fog(0xd9c9a3, 60, 260);
  setTimeOfDay(12);

  return { groundHeightAt, setTimeOfDay, sunLight, GROUND_SIZE };
}

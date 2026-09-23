// ui.js — T9（日本語UI）
// 覆い4層の個別表示切替、断面(クリッピング平面)表示、部材クリックで解説パネル、
// 視点プリセット(全景・入口・聖所内・至聖所内)。時刻スライダー・視点モード切替(T1)もここで配線する。

import * as THREE from 'three';

// 座標はすべてメートル(dimensions.jsのcub()変換後)。幕屋: 入口x=0, 垂れ幕x=-8.9, 背面x=-13.35。
// 聖所内 x∈(-8.9,0)、至聖所内 x∈(-13.35,-8.9)。(以前のバージョンはキュビト値を誤ってメートルとして
// 使用しており、聖所内/至聖所内プリセットが構造の外側や壁の内側めり込み位置になっていたため修正)
const PRESETS = {
  overview: { pos: [10, 26, 50], target: [-6, 2, 0], label: '全景' },
  entrance: { pos: [18, 2.2, 0], target: [0, 1.8, 0], label: '入口' },
  holyPlace: { pos: [-2.5, 1.8, 1.2], target: [-7.5, 1.3, -0.5], label: '聖所内' },
  mostHoly: { pos: [-9.6, 1.8, 1.6], target: [-11.1, 1.1, 0], label: '至聖所内' },
  // R4: 北側(机の側, z<0)から燭台(z>0側)の正面を写す確認用の近接プリセット
  lampstandFront: { pos: [-6.675, 1.5, -1.8], target: [-6.675, 0.9, 1.5575], label: '燭台正面' },
};

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}

export function setupUI(ctx) {
  const { camera, renderer, controls, environment, tabernacle } = ctx;

  const panel = el('div', {
    id: 'ui-panel',
    style: {
      position: 'fixed', top: '10px', left: '10px', width: '280px',
      background: 'rgba(20,16,10,0.82)', color: '#f0e6d2', padding: '12px 14px',
      fontFamily: 'sans-serif', fontSize: '13px', borderRadius: '8px', zIndex: 1000,
      lineHeight: '1.6', maxHeight: '95vh', overflowY: 'auto',
    },
  });
  document.body.appendChild(panel);

  panel.appendChild(el('h2', { style: { fontSize: '15px', margin: '0 0 8px' } }, ['幕屋モデル 操作パネル']));

  // --- 視点モード ---------------------------------------------------------
  const modeBtn = el('button', { style: btnStyle() }, ['視点モード: オービット']);
  modeBtn.addEventListener('click', () => {
    const next = controls.getMode() === 'orbit' ? 'walk' : 'orbit';
    controls.setMode(next);
    modeBtn.textContent = `視点モード: ${next === 'orbit' ? 'オービット' : 'ウォーク(WASD+マウス / ダブルクリックで解除)'}`;
  });
  panel.appendChild(row('操作', [modeBtn]));

  // --- 視点プリセット -------------------------------------------------------
  const presetRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
  Object.entries(PRESETS).forEach(([key, p]) => {
    const b = el('button', { style: btnStyle(true) }, [p.label]);
    b.addEventListener('click', () => applyPreset(p));
    presetRow.appendChild(b);
  });
  panel.appendChild(row('視点プリセット', [presetRow]));

  function applyPreset(p) {
    camera.position.set(...p.pos);
    if (controls.getMode() === 'orbit') {
      controls.orbit.target.set(...p.target);
      controls.orbit.update();
    } else {
      camera.lookAt(...p.target);
    }
  }

  // --- 時刻スライダー -------------------------------------------------------
  const timeLabel = el('span', {}, ['12:00']);
  const timeSlider = el('input', { type: 'range', min: '0', max: '24', step: '0.1', value: '12', style: { width: '100%' } });
  timeSlider.addEventListener('input', () => {
    const hour = parseFloat(timeSlider.value);
    environment.setTimeOfDay(hour);
    const h = Math.floor(hour).toString().padStart(2, '0');
    const m = Math.round((hour % 1) * 60).toString().padStart(2, '0');
    timeLabel.textContent = `${h}:${m}`;
  });
  panel.appendChild(row('時刻(0-24h)', [timeSlider, timeLabel]));

  // --- 覆い4層 個別表示切替 ---------------------------------------------------
  const layerRow = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
  const layerDefs = [
    ['innerLinen', '内側の布（ケルブ刺しゅう）'],
    ['goatHair', 'ヤギ毛の天幕'],
    ['ramSkins', '赤い雄羊の皮'],
    ['sealSkins', 'アザラシの皮'],
  ];
  layerDefs.forEach(([key, label]) => {
    const cb = el('input', { type: 'checkbox', checked: 'checked' });
    cb.checked = true;
    cb.addEventListener('change', () => {
      tabernacle.roofLayers[key].visible = cb.checked;
    });
    const id = `layer-${key}`;
    cb.id = id;
    const lbl = el('label', { for: id, style: { cursor: 'pointer' } }, [' ' + label]);
    layerRow.appendChild(el('div', {}, [cb, lbl]));
  });
  panel.appendChild(row('屋根の覆い(4層)', [layerRow]));

  // --- 断面(クリッピング)表示 -----------------------------------------------
  // 南側(z>constant側)を切り取り、幕屋の長さ方向の断面(至聖所〜聖所〜入口)を見せる。
  renderer.localClippingEnabled = true;
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // z > constant側を切り取る
  const clipCb = el('input', { type: 'checkbox' });
  clipCb.addEventListener('change', () => {
    renderer.clippingPlanes = clipCb.checked ? [clipPlane] : [];
  });
  const clipSlider = el('input', { type: 'range', min: '-15', max: '15', step: '0.5', value: '0', style: { width: '100%' } });
  clipSlider.addEventListener('input', () => {
    clipPlane.constant = parseFloat(clipSlider.value);
  });
  const clipId = 'clip-cb';
  clipCb.id = clipId;
  panel.appendChild(row('断面表示', [
    el('div', {}, [clipCb, el('label', { for: clipId }, [' 有効にする（南北方向でカット）'])]),
    clipSlider,
  ]));

  // --- 解説パネル -----------------------------------------------------------
  const info = el('div', {
    id: 'info-panel',
    style: {
      position: 'fixed', bottom: '10px', left: '10px', width: '320px',
      background: 'rgba(20,16,10,0.88)', color: '#f0e6d2', padding: '10px 14px',
      fontFamily: 'sans-serif', fontSize: '13px', borderRadius: '8px', zIndex: 1000,
      display: 'none', lineHeight: '1.7',
    },
  });
  document.body.appendChild(info);

  function showInfo(data) {
    if (!data) { info.style.display = 'none'; return; }
    info.innerHTML = '';
    info.appendChild(el('h3', { style: { margin: '0 0 6px', fontSize: '14px' } }, [data.nameJa || '(不明)']));
    if (data.dims) info.appendChild(el('div', {}, [`寸法: ${data.dims}`]));
    if (data.material) info.appendChild(el('div', {}, [`材料: ${data.material}`]));
    if (data.source) info.appendChild(el('div', {}, [`出典: ${data.source}`]));
    if (data.note) info.appendChild(el('div', { style: { color: '#e0a060', marginTop: '4px' } }, [`注記: ${data.note}`]));
    info.style.display = 'block';
  }

  return { showInfo, PRESETS, applyPreset };
}

function row(labelText, children) {
  const wrap = el('div', { style: { margin: '8px 0' } });
  wrap.appendChild(el('div', { style: { fontSize: '11px', opacity: '0.75', marginBottom: '3px' } }, [labelText]));
  children.forEach((c) => wrap.appendChild(c));
  return wrap;
}

function btnStyle(small = false) {
  return {
    background: '#4a3a24', color: '#f0e6d2', border: '1px solid #8a6a3a',
    borderRadius: '4px', padding: small ? '4px 8px' : '6px 10px', cursor: 'pointer',
    fontSize: small ? '11px' : '12px',
  };
}

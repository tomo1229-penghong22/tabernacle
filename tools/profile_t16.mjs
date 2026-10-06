// tools/profile_t16.mjs
//
// T16(issue #2: 実機FPSが30fpsに届かない)の調査・前後比較用スクリプト。判定(pass/fail)は行わない。
// 実測値だけを log/t16_profile.json に追記する。
//
// ブラウザは「実GPU(ANGLE D3D11)」で起動する(--use-angle=d3d11)。この機材では Intel UHD 620 になる。
// ヘッドレスのフレーム時間は参考値(合否には使わない)。renderer.info 等の決定的な指標が主。
//
// main.js はコミットごとに変わらない部分があるため、配信時に main.js の末尾へ検査用フックを追記する
// (作業ツリーのファイルは書き換えない)。フックは window.__t16 に scene/camera/renderer 等を出す。
//
// 使い方:
//   node tools/profile_t16.mjs --mode=commits                 # 各コミットを git worktree で測る(既定コミット列)
//   node tools/profile_t16.mjs --mode=bench --label=after     # 作業ツリーを測る(label でJSONに保存)
//   node tools/profile_t16.mjs --mode=breakdown --label=head  # 作業ツリーで要素別コスト内訳
//   node tools/profile_t16.mjs --mode=shots --label=before    # 全景/聖所内のスクリーンショット(決定的)
//   node tools/profile_t16.mjs --mode=diff --a=before --b=after
//   オプション: --frames=90  --w=1920 --h=1080  --gpu=d3d11|swiftshader  --shotsRoot=<dir>(shots用に別ルートを配信)
//
// 出力: log/t16_profile.json(label別にマージ)、log/t16_shots/<label>_<preset>_<weather>.png

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
const SHOT_DIR = path.join(LOG_DIR, 't16_shots');
const PROFILE_JSON = path.join(LOG_DIR, 't16_profile.json');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) args[m[1]] = m[2];
}
const MODE = args.mode || 'bench';
const FRAMES = parseInt(args.frames || '90', 10);
const W = parseInt(args.w || '1920', 10);
const H = parseInt(args.h || '1080', 10);
const GPU = args.gpu || 'd3d11';
const COMMITS = ['b776f76', '666addd', '2675425', '26dc3e9', '7618e05', '7408fff'];

const LAUNCH_ARGS = GPU === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox']
  : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--no-sandbox'];

// ---- 静的サーバー(main.js にフックを追記して配信) --------------------------
const HOOK = `
;window.__t16 = {
  THREE, scene, camera, renderer, setWind, setRainAmount, ENV_UNIFORMS,
  controls: () => controls, presets: () => ui.PRESETS, applyPreset: (k) => ui.applyPreset(ui.PRESETS[k]),
};
`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
function startServer(root0, { patch = (s) => s } = {}) {
  const root = path.resolve(root0);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(f);
    if (p === '/src/main.js') body = Buffer.from(patch(body.toString('utf8')) + HOOK);
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// ---- ページ内ヘルパー(page.evaluate に文字列で渡す) ---------------------------
const INIT_SCRIPT = `
(() => {
  // 決定的な乱数(山・低木の配置を固定)
  let s = 123456789;
  Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // rAF の一時停止(スクリーンショットを決定的にするため)
  const raf = window.requestAnimationFrame.bind(window);
  window.__held = []; window.__rafHold = false;
  window.requestAnimationFrame = (cb) => {
    if (window.__rafHold) { window.__held.push(cb); return 0; }
    return raf(cb);
  };
  window.__rafRelease = () => { window.__rafHold = false; const q = window.__held; window.__held = []; q.forEach((cb) => raf(cb)); };
})();
`;

const PAGE_FN = `
window.__prof = (() => {
  const T = () => window.__t16;
  const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
  const stats = (arr) => ({ n: arr.length, avgMs: arr.reduce((a, b) => a + b, 0) / arr.length, p95Ms: pct(arr, 0.95), p50Ms: pct(arr, 0.5), maxMs: Math.max(...arr), fpsAvg: 1000 / (arr.reduce((a, b) => a + b, 0) / arr.length) });

  function materialsOf(scene) {
    const mats = new Set();
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)); });
    return [...mats];
  }
  const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap', 'emissiveMap', 'alphaMap', 'envMap', 'displacementMap'];
  function textureList(scene) {
    const seen = new Map();
    const add = (t, owner, key) => {
      if (!t) return;
      const img = t.image || (t.source && t.source.data);
      const w = img ? (img.width || img.videoWidth || 0) : 0, h = img ? (img.height || img.videoHeight || 0) : 0;
      let e = seen.get(t.uuid);
      if (!e) { e = { name: t.name || '', ctor: t.constructor.name, w, h, minFilter: t.minFilter, anisotropy: t.anisotropy, mipmaps: t.generateMipmaps, users: [] }; seen.set(t.uuid, e); }
      e.users.push(owner + '.' + key);
    };
    materialsOf(scene).forEach((m) => TEX_KEYS.forEach((k) => add(m[k], m.name || m.type, k)));
    add(scene.environment, 'scene', 'environment');
    return [...seen.values()];
  }
  function shadowInfo(scene) {
    let casters = 0, castTris = 0, instCasters = 0, receivers = 0, meshes = 0, castersVisible = 0;
    const lights = [];
    scene.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.receiveShadow) receivers++;
        if (o.castShadow) {
          casters++;
          if (o.visible) castersVisible++;
          const g = o.geometry;
          const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
          castTris += tris * (o.isInstancedMesh ? o.count : 1);
          if (o.isInstancedMesh) instCasters++;
        }
      }
      if (o.isLight) lights.push({ type: o.type, castShadow: !!o.castShadow, mapSize: o.shadow ? [o.shadow.mapSize.x, o.shadow.mapSize.y] : null, intensity: o.intensity });
    });
    return { meshes, receivers, casters, castersVisible, instancedCasters: instCasters, casterTrianglesUpperBound: Math.round(castTris), lights };
  }
  function infoNow() {
    const { renderer, scene, camera } = T();
    renderer.render(scene, camera);
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, lines: i.render.lines, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs ? i.programs.length : null };
  }
  function syncTime(n, warm = 8) {
    const { renderer, scene, camera } = T();
    const gl = renderer.getContext(); const px = new Uint8Array(4);
    for (let i = 0; i < warm; i++) { renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    const ts = [], cpu = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); renderer.render(scene, camera); const t1 = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); cpu.push(t1 - t0); }
    const st = stats(ts); st.cpuSubmitAvgMs = cpu.reduce((a, b) => a + b, 0) / cpu.length; return st;
  }
  function rafTime(n) {
    return new Promise((resolve) => {
      const ts = []; let last = performance.now(); let k = 0;
      const step = (now) => { if (k > 5) ts.push(now - last); last = now; k++; if (ts.length >= n) resolve(stats(ts)); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function setScenario(preset, weather) {
    const t = T();
    t.applyPreset(preset);
    if (weather === 'strong') { t.setWind(15, 292.5); t.setRainAmount(1.0); } else { t.setWind(0, 292.5); t.setRainAmount(0); }
  }
  function particles() {
    const out = []; T().scene.traverse((o) => { if (o.isPoints || o.isLine) out.push(o); }); return out;
  }
  function recompile() { materialsOf(T().scene).forEach((m) => { m.needsUpdate = true; }); }
  return { T, materialsOf, textureList, shadowInfo, infoNow, syncTime, rafTime, setScenario, particles, recompile };
})();
`;

async function openPage(browser, url, { w = W, h = H, dsf = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  try { await page.waitForFunction(() => window.__t16, null, { timeout: 60000 }); } catch (e) { console.error('page errors:', errors.slice(0, 5)); throw e; }
  await page.evaluate(PAGE_FN);
  await page.waitForTimeout(2500);
  return { page, ctx, errors };
}

const SCENARIOS = [
  ['overview', 'default'], ['overview', 'strong'], ['holyPlace', 'default'], ['holyPlace', 'strong'],
];

async function measureScenarios(page, { frames = FRAMES, withRaf = true } = {}) {
  const out = {};
  for (const [preset, weather] of SCENARIOS) {
    await page.evaluate(([p, w]) => window.__prof.setScenario(p, w), [preset, weather]);
    await page.waitForTimeout(weather === 'strong' ? 4000 : 800); // 濡れ・揺れ・パーティクル定常化
    const info = await page.evaluate(() => window.__prof.infoNow());
    const sync = await page.evaluate((n) => window.__prof.syncTime(n), frames);
    const raf = withRaf ? await page.evaluate((n) => window.__prof.rafTime(n), frames) : null;
    out[`${preset}/${weather}`] = { info, renderSyncMs: sync, rafMs: raf };
  }
  return out;
}

async function staticMetrics(page) {
  return page.evaluate(() => {
    const P = window.__prof; const { scene, renderer } = P.T();
    const tex = P.textureList(scene);
    const byRes = {};
    tex.forEach((t) => { const k = t.w + 'x' + t.h; byRes[k] = (byRes[k] || 0) + 1; });
    const texMiB = tex.reduce((a, t) => a + (t.w * t.h * 4 * (t.mipmaps ? 1.333 : 1)) / 1048576, 0);
    const mats = P.materialsOf(scene);
    return {
      shadow: P.shadowInfo(scene),
      materials: mats.length,
      textures: tex.map((t) => ({ name: t.name, ctor: t.ctor, size: t.w + 'x' + t.h, users: [...new Set(t.users)].slice(0, 6), usersCount: t.users.length })),
      textureCountByResolution: byRes,
      textureMiBApprox: Math.round(texMiB * 10) / 10,
      pixelRatio: renderer.getPixelRatio(),
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
      shadowMapType: renderer.shadowMap.type,
      gl: (() => { const g = renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })(),
    };
  });
}

function loadJson() { return fs.existsSync(PROFILE_JSON) ? JSON.parse(fs.readFileSync(PROFILE_JSON, 'utf8')) : {}; }
function saveJson(key, val) {
  const j = loadJson();
  j[key] = val;
  j._meta = { updatedAt: new Date().toISOString(), gpu: GPU, viewport: [W, H], frames: FRAMES, note: 'frame times are reference only (headless Chrome, this machine GPU), not used for pass/fail' };
  fs.writeFileSync(PROFILE_JSON, JSON.stringify(j, null, 2));
}

async function runBench(root, label, { patch } = {}) {
  const { server, port } = await startServer(root, { patch });
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const { page, errors } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
    const st = await staticMetrics(page);
    const sc = await measureScenarios(page);
    const res = { static: st, scenarios: sc, errors };
    saveJson(label, res);
    console.log(label, JSON.stringify(Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, { calls: v.info.calls, tris: v.info.triangles, syncAvg: +v.renderSyncMs.avgMs.toFixed(1), syncP95: +v.renderSyncMs.p95Ms.toFixed(1), rafAvg: +v.rafMs.avgMs.toFixed(1) }]))));
    return res;
  } finally { await browser.close(); server.close(); }
}

// ---- コスト内訳(作業ツリー、全景/聖所内 x 既定/強風) ---------------------------
const VARIANTS = {
  baseline: { apply: () => {}, revert: () => {} },
  noShadowCasting: {
    apply: () => { const { scene, renderer } = window.__t16; renderer.shadowMap.enabled = false; window.__prof.recompile(); },
    revert: () => { window.__t16.renderer.shadowMap.enabled = true; window.__prof.recompile(); },
  },
  shadowBasicType: {
    apply: () => { const { THREE, renderer } = window.__t16; window.__old = renderer.shadowMap.type; renderer.shadowMap.type = THREE.BasicShadowMap; window.__prof.recompile(); },
    revert: () => { window.__t16.renderer.shadowMap.type = window.__old; window.__prof.recompile(); },
  },
  shadowMap1024: {
    apply: () => { const { scene } = window.__t16; scene.traverse((o) => { if (o.isLight && o.shadow) { window.__sm = o.shadow.mapSize.x; o.shadow.mapSize.set(1024, 1024); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); },
    revert: () => { const { scene } = window.__t16; scene.traverse((o) => { if (o.isLight && o.shadow) { o.shadow.mapSize.set(window.__sm, window.__sm); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); },
  },
  noEnvironmentMap: {
    apply: () => { const { scene } = window.__t16; window.__env = scene.environment; scene.environment = null; window.__prof.recompile(); },
    revert: () => { window.__t16.scene.environment = window.__env; window.__prof.recompile(); },
  },
  noParticles: {
    apply: () => { window.__pv = window.__prof.particles().map((o) => [o, o.visible]); window.__noPart = true; window.__prof.particles().forEach((o) => { o.visible = false; o.__realVisible = false; }); },
    revert: () => { window.__noPart = false; },
  },
  noNormalRoughnessMaps: {
    apply: () => { window.__tm = []; window.__prof.materialsOf(window.__t16.scene).forEach((m) => { window.__tm.push([m, m.normalMap, m.roughnessMap, m.bumpMap]); m.normalMap = null; m.roughnessMap = null; m.bumpMap = null; m.needsUpdate = true; }); },
    revert: () => { window.__tm.forEach(([m, n, r, b]) => { m.normalMap = n; m.roughnessMap = r; m.bumpMap = b; m.needsUpdate = true; }); },
  },
  shadowMapStaticOnly: { // 影マップを初回のみ更新(autoUpdate=false)。静的シーンで毎フレーム影パスを省いた場合の上限値
    apply: () => { const { renderer } = window.__t16; renderer.shadowMap.needsUpdate = true; renderer.shadowMap.autoUpdate = false; },
    revert: () => { window.__t16.renderer.shadowMap.autoUpdate = true; },
  },
  groundNoShadowReceive: {
    apply: () => { const g = window.__t16.scene.getObjectByName('ground'); g.receiveShadow = false; g.material.needsUpdate = true; },
    revert: () => { const g = window.__t16.scene.getObjectByName('ground'); g.receiveShadow = true; g.material.needsUpdate = true; },
  },
  groundNoEnvMap: {
    apply: () => { const g = window.__t16.scene.getObjectByName('ground'); g.material.envMapIntensity = 0; },
    revert: () => { const g = window.__t16.scene.getObjectByName('ground'); g.material.envMapIntensity = 1; },
  },
  groundBasicMaterial: {
    apply: () => { const { THREE } = window.__t16; const g = window.__t16.scene.getObjectByName('ground'); window.__gm = g.material; g.material = new THREE.MeshBasicMaterial({ map: window.__gm.map }); },
    revert: () => { window.__t16.scene.getObjectByName('ground').material = window.__gm; },
  },
  noFog: {
    apply: () => { const { scene } = window.__t16; window.__fog = scene.fog; scene.fog = null; window.__prof.recompile(); },
    revert: () => { window.__t16.scene.fog = window.__fog; window.__prof.recompile(); },
  },
  casterSmallOff: { // 影を落とすメッシュのうち外形(バウンディングボックス対角)0.5m未満を除外
    apply: () => { const { THREE, scene } = window.__t16; window.__cs = []; const b = new THREE.Box3(), v = new THREE.Vector3(); scene.traverse((o) => { if (o.isMesh && o.castShadow) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox); b.getSize(v); const d = v.length() * Math.max(o.scale.x, o.scale.y, o.scale.z); if (d < 0.5) { window.__cs.push(o); o.castShadow = false; } } }); window.__vnote = { removed: window.__cs.length }; },
    revert: () => { window.__cs.forEach((o) => { o.castShadow = true; }); },
  },
  casterEnvOff: { // environment グループ(地形・山・低木)の影落としを除外
    apply: () => { const e = window.__t16.scene.getObjectByName('environment'); window.__ce = []; e.traverse((o) => { if (o.isMesh && o.castShadow) { window.__ce.push(o); o.castShadow = false; } }); window.__vnote = { removed: window.__ce.length }; },
    revert: () => { window.__ce.forEach((o) => { o.castShadow = true; }); },
  },
  antialiasNote: { apply: () => {}, revert: () => {} },
  sheenOff: { // 布のシーン(sheen)を無効化(MeshPhysicalMaterial の sheen=0)
    apply: () => { window.__sh = []; window.__prof.materialsOf(window.__t16.scene).forEach((m) => { if (m.isMeshPhysicalMaterial && m.sheen > 0) { window.__sh.push([m, m.sheen]); m.sheen = 0; m.needsUpdate = true; } }); window.__vnote = { materials: window.__sh.length }; },
    revert: () => { window.__sh.forEach(([m, v]) => { m.sheen = v; m.needsUpdate = true; }); },
  },
  pointLights3of7: { // 点光源7つのうち4つを無効化(残り3つ)
    apply: () => { window.__pl = []; window.__t16.scene.traverse((o) => { if (o.isPointLight) window.__pl.push(o); }); window.__pl.slice(3).forEach((l) => { l.visible = false; }); window.__prof.recompile(); window.__vnote = { total: window.__pl.length }; },
    revert: () => { window.__pl.forEach((l) => { l.visible = true; }); window.__prof.recompile(); },
  },
  pixelRatio1_5: { apply: () => window.__t16.renderer.setPixelRatio(1.5), revert: () => window.__t16.renderer.setPixelRatio(1) },
  pixelRatio2: { apply: () => window.__t16.renderer.setPixelRatio(2), revert: () => window.__t16.renderer.setPixelRatio(1) },
  pixelRatio0_75: { apply: () => window.__t16.renderer.setPixelRatio(0.75), revert: () => window.__t16.renderer.setPixelRatio(1) },
};
// 非表示にして差を見るグループ(シーン直下の子の name / 型で指定)
const HIDE_GROUPS = ['sky', 'ground', 'mountains', 'shrubs', 'courtyard', 'tabernacle', 'furniture', 'frames', 'roof'];

async function runBreakdown(root, label) {
  const { server, port } = await startServer(root);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const result = { variants: {}, hideGroups: {}, sceneTopLevel: null };
  const only = args.variants ? args.variants.split(',') : null;
  try {
    const { page } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
    // 変種の関数をページに注入
    await page.evaluate((src) => { window.__variants = eval('(' + src + ')'); }, `{${Object.entries(VARIANTS).map(([k, v]) => `${JSON.stringify(k)}: { apply: ${v.apply.toString()}, revert: ${v.revert.toString()} }`).join(',')}}`);
    result.sceneTopLevel = await page.evaluate(() => window.__t16.scene.children.map((c) => ({ type: c.type, name: c.name, children: c.children.length })));
    // パーティクルは強風時だけ表示される。noParticles は update ループが visible を戻すので毎フレーム隠すフラグを置く
    await page.evaluate(() => {
      const orig = window.__t16.renderer.render.bind(window.__t16.renderer);
      window.__t16.renderer.render = (s, c) => { if (window.__noPart) window.__prof.particles().forEach((o) => { o.visible = false; }); orig(s, c); };
    });
    for (const [vname] of Object.entries(VARIANTS)) {
      if (only && !only.includes(vname)) continue;
      result.variants[vname] = {};
      for (const [preset, weather] of SCENARIOS) {
        if (vname === 'noParticles' && weather === 'default') continue;
        await page.evaluate(([p, w]) => window.__prof.setScenario(p, w), [preset, weather]);
        await page.waitForTimeout(weather === 'strong' ? 3000 : 500);
        await page.evaluate((v) => window.__variants[v].apply(), vname);
        await page.waitForTimeout(300);
        const info = await page.evaluate(() => window.__prof.infoNow());
        const sync = await page.evaluate((n) => window.__prof.syncTime(n), Math.max(30, Math.floor(FRAMES / 2)));
        await page.evaluate((v) => window.__variants[v].revert(), vname);
        const note = await page.evaluate(() => { const n = window.__vnote; window.__vnote = null; return n; });
        result.variants[vname][`${preset}/${weather}`] = { info, renderSyncMs: sync, note };
        console.log(vname, preset, weather, 'calls', info.calls, 'tris', info.triangles, 'avg', sync.avgMs.toFixed(1), 'p95', sync.p95Ms.toFixed(1));
      }
    }
    // グループ非表示(既定天候のみ)
    const tops = only ? [] : await page.evaluate(() => window.__t16.scene.children.map((c, i) => [i, c.type, c.name]));
    for (const [i, type, name] of tops) {
      if (type.includes('Light') || type === 'Object3D') continue;
      result.hideGroups[`${i}:${type}:${name}`] = {};
      for (const [preset, weather] of SCENARIOS.filter(([, w]) => w === 'default')) {
        await page.evaluate(([p, w]) => window.__prof.setScenario(p, w), [preset, weather]);
        await page.waitForTimeout(300);
        await page.evaluate((idx) => { const c = window.__t16.scene.children[idx]; window.__hv = c.visible; c.visible = false; }, i);
        const info = await page.evaluate(() => window.__prof.infoNow());
        const sync = await page.evaluate((n) => window.__prof.syncTime(n), 30);
        await page.evaluate((idx) => { window.__t16.scene.children[idx].visible = window.__hv; }, i);
        result.hideGroups[`${i}:${type}:${name}`][`${preset}/${weather}`] = { calls: info.calls, triangles: info.triangles, avgMs: sync.avgMs, p95Ms: sync.p95Ms };
        console.log('hide', name || type, preset, 'calls', info.calls, 'avg', sync.avgMs.toFixed(1));
      }
    }
  } finally { await browser.close(); server.close(); }
  // アンチエイリアス無効(別コンテキストが必要なので main.js をパッチして測る)
  if (!only) { const aa = await runBenchPatched(root, (s) => s.replace('antialias: !isAutomated', 'antialias: false')); result.antialiasOff = aa; }
  saveJson(label, result);
  return result;
}
async function runBenchPatched(root, patch) {
  const { server, port } = await startServer(root, { patch });
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const { page } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
    const out = {};
    for (const [preset, weather] of SCENARIOS) {
      await page.evaluate(([p, w]) => window.__prof.setScenario(p, w), [preset, weather]);
      await page.waitForTimeout(weather === 'strong' ? 3000 : 500);
      const sync = await page.evaluate((n) => window.__prof.syncTime(n), 45);
      out[`${preset}/${weather}`] = { avgMs: sync.avgMs, p95Ms: sync.p95Ms };
      console.log('AA off', preset, weather, sync.avgMs.toFixed(1));
    }
    return out;
  } finally { await browser.close(); server.close(); }
}

// ---- 第2階層(シーン直下グループの子ごと)の非表示コスト。子が16個以下のグループだけ個別に隠す ----
async function runBreakdown2(root, label) {
  const { server, port } = await startServer(root);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const result = {};
  try {
    const { page } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
    const tops = await page.evaluate(() => window.__t16.scene.children.map((c, i) => [i, c.type, c.name, c.children.map((d) => d.name || d.type)]));
    for (const preset of ['overview', 'holyPlace']) {
      await page.evaluate((p) => window.__prof.setScenario(p, 'default'), preset);
      await page.waitForTimeout(500);
      for (const [i, type, name, kids] of tops) {
        if (!['environment', 'courtyard', 'tabernacle', 'furniture'].includes(name) && type !== 'Mesh') continue;
        const targets = (kids.length && kids.length <= 16) ? kids.map((_, k) => [i, k]) : [[i, -1]];
        for (const [gi, ki] of targets) {
          const r = await page.evaluate(([gi, ki, n]) => {
            const rt = window.__t16.scene.children[gi];
            const o = ki < 0 ? rt : rt.children[ki];
            const v = o.visible; o.visible = false;
            const info = window.__prof.infoNow();
            const t = window.__prof.syncTime(n, 4);
            o.visible = v;
            return { label: (rt.name || rt.type) + '/' + (o.name || o.type) + '#' + ki, calls: info.calls, tris: info.triangles, avgMs: t.avgMs };
          }, [gi, ki, 25]);
          result[preset + ':' + r.label] = r;
          console.log(preset, r.label, 'calls', r.calls, 'tris', r.tris, 'avg', r.avgMs.toFixed(1));
        }
      }
    }
  } finally { await browser.close(); server.close(); }
  saveJson(label, result);
}

// ---- A/B 交互計測(GPUクロック変動の影響を抑えるため、2つのルートを交互に測る) ------------
async function runAB(rootA, rootB, label, rounds = 5, frames = 30) {
  const sa = await startServer(rootA), sb = await startServer(rootB);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const out = { rootA, rootB, rounds, frames, scenarios: {} };
  try {
    const A = await openPage(browser, `http://127.0.0.1:${sa.port}/index.html?quality=full`);
    const B = await openPage(browser, `http://127.0.0.1:${sb.port}/index.html?quality=full`);
    for (const P of [A, B]) await P.page.evaluate(() => { window.__rafHold = true; });
    out.errorsA = A.errors.length; out.errorsB = B.errors.length;
    out.infoA = await A.page.evaluate(() => window.__prof.infoNow());
    out.infoB = await B.page.evaluate(() => window.__prof.infoNow());
    for (const [preset, weather] of SCENARIOS) {
      const ra = [], rb = [], pa = [], pb = [], ca = [], cb = [];
      for (const P of [A, B]) {
        await P.page.evaluate(([p, w]) => {
          window.__prof.setScenario(p, w);
          window.__t16.ENV_UNIFORMS.uWetness.value = w === 'strong' ? 1 : 0; // rAF停止中でも濡れを定常値にする
        }, [preset, weather]);
      }
      for (let r = 0; r < rounds; r++) {
        for (const [P, ra_, pa_, ca_] of [[A, ra, pa, ca], [B, rb, pb, cb]]) {
          const t = await P.page.evaluate((n) => window.__prof.syncTime(n, 6), frames);
          ra_.push(t.avgMs); pa_.push(t.p95Ms); ca_.push(t.cpuSubmitAvgMs);
        }
      }
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      out.scenarios[`${preset}/${weather}`] = { A_medianAvgMs: med(ra), A_cpuSubmitMs: med(ca), B_medianAvgMs: med(rb), B_cpuSubmitMs: med(cb), A_all: ra, B_all: rb, A_medianP95Ms: med(pa), B_medianP95Ms: med(pb), ratioB_over_A: med(rb) / med(ra) };
      console.log(preset, weather, 'A', med(ra).toFixed(1), 'B', med(rb).toFixed(1), 'B/A', (med(rb) / med(ra)).toFixed(3), 'cpuSubmit A/B', med(ca).toFixed(1), med(cb).toFixed(1));
    }
    out.errorsA = A.errors.length; out.errorsB = B.errors.length; console.log('console errors A/B', out.errorsA, out.errorsB);
  } finally { await browser.close(); sa.server.close(); sb.server.close(); }
  saveJson(label, out);
}

// ---- 実フレームループ(rAF)での変種比較: 強風+雨のときだけ増えるフレーム時間の原因切り分け ----
async function runRafVariants(root, label) {
  const variants = {
    none: (s) => s,
    noRainUpdate: (s) => s.replace('rain.update(', '((...a) => {})('),
    noDustUpdate: (s) => s.replace('dust.update(', '((...a) => {})('),
    noParticleUpdates: (s) => s.replace('rain.update(', '((...a) => {})(').replace('dust.update(', '((...a) => {})('),
    noEnvAnimUpdate: (s) => s.replace('updateEnvAnimation(dt);', ''),
  };
  const out = {};
  for (const [name, patch] of Object.entries(variants)) {
    if (args.only && !args.only.split(',').includes(name)) continue;
    const { server, port } = await startServer(root, { patch });
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    try {
      const { page } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
      out[name] = {};
      for (const [preset, weather] of SCENARIOS) {
        await page.evaluate(([p, w]) => window.__prof.setScenario(p, w), [preset, weather]);
        await page.waitForTimeout(weather === 'strong' ? 4000 : 800);
        const raf = await page.evaluate((n) => window.__prof.rafTime(n), 90);
        out[name][`${preset}/${weather}`] = { avgMs: raf.avgMs, p95Ms: raf.p95Ms };
        console.log(name, preset, weather, 'rafAvg', raf.avgMs.toFixed(1), 'p95', raf.p95Ms.toFixed(1));
      }
    } finally { await browser.close(); server.close(); }
  }
  saveJson(label, out);
}

// ---- スクリーンショット(決定的: rAF停止・パーティクル非表示・uTime固定) ----------
async function runShots(root, label) {
  const { server, port } = await startServer(root);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const { page } = await openPage(browser, `http://127.0.0.1:${port}/index.html?quality=full`);
    for (const [preset, weather] of SCENARIOS) {
      const dataUrl = await page.evaluate(([p, w]) => {
        window.__rafHold = true;
        const t = window.__t16; window.__prof.setScenario(p, w);
        window.__prof.particles().forEach((o) => { o.visible = false; });
        t.ENV_UNIFORMS.uTime.value = 7.25;
        t.ENV_UNIFORMS.uWetness.value = w === 'strong' ? 1 : 0;
        t.renderer.render(t.scene, t.camera);
        const url = t.renderer.domElement.toDataURL('image/png');
        window.__rafRelease();
        return url;
      }, [preset, weather]);
      const f = path.join(SHOT_DIR, `${label}_${preset}_${weather}.png`);
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log('saved', f);
      await page.waitForTimeout(500);
    }
  } finally { await browser.close(); server.close(); }
}

async function runDiff(a, b) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const res = {};
  try {
    for (const [preset, weather] of SCENARIOS) {
      const fa = path.join(SHOT_DIR, `${a}_${preset}_${weather}.png`);
      const fb = path.join(SHOT_DIR, `${b}_${preset}_${weather}.png`);
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
      const r = await page.evaluate(async ([ua, ub]) => {
        const load = async (u) => { const img = new Image(); img.src = u; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
        const A = await load(ua), B = await load(ub);
        if (A.width !== B.width || A.height !== B.height) return { error: 'size mismatch' };
        const n = A.width * A.height; let diffPx = 0, sumAbs = 0, maxD = 0, over8 = 0;
        const out = new ImageData(A.width, A.height);
        for (let i = 0; i < n; i++) {
          const dr = Math.abs(A.data[i * 4] - B.data[i * 4]), dg = Math.abs(A.data[i * 4 + 1] - B.data[i * 4 + 1]), db = Math.abs(A.data[i * 4 + 2] - B.data[i * 4 + 2]);
          const d = Math.max(dr, dg, db);
          if (d > 0) diffPx++;
          if (d > 8) over8++;
          sumAbs += (dr + dg + db) / 3; if (d > maxD) maxD = d;
          const v = Math.min(255, d * 8); // 8倍に増幅
          out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
        }
        const c = document.createElement('canvas'); c.width = A.width; c.height = A.height; c.getContext('2d').putImageData(out, 0, 0);
        return { width: A.width, height: A.height, pixels: n, differingPixels: diffPx, differingPct: (100 * diffPx) / n, over8Pixels: over8, over8Pct: (100 * over8) / n, meanAbsDiff: sumAbs / n, maxChannelDiff: maxD, diffPng: c.toDataURL('image/png') };
      }, [`data:image/png;base64,${fs.readFileSync(fa).toString('base64')}`, `data:image/png;base64,${fs.readFileSync(fb).toString('base64')}`]);
      if (r.diffPng) { fs.writeFileSync(path.join(SHOT_DIR, `diff_${a}_${b}_${preset}_${weather}.png`), Buffer.from(r.diffPng.split(',')[1], 'base64')); delete r.diffPng; }
      res[`${preset}/${weather}`] = r;
      console.log(preset, weather, JSON.stringify(r));
    }
  } finally { await browser.close(); }
  saveJson(`lookDiff_${a}_vs_${b}`, res);
}

// ---- main ----------------------------------------------------------------
if (MODE === 'commits') {
  const wtRoot = args.wt || path.join(os.tmpdir(), 't16_worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const list = args.only ? args.only.split(',') : COMMITS;
  for (const c of list) {
    const dir = path.join(wtRoot, c);
    if (!fs.existsSync(dir)) execSync(`git worktree add --detach "${dir}" ${c}`, { cwd: ROOT, stdio: 'inherit' });
    await runBench(dir, `commit_${c}`);
  }
  if (!args.keep) for (const c of list) { try { execSync(`git worktree remove --force "${path.join(wtRoot, c)}"`, { cwd: ROOT, stdio: 'ignore' }); } catch { /* ignore */ } }
} else if (MODE === 'bench') {
  await runBench(args.shotsRoot || ROOT, args.label || 'bench');
} else if (MODE === 'breakdown') {
  await runBreakdown(args.shotsRoot || ROOT, `breakdown_${args.label || 'head'}`);
} else if (MODE === 'rafvariants') {
  await runRafVariants(args.shotsRoot || ROOT, `rafvariants_${args.label || 'head'}`);
} else if (MODE === 'ab') {
  await runAB(args.a, args.b, `ab_${args.label || 'x'}`, parseInt(args.rounds || '5', 10), parseInt(args.frames || '30', 10));
} else if (MODE === 'breakdown2') {
  await runBreakdown2(args.shotsRoot || ROOT, `breakdown2_${args.label || 'head'}`);
} else if (MODE === 'shots') {
  await runShots(args.shotsRoot || ROOT, args.label || 'shot');
} else if (MODE === 'diff') {
  await runDiff(args.a, args.b);
} else {
  console.error('unknown --mode');
  process.exit(2);
}

// tools/verify.mjs
// ローカルHTTPサーバー経由で index.html をヘッドレスChromiumで開き、
// window.verifyScene() の結果・コンソールエラー・スクリーンショット・fpsを取得して
// log/verify_phase1.json と log/screens/ に保存する。

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
const SCREEN_DIR = path.join(LOG_DIR, 'screens');
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const PORT = 8080;

function pctErr(actual, target) {
  if (!target) return null;
  return ((actual - target) / target) * 100;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not start in time');
}

async function main() {
  const server = spawn('npx', ['http-server', '-p', String(PORT), '-c-1', '.'], {
    cwd: ROOT, shell: true, stdio: 'pipe',
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  try {
    await waitForServer(`http://localhost:${PORT}/index.html`);

    const browser = await chromium.launch({
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--disable-gpu-sandbox',
        '--no-sandbox',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2500); // シーン構築＆初回描画待ち

    // --- 検証値取得 ---------------------------------------------------------
    const verify = await page.evaluate(() => window.verifyScene());

    const report = { generatedAt: new Date().toISOString(), raw: verify, checks: {} };

    const c = verify.counts;
    const t = verify.targets.counts;
    report.checks.counts = {
      frames: { actual: c.frames, target: t.frames, pass: c.frames === t.frames },
      courtyardPosts: { actual: c.courtyardPosts, target: t.courtyardPosts, pass: c.courtyardPosts === t.courtyardPosts },
      crossbars: { actual: c.crossbars, target: t.crossbars, pass: c.crossbars === t.crossbars },
      veilPillars: { actual: c.veilPillars, target: t.veilPillars, pass: c.veilPillars === t.veilPillars },
      entrancePillars: { actual: c.entrancePillars, target: t.entrancePillars, pass: c.entrancePillars === t.entrancePillars },
      silverSockets: { actual: c.silverSockets, target: t.silverSockets, pass: c.silverSockets === t.silverSockets },
    };

    function dimCheck(label, actual, target, tolerancePct = 2) {
      const err = pctErr(actual, target);
      return { actual, target, errorPct: err, pass: Math.abs(err) <= tolerancePct };
    }

    report.checks.dimensions = {
      courtyardLength: dimCheck('courtyardLength', verify.courtyard.x, verify.targets.courtyard.length),
      courtyardWidth: dimCheck('courtyardWidth', verify.courtyard.z, verify.targets.courtyard.width),
      courtyardHangingHeight: dimCheck('hangingHeight', verify.courtyard.y, verify.targets.courtyard.hangingHeight),
      // 幕屋外形は「枠厚分は許容」(タスク指示)のため、長さ・幅・高さとも5%許容とする
      tabernacleLength: dimCheck('tabLength', verify.tabernacleFrames.x, verify.targets.tabernacle.length, 5),
      tabernacleWidth: dimCheck('tabWidth', verify.tabernacleFrames.z, verify.targets.tabernacle.width, 5),
      tabernacleHeight: dimCheck('tabHeight', verify.tabernacleFrames.y, verify.targets.tabernacle.height, 5),
      ark_l: dimCheck('ark_l', verify.ark.x, verify.targets.ark.l),
      ark_w: dimCheck('ark_w', verify.ark.z, verify.targets.ark.w),
      ark_h: dimCheck('ark_h', verify.ark.y, verify.targets.ark.h),
      table_l: dimCheck('table_l', verify.table.x, verify.targets.table.l),
      table_w: dimCheck('table_w', verify.table.z, verify.targets.table.w),
      table_h: dimCheck('table_h', verify.table.y, verify.targets.table.h),
      incenseAltar_l: dimCheck('incenseAltar_l', verify.incenseAltar.x, verify.targets.incenseAltar.l),
      incenseAltar_w: dimCheck('incenseAltar_w', verify.incenseAltar.z, verify.targets.incenseAltar.w),
      incenseAltar_h: dimCheck('incenseAltar_h', verify.incenseAltar.y, verify.targets.incenseAltar.h),
      altar_l: dimCheck('altar_l', verify.altar.x, verify.targets.altar.l),
      altar_w: dimCheck('altar_w', verify.altar.z, verify.targets.altar.w),
      altar_h: dimCheck('altar_h', verify.altar.y, verify.targets.altar.h),
    };

    // --- コンソールエラー ------------------------------------------------
    report.consoleErrors = consoleErrors;
    report.consoleErrorCount = consoleErrors.length;

    // --- スクリーンショット ------------------------------------------------
    // ソフトウェアレンダリング(swiftshader)を長時間連続動作させるとタブがクラッシュ
    // することがあるため、ショットごとにページを再読み込みして状態をリセットする。
    async function freshShot(name, setupFn) {
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
      if (setupFn) await page.evaluate(setupFn);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), timeout: 60000 });
    }

    await freshShot('01_overview', () => window.setPreset('overview'));
    await freshShot('02_entrance', () => window.setPreset('entrance'));
    await freshShot('03_holy_place', () => window.setPreset('holyPlace'));
    await freshShot('04_most_holy', () => window.setPreset('mostHoly'));

    await freshShot('05_roof_layers_off', () => {
      ['innerLinen', 'goatHair', 'ramSkins', 'sealSkins'].forEach((k) => window.setRoofLayer(k, false));
      window.setPreset('overview');
    });

    await freshShot('06_section_view', () => {
      window.setClipping(true, 5);
      window.setPreset('holyPlace');
    });

    // 部材クリックで解説パネル
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.setPreset('mostHoly'));
    await page.waitForTimeout(300);
    const vw = 1920, vh = 1080;
    await page.mouse.click(vw / 2, vh / 2);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCREEN_DIR, '07_click_info_panel.png'), timeout: 60000 });

    // --- fps計測（ヘッドレス制約: 実GPU無し・ソフトウェアレンダリングの参考値） -----
    let fps = null;
    try {
      fps = await page.evaluate(() => new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        function count() {
          frames++;
          if (performance.now() - start < 2000) requestAnimationFrame(count);
          else resolve(frames / ((performance.now() - start) / 1000));
        }
        requestAnimationFrame(count);
      }));
    } catch (e) {
      fps = null;
    }
    report.fpsHeadlessApprox = fps;
    report.fpsNote = 'ヘッドレスChromium(GPU無し/ソフトウェアラスタライズ)での参考値。実機30fps判定の代替ではない。';

    fs.writeFileSync(path.join(LOG_DIR, 'verify_phase1.json'), JSON.stringify(report, null, 2));

    await browser.close();

    console.log('verify complete. consoleErrors=', consoleErrors.length, 'fps~=', fps == null ? 'N/A' : fps.toFixed(1));
    console.log(JSON.stringify(report.checks, null, 2));
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

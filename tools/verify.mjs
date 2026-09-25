// tools/verify.mjs
// ローカルHTTPサーバー経由で index.html をヘッドレスChromiumで開き、
// window.verifyScene() の結果・コンソールエラー・スクリーンショット・fpsを取得して
// log/verify_phase1.json と log/screens/ に保存する。
//
// R3差し戻し対応: スクリーンショットは `?quality=full` を付けて開き、本番と同じ
// フル品質(環境マップ・フルシャドウマップ・7灯すべて点灯)で撮影する。時間がかかっても良い。
// fps計測のみ、デフォルト(自動テスト検出時の軽量設定)で別途行い、参考値と明記する。

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

const PORT = 8081; // 人間が閲覧中の8080を占有しないよう、検証専用に別ポートを使用
const BASE = `http://localhost:${PORT}/index.html`;
const FULL = `${BASE}?quality=full`;

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

const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

// フル品質(環境マップPMREM等)でのソフトウェアレンダリングは、同一ページ内で
// ナビゲーションを繰り返すと(GPUメモリ解放が追いつかないためか)徐々に遅くなり、
// 最終的にnavigationがタイムアウトする現象を確認した。そのためスクリーンショットは
// 1枚ごとにブラウザプロセスそのものを起動し直し、完全にクリーンな状態で撮影する。
async function withFreshBrowser(fn) {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = spawn('npx', ['http-server', '-p', String(PORT), '-c-1', '.'], {
    cwd: ROOT, shell: true, stdio: 'pipe',
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  try {
    await waitForServer(BASE);

    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
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

    function dimCheck(actual, target, tolerancePct = 2) {
      const err = pctErr(actual, target);
      return { actual, target, errorPct: err, pass: Math.abs(err) <= tolerancePct };
    }

    report.checks.dimensions = {
      courtyardLength: dimCheck(verify.courtyard.x, verify.targets.courtyard.length),
      courtyardWidth: dimCheck(verify.courtyard.z, verify.targets.courtyard.width),
      courtyardHangingHeight: dimCheck(verify.courtyard.y, verify.targets.courtyard.hangingHeight),
      // R1差し戻し対応: 独断で許容%を緩和しない。判定対象は「枠1枚の高さ」と「幕屋の内寸」
      // (長さ・幅)を±2%で。幕屋の外寸(枠厚込み)は参考表示のみで判定しない。
      frameHeight: dimCheck(verify.frameHeight, verify.targets.frameHeight),
      tabernacleInnerLength: dimCheck(verify.tabernacleInner.length, verify.targets.tabernacleInner.length),
      tabernacleInnerWidth: dimCheck(verify.tabernacleInner.width, verify.targets.tabernacleInner.width),
      ark_l: dimCheck(verify.ark.x, verify.targets.ark.l),
      ark_w: dimCheck(verify.ark.z, verify.targets.ark.w),
      ark_h: dimCheck(verify.ark.y, verify.targets.ark.h),
      table_l: dimCheck(verify.table.x, verify.targets.table.l),
      table_w: dimCheck(verify.table.z, verify.targets.table.w),
      table_h: dimCheck(verify.table.y, verify.targets.table.h),
      incenseAltar_l: dimCheck(verify.incenseAltar.x, verify.targets.incenseAltar.l),
      incenseAltar_w: dimCheck(verify.incenseAltar.z, verify.targets.incenseAltar.w),
      incenseAltar_h: dimCheck(verify.incenseAltar.y, verify.targets.incenseAltar.h),
      altar_l: dimCheck(verify.altar.x, verify.targets.altar.l),
      altar_w: dimCheck(verify.altar.z, verify.targets.altar.w),
      altar_h: dimCheck(verify.altar.y, verify.targets.altar.h),
    };

    // 参考表示のみ（判定なし）: 外寸 = 内寸 + 枠厚(0.1m)×2 になっているかの目視確認用
    report.tabernacleOuterInfoOnly = {
      note: '判定対象外。内寸 + 枠厚(0.1m)×2 との整合を確認するための参考値。',
      outer: verify.tabernacleOuter,
      innerPlusFrameThickness: {
        length: verify.targets.tabernacleInner.length + 2 * 0.1,
        width: verify.targets.tabernacleInner.width + 2 * 0.1,
      },
    };

    // R2差し戻し対応: 解説パネルの方位名(北/南)と実座標zの符号が一致するかの検証
    report.checks.directionLabels = {
      mismatchCount: verify.directionLabelMismatches.length,
      mismatches: verify.directionLabelMismatches,
      pass: verify.directionLabelMismatches.length === 0,
    };

    // --- コンソールエラー ------------------------------------------------
    report.consoleErrors = consoleErrors;
    report.consoleErrorCount = consoleErrors.length;

    await browser.close(); // ここから先はスクリーンショット用に毎回ブラウザを起動し直す

    // --- スクリーンショット(本番と同じフル品質: ?quality=full) ----------------
    // フル品質(環境マップPMREM・2048シャドウマップ)は生成に時間がかかるため待機を長めに取る。
    async function freshShot(name, setupFn, extra) {
      await withFreshBrowser(async (p) => {
        p.on('pageerror', (err) => consoleErrors.push(String(err)));
        await p.goto(FULL, { waitUntil: 'load', timeout: 90000 });
        await p.waitForTimeout(4000);
        if (setupFn) await p.evaluate(setupFn);
        await p.waitForTimeout(800);
        if (extra) await extra(p);
        await p.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), timeout: 120000 });
      });
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

    // R4: 北側(机の側)から燭台正面を写した近接ショット(確認用、形状変更なし)
    await freshShot('08_lampstand', () => window.setPreset('lampstandFront'));

    // 部材クリックで解説パネル
    await freshShot(
      '07_click_info_panel',
      () => window.setPreset('mostHoly'),
      async (p) => {
        await p.waitForTimeout(200);
        await p.mouse.click(1920 / 2, 1080 / 2);
        await p.waitForTimeout(300);
      },
    );

    // --- fps計測（ヘッドレス制約: 実GPU無し・ソフトウェアレンダリングの参考値。 -----
    //     軽量設定(デフォルト、quality=fullなし)で計測。実機30fps判定の代替ではない） -----
    let fps = null;
    try {
      fps = await withFreshBrowser(async (p) => {
        await p.goto(BASE, { waitUntil: 'load', timeout: 60000 });
        await p.waitForTimeout(2000);
        return p.evaluate(() => new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          function count() {
            frames++;
            if (performance.now() - start < 2000) requestAnimationFrame(count);
            else resolve(frames / ((performance.now() - start) / 1000));
          }
          requestAnimationFrame(count);
        }));
      });
    } catch (e) {
      fps = null;
    }
    report.fpsHeadlessApprox = fps;
    report.fpsNote = 'ヘッドレスChromium(GPU無し/ソフトウェアラスタライズ、軽量設定)での参考値。実機30fps判定の代替ではない。スクリーンショットは別途フル品質(?quality=full)で撮影している。';

    report.consoleErrors = consoleErrors;
    report.consoleErrorCount = consoleErrors.length;

    fs.writeFileSync(path.join(LOG_DIR, 'verify_phase1.json'), JSON.stringify(report, null, 2));

    console.log('verify complete. consoleErrors=', consoleErrors.length, 'fps~=', fps == null ? 'N/A' : fps.toFixed(1));
    console.log(JSON.stringify(report.checks, null, 2));
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

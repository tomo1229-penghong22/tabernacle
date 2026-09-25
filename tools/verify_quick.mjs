// tools/verify_quick.mjs
//
// フェーズ1回帰の簡易確認スクリプト（使い捨てだが再現用に保存）。
// opus決定(2026-09-25): フル品質SS撮影はヘッドレス(swiftshader)で重く、
// 03_holy_place で120秒タイムアウトするため、自動テストからSS撮影を外す。
// 燭台等の目視確認は人間がブラウザで行う。
//
// このスクリプトは:
//   - 新規サーバーを起動しない。人間が閲覧中の既存サーバー（デフォルト
//     http://localhost:8080/index.html）をそのまま開く。止めない。
//   - ブラウザ1プロセス・ページ1枚のみを使用し、スクリーンショットは撮らない。
//   - window.verifyScene() の結果（C1寸法, C2部材数, 方位ラベル）を取得する。
//   - コンソールエラー/pageerror件数を記録する。
//   - 判定(pass/fail)は行わない。実測値・目標値・許容誤差%のみを記録する。
//
// 使い方:
//   node tools/verify_quick.mjs                      # http://localhost:8080/index.html
//   node tools/verify_quick.mjs --port=8081
//   node tools/verify_quick.mjs --url=http://localhost:8080/index.html
//   node tools/verify_quick.mjs --out=log/verify_phase1_regression.json
//
// 出力: log/verify_phase1_regression.json（--outで変更可）

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'log');
fs.mkdirSync(LOG_DIR, { recursive: true });

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const PORT = args.port || '8080';
const URL = args.url || `http://localhost:${PORT}/index.html`;
const OUT_PATH = args.out
  ? path.resolve(ROOT, args.out)
  : path.join(LOG_DIR, 'verify_phase1_regression.json');

const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

function pctErr(actual, target) {
  if (!target) return null;
  return ((actual - target) / target) * 100;
}
function dimRecord(actual, target, tolerancePct = 2) {
  return { actual, target, errorPct: pctErr(actual, target), tolerancePct };
}

async function main() {
  // 既存サーバー(人間が閲覧中)が応答するか軽く確認するのみ。起動・停止はしない。
  try {
    const res = await fetch(URL, { method: 'GET' });
    if (!res.ok) console.error(`warning: ${URL} responded with status ${res.status}`);
  } catch (e) {
    console.error(`warning: could not reach ${URL} before launching browser: ${e}`);
  }

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500); // シーン構築・初回描画待ち

    const verify = await page.evaluate(() => window.verifyScene());

    const report = {
      generatedAt: new Date().toISOString(),
      url: URL,
      note: '判定(pass/fail)なし。実測値・目標値・許容誤差%のみ記録。フル品質SS撮影は含まない。',
      raw: verify,
    };

    const c = verify.counts;
    const t = verify.targets.counts;
    report.C2_counts = {
      frames: { actual: c.frames, target: t.frames },
      courtyardPosts: { actual: c.courtyardPosts, target: t.courtyardPosts },
      crossbars: { actual: c.crossbars, target: t.crossbars },
      veilPillars: { actual: c.veilPillars, target: t.veilPillars },
      entrancePillars: { actual: c.entrancePillars, target: t.entrancePillars },
      silverSockets: { actual: c.silverSockets, target: t.silverSockets },
    };

    report.C1_dimensions = {
      courtyardLength: dimRecord(verify.courtyard.x, verify.targets.courtyard.length),
      courtyardWidth: dimRecord(verify.courtyard.z, verify.targets.courtyard.width),
      courtyardHangingHeight: dimRecord(verify.courtyard.y, verify.targets.courtyard.hangingHeight),
      frameHeight: dimRecord(verify.frameHeight, verify.targets.frameHeight),
      tabernacleInnerLength: dimRecord(verify.tabernacleInner.length, verify.targets.tabernacleInner.length),
      tabernacleInnerWidth: dimRecord(verify.tabernacleInner.width, verify.targets.tabernacleInner.width),
      ark_l: dimRecord(verify.ark.x, verify.targets.ark.l),
      ark_w: dimRecord(verify.ark.z, verify.targets.ark.w),
      ark_h: dimRecord(verify.ark.y, verify.targets.ark.h),
      table_l: dimRecord(verify.table.x, verify.targets.table.l),
      table_w: dimRecord(verify.table.z, verify.targets.table.w),
      table_h: dimRecord(verify.table.y, verify.targets.table.h),
      incenseAltar_l: dimRecord(verify.incenseAltar.x, verify.targets.incenseAltar.l),
      incenseAltar_w: dimRecord(verify.incenseAltar.z, verify.targets.incenseAltar.w),
      incenseAltar_h: dimRecord(verify.incenseAltar.y, verify.targets.incenseAltar.h),
      altar_l: dimRecord(verify.altar.x, verify.targets.altar.l),
      altar_w: dimRecord(verify.altar.z, verify.targets.altar.w),
      altar_h: dimRecord(verify.altar.y, verify.targets.altar.h),
    };

    report.directionLabels = {
      mismatchCount: verify.directionLabelMismatches.length,
      mismatches: verify.directionLabelMismatches,
    };

    report.consoleErrors = consoleErrors;
    report.consoleErrorCount = consoleErrors.length;
    report.pageErrors = pageErrors;
    report.pageErrorCount = pageErrors.length;

    fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

    console.log(`verify_quick complete. consoleErrors=${consoleErrors.length} pageErrors=${pageErrors.length}`);
    console.log(`written: ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

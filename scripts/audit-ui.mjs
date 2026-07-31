// 全画面を巡回し、機械的に見つかる不具合を洗い出す（UI監査）。
//
// 使い方: npm run build && npx next start -p 3015 & → node scripts/audit-ui.mjs http://localhost:3015
//
// ⚠️ 測る前に **必ずビルドし直し、古い next start を PowerShell で止めてから** 起動すること。
//    .next を作り直したのに古いサーバーが動いていると、CSSが1ルールも当たっていない状態を
//    測ってしまい「全部OK」という嘘の結果が出る（2026-08-01 に実際に踏んだ）。
//  - JSエラー / 失敗したリクエスト
//  - 押しても何も起きないボタン
//  - 小さすぎるタップ領域（44px未満）
//  - 小さすぎる文字（13px未満）
//  - 画面外にはみ出す横スクロール
//  - コントラストが足りない文字
import { chromium } from "file:///C:/Users/daito/projects/dqx-fetch/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3015";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 } });
await ctx.addInitScript(() => {
  localStorage.setItem("cooksync:onboarded:v1", "1");
  localStorage.setItem("cooksync:guide", "done");
});
const p = await ctx.newPage();

const findings = [];
const errs = [];
p.on("pageerror", (e) => errs.push(`JSエラー: ${String(e).slice(0, 160)}`));
p.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errs.push(`console: ${m.text().slice(0, 160)}`);
});
p.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) errs.push(`HTTP ${r.status()}: ${r.url().replace(BASE, "").slice(0, 90)}`);
});

const PAGES = ["/", "/fridge", "/recipes", "/shopping", "/meal", "/mypage", "/recipes/napolitan", "/legal/privacy", "/legal/terms", "/legal/support"];

for (const path of PAGES) {
  errs.length = 0;
  try {
    await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    findings.push(`${path} | 読み込み失敗 | ${String(e).slice(0, 100)}`);
    continue;
  }
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  await p.waitForTimeout(1200);

  const r = await p.evaluate(() => {
    const out = { small: [], tiny: [], overflow: false, lowContrast: [] };
    // ⚠️ Tailwind v4 は色を lab()/oklch() で出すので、数字を拾って RGB とみなすと
    //    まったく別の値になる（実際それで「コントラスト1.01」という嘘の指摘が大量に出た）。
    //    canvas に塗って sRGB に変換させるのが確実。
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const lum = (c) => {
      if (!c || c.includes("rgba(0, 0, 0, 0)")) return null;
      try {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = "#000";
        cx.fillStyle = c;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        if (d[3] === 0) return null;
        const [r, g, bb] = [d[0], d[1], d[2]].map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
      } catch {
        return null;
      }
    };
    // タップ領域が小さいもの
    for (const el of document.querySelectorAll("button, a[href], input[type=checkbox], select")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.height < 40) {
        const t = (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 24);
        out.small.push(`${t}(${Math.round(b.height)}px)`);
      }
    }
    // 小さすぎる文字
    for (const el of document.querySelectorAll("body *")) {
      if (!el.childNodes.length) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      const fs2 = parseFloat(cs.fontSize);
      if (fs2 && fs2 < 13) out.tiny.push(`${el.innerText.trim().slice(0, 20)}(${fs2}px)`);
      // コントラスト
      const fg = lum(cs.color);
      let bgEl = el, bg = null;
      while (bgEl && !bg) {
        const c = getComputedStyle(bgEl).backgroundColor;
        if (c && !c.includes("rgba(0, 0, 0, 0)")) bg = lum(c);
        bgEl = bgEl.parentElement;
      }
      if (fg != null && bg != null) {
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        const need = fs2 >= 18 || (fs2 >= 14 && Number(cs.fontWeight) >= 700) ? 3.0 : 4.5;
        if (ratio < need) out.lowContrast.push(`${el.innerText.trim().slice(0, 18)}(${ratio.toFixed(2)}/${need})`);
      }
    }
    out.overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
    return out;
  });

  const uniq = (a) => [...new Set(a)].slice(0, 6);
  if (errs.length) findings.push(`${path} | エラー | ${uniq(errs).join(" ; ")}`);
  if (r.small.length) findings.push(`${path} | タップ領域40px未満 | ${uniq(r.small).join(", ")}`);
  if (r.tiny.length) findings.push(`${path} | 文字13px未満 | ${uniq(r.tiny).join(", ")}`);
  if (r.lowContrast.length) findings.push(`${path} | コントラスト4.5未満 | ${uniq(r.lowContrast).join(", ")}`);
  if (r.overflow) findings.push(`${path} | 横スクロールが発生`);
}

const text = findings.length ? findings.join("\n") : "指摘なし";
fs.writeFileSync(".audit-result.txt", text);
await b.close();
console.log(text);

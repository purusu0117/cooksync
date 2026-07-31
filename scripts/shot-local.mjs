// ローカル版(3000)の実画面を撮って、壊れていないかを目で見るための道具。
//
// ⚠️ 「ビルドが通った」「テストが緑」だけでは画面が壊れていることに気づけない。
//    2026-08-01、大翔から「デザインもUIも全部壊れて何もできない」と指摘されたとき、
//    私はテストとビルドしか見ていなかった。**必ず実画面を撮って見る。**
//
// 使い方: node scripts/shot-local.mjs [baseURL]
import { chromium } from "file:///C:/Users/daito/projects/dqx-fetch/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = ".shots-local";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cooksync:onboarded:v1", "1");
  localStorage.setItem("cooksync:guide", "done");
});
const p = await ctx.newPage();

const report = [];
const errs = [];
p.on("pageerror", (e) => errs.push(`JS: ${String(e).slice(0, 200)}`));
p.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errs.push(`console: ${m.text().slice(0, 200)}`);
});
p.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) errs.push(`HTTP ${r.status()}: ${r.url().replace(BASE, "").slice(0, 80)}`);
});

for (const [name, path] of [
  ["01-home", "/"],
  ["02-fridge", "/fridge"],
  ["03-recipes", "/recipes"],
  ["04-shopping", "/shopping"],
  ["05-meal", "/meal"],
  ["06-mypage", "/mypage"],
  ["07-detail", "/recipes/napolitan"],
  ["08-lp", "/lp"],
]) {
  errs.length = 0;
  let status = "?";
  try {
    const res = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
    status = res?.status();
    await p.evaluate(() => document.fonts.ready).catch(() => {});
    await p.waitForTimeout(1200);
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  } catch (e) {
    errs.push(`goto: ${String(e).slice(0, 160)}`);
  }
  // CSSが本当に当たっているか（当たっていないと「デザインが壊れた」に見える）
  const css = await p
    .evaluate(() => {
      let rules = 0;
      for (const s of document.styleSheets) {
        try {
          rules += s.cssRules.length;
        } catch {
          /* cross-origin */
        }
      }
      return {
        rules,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        font: getComputedStyle(document.body).fontFamily.slice(0, 40),
        text: document.body.innerText.trim().length,
      };
    })
    .catch(() => null);
  report.push(
    `${name} ${path}\n  status=${status} cssRules=${css?.rules ?? "?"} bg=${css?.htmlBg ?? "?"} font=${css?.font ?? "?"} 文字数=${css?.text ?? "?"}\n  errors=${errs.length ? "\n    " + [...new Set(errs)].slice(0, 6).join("\n    ") : "なし"}`,
  );
}

fs.writeFileSync(`${OUT}/report.txt`, report.join("\n\n"));
await b.close();
console.log(report.join("\n\n"));

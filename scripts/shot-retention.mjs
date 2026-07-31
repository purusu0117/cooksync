// 継続率まわりの画面を、**データが入った状態**で撮る。
// 空っぽのホームを撮っても「作りかけに戻る」も「今週の記録」も出ないので確認にならない。
//
// 使い方: node scripts/shot-retention.mjs [baseURL]
import { chromium } from "file:///C:/Users/daito/projects/dqx-fetch/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3130";
const OUT = ".shots-retention";
fs.mkdirSync(OUT, { recursive: true });

const today = new Date();
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plus = (n) => iso(new Date(today.getTime() + n * 86400000));

const SEED = {
  meals: [
    { id: "m1", date: plus(-3), slot: "夜", recipeId: "napolitan", recipeName: "ナポリタン", made: true },
    { id: "m2", date: plus(-2), slot: "夜", recipeId: "gyudon", recipeName: "牛丼", made: true },
    { id: "m3", date: plus(-2), slot: "昼", recipeId: "napolitan", recipeName: "ナポリタン", made: true },
    { id: "m4", date: plus(-9), slot: "夜", recipeId: "gyudon", recipeName: "牛丼", made: true },
    { id: "m5", date: plus(-16), slot: "夜", recipeId: "gyudon", recipeName: "牛丼", made: true },
  ],
  shopping: [
    { id: "s1", name: "牛乳", amount: "1本", checked: false, addedAt: Date.now() },
    { id: "s2", name: "玉ねぎ", amount: "2個", checked: false, addedAt: Date.now() },
    { id: "s3", name: "鶏もも肉", amount: "300g", checked: false, note: "夜の唐揚げ用", addedAt: Date.now() },
    { id: "s4", name: "にんじん", amount: "1本", checked: false, addedAt: Date.now() },
    { id: "s5", name: "しょうゆ", amount: "1本", checked: false, addedAt: Date.now() },
    { id: "s6", name: "食パン", amount: "1斤", checked: false, addedAt: Date.now() },
    { id: "s7", name: "卵", amount: "1パック", checked: true, addedAt: Date.now() },
  ],
  fridge: [
    { id: "f1", name: "キャベツ", quantity: "1/2玉", category: "野菜", zone: "野菜", purchasedOn: plus(-6), expiresOn: plus(1), createdAt: Date.now() },
    { id: "f2", name: "豚こま", quantity: "200g", category: "肉・魚", zone: "生鮮", purchasedOn: plus(-2), expiresOn: plus(2), createdAt: Date.now() },
    { id: "f3", name: "牛乳", quantity: "1本", category: "乳製品・卵", zone: "生鮮", purchasedOn: plus(-3), expiresOn: plus(9), createdAt: Date.now() },
  ],
  cookProgress: { napolitan: ["0-0", "0-1", "1-0"] },
  cookProgressMeta: { napolitan: Date.now() - 20 * 3600 * 1000 },
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await ctx.addInitScript((seed) => {
  localStorage.setItem("cooksync:onboarded:v1", "1");
  localStorage.setItem("cooksync:guide", "done");
  localStorage.setItem("fridge-app:meals:v1", JSON.stringify(seed.meals));
  localStorage.setItem("fridge-app:shopping:v1", JSON.stringify(seed.shopping));
  localStorage.setItem("fridge-app:items:v2", JSON.stringify(seed.fridge));
  localStorage.setItem("cooksync:cookProgress:v1", JSON.stringify(seed.cookProgress));
  localStorage.setItem("cooksync:cookProgress:meta:v1", JSON.stringify(seed.cookProgressMeta));
}, SEED);

const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(`JS: ${String(e).slice(0, 200)}`));
p.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errs.push(`console: ${m.text().slice(0, 160)}`);
});

const report = [];
for (const [name, path, full] of [
  ["01-home", "/", true],
  ["02-shopping", "/shopping", true],
]) {
  errs.length = 0;
  const res = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!full });
  const info = await p.evaluate(() => ({
    text: document.body.innerText.replace(/\n+/g, " / ").slice(0, 700),
    // タップ領域44px未満のボタン・リンクを数える（店で押せないUIを作らないため）
    small: [...document.querySelectorAll("button,a")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ t: (el.innerText || el.ariaLabel || "").slice(0, 14), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((x) => x.h > 0 && x.h < 44),
  }));
  report.push(`${name} ${path} status=${res?.status()}\n  errors=${errs.length ? [...new Set(errs)].join(" | ") : "なし"}\n  44px未満=${JSON.stringify(info.small)}\n  text=${info.text}`);
}
fs.writeFileSync(`${OUT}/report.txt`, report.join("\n\n"));
await b.close();
console.log(report.join("\n\n"));

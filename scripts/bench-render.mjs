// 描画パフォーマンスの実測ベンチマーク（before/after を同じ手順で比べるためのもの）。
//
// 何を測るか
//   「操作してから React の再描画が終わるまで」の JS 時間。
//   click は React では discrete event なので、ハンドラの後のマイクロタスクで
//   同期的に render+commit まで流れる。DOM が書き換わった直後に MutationObserver が
//   走るので、その時刻との差分＝1レンダーの実コストになる。
//
// 使い方（★ポート3000は絶対に使わない。3140番台を使う）
//   npm run build
//   npx next start -p 3141
//   node scripts/bench-render.mjs --url http://localhost:3141 --label before --out .bench/before.json
//   （変更を入れる）
//   npm run build && npx next start -p 3141
//   node scripts/bench-render.mjs --url http://localhost:3141 --label after --out .bench/after.json
//   node scripts/bench-render.mjs --compare .bench/before.json .bench/after.json
//
//   1か所だけ切り分けたいときは --only <id>（fridge-half / recipes-filter / detail-task /
//   meal-rank / home-rerender）。「変更を1ハンクだけ戻して測る」対照実験に使う。
//   結果 JSON は .bench/ に出る（git 管理外。実測の記録として手元に残す用）。
//
//   終わったら必ず止める:
//   Get-NetTCPConnection -LocalPort 3141 | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
//
// ⚠️ 測る前に必ずビルドし直すこと。`.next` が古いと前の版を測ってしまう。
//    Playwright はこのリポジトリの依存ではないので、同じPCの別プロジェクトから借りている
//    （scripts/audit-ui.mjs と同じやり方）。

import fs from "node:fs";
import path from "node:path";
import { makeDataset, toLocalStorage } from "./bench-data.mjs";

const PLAYWRIGHT = "file:///C:/Users/daito/projects/dqx-fetch/node_modules/playwright/index.mjs";

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}

if (argv.includes("--compare")) {
  const i = argv.indexOf("--compare");
  compare(readJSON(argv[i + 1]), readJSON(argv[i + 2]));
  process.exit(0);
}

const BASE = arg("url", "http://localhost:3141").replace(/\/$/, "");
const LABEL = arg("label", "run");
const OUT = arg("out", null);
const SAMPLES = Number(arg("samples", 9));
// --only fridge-half のように書くと、そのシナリオだけ測る（1か所だけ切り分けたいとき用）
const ONLY = arg("only", null);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------------------
// ページに注入する計測ヘルパ
// ---------------------------------------------------------------------------
const MEASURE_HELPERS = () => {
  // クリック → React の再描画（render + commit）が終わるまでの ms。
  //
  // click は React の discrete event なので、ハンドラが返ったあとの
  // **マイクロタスク**で同期フラッシュされる。await を挟むと、その後に
  // こちらの継続が回ってくるので、差分がそのまま1レンダーの JS コストになる。
  // MutationObserver 方式・強制レイアウト方式とも±2msで一致することを確認済み
  // （こちらを採る理由＝**DOMが1文字も変わらない再描画でも測れる**から。
  //   メモ化が効いて「何も起きない」ケースを 0 と読めないと before/after を比べられない）。
  //
  // selector は素の CSS セレクタ。text を渡すと、その文字列を含む要素に絞って nth 番目を押す。
  window.__benchClick = async (selector, nth = 0, text = null) => {
    let els = [...document.querySelectorAll(selector)];
    if (text) els = els.filter((e) => (e.textContent || "").includes(text));
    const el = els[nth];
    if (!el) return { error: `not found: ${selector}[${nth}] text=${text} (${els.length}件)` };
    const t0 = performance.now();
    el.click();
    await null;
    await null;
    return { ms: performance.now() - t0 };
  };

  // 読み込み中の長タスク合計（＝初回描画・ハイドレーションの重さ）
  window.__benchLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__benchLongTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask 非対応環境は 0 のまま */
  }
};

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
const { chromium } = await import(PLAYWRIGHT);

const dataset = makeDataset();
const seedMap = toLocalStorage(dataset);
const UID = "bench-uid-0001";
const serverPayload = {
  "fridge-app:items:v2": dataset.fridge,
  "fridge-app:recipes:v1": dataset.recipes,
  "fridge-app:meals:v1": dataset.meals,
  "cooksync:ratings:v1": dataset.ratings,
  "fridge-app:shopping:v1": [],
  "cooksync:account:v1": [],
  "cooksync:usage:v1": [],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });

// 端末キャッシュを先に仕込む。sync-meta の uid を合わせないと primeFromCache が
// 「別人の残骸」とみなして全部消してしまう（syncStore.ts のコメント参照）。
await ctx.addInitScript(
  ([map, uid]) => {
    try {
      for (const [k, v] of Object.entries(map)) window.localStorage.setItem(k, v);
      window.localStorage.setItem("cooksync:uid", uid);
      window.localStorage.setItem(
        "cooksync:sync-meta",
        JSON.stringify({ v: 1, uid, anon: true, dirty: [], migrate: false }),
      );
    } catch {
      /* noop */
    }
  },
  [seedMap, UID],
);
await ctx.addInitScript(MEASURE_HELPERS);

// サーバーは「端末と同じ内容」を返す＝同期が一発で成立し、再送タイマーが鳴らない。
// （失敗させるとバックオフ再送が計測中に割り込んでノイズになる）
await ctx.route("**/api/store*", async (route) => {
  const req = route.request();
  if (req.method() === "GET") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverPayload) });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
});
// 計測に関係ない外部通信は落とす
await ctx.route("**://image.pollinations.ai/**", (r) => r.abort());

const page = await ctx.newPage();
const results = [];

/** 1シナリオ実行 */
async function scenario({ id, title, url, ready, selector, text = null, nth = () => 0, prepare = [] }) {
  if (ONLY && ONLY !== id) return;
  await page.goto(`${BASE}${url}`, { waitUntil: "load" });
  await page.waitForFunction(ready, null, { timeout: 30_000 });
  await page.waitForTimeout(700); // ハイドレーション＋初回同期を落ち着かせる
  const longTasks = await page.evaluate(() => window.__benchLongTasks.reduce((a, b) => a + b, 0));

  // 計測したい画面まで進める（計測対象ではないクリック）
  for (const p of prepare) {
    await page.evaluate(([s, n, t]) => window.__benchClick(s, n, t), [p.selector, p.nth ?? 0, p.text ?? null]);
    await page.waitForTimeout(250);
  }

  const samples = [];
  for (let i = 0; i < SAMPLES + 1; i++) {
    const res = await page.evaluate(
      ([sel, n, t]) => window.__benchClick(sel, n, t),
      [selector, nth(i), text],
    );
    if (res.error) throw new Error(`${id}: ${res.error}`);
    if (i > 0) samples.push(res.ms); // 1回目はウォームアップとして捨てる
    await page.waitForTimeout(120);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const out = {
    id,
    title,
    median: round(median),
    min: round(samples[0]),
    max: round(samples[samples.length - 1]),
    samples: samples.map(round),
    loadLongTaskMs: round(longTasks),
  };
  results.push(out);
  console.log(
    `  ${id.padEnd(14)} ${String(out.median).padStart(8)} ms (min ${out.min} / max ${out.max})  読み込み時の長タスク計 ${out.loadLongTaskMs} ms`,
  );
}

const detailId = dataset.recipes[0].id;

console.log(`\n=== CookSync 描画ベンチ [${LABEL}] ${BASE} ===`);
console.log(
  `データ: レシピ${dataset.recipes.length} / 冷蔵庫${dataset.fridge.length} / 献立履歴${dataset.meals.length} / 評価${dataset.ratings.length}\n`,
);

// A: 冷蔵庫100件で「半分使った」を1回押す（FoodCard 100枚の再描画）
await scenario({
  id: "fridge-half",
  title: "冷蔵庫100件：「½ 半分使った」を1回押す",
  url: "/fridge",
  ready: () => document.querySelectorAll("li button").length > 100,
  selector: "li button",
  text: "半分使った",
  nth: (i) => i % 20,
});

// B: レシピ200件で絞り込みチップを押す（filtered/sorted の再計算）
await scenario({
  id: "recipes-filter",
  title: "レシピ200件：絞り込みチップ（肉）をトグル",
  url: "/recipes",
  ready: () => document.querySelectorAll("a[href^='/recipes/']").length > 50,
  selector: "button",
  text: "肉",
});

// C: レシピ詳細：工程チェックを1つ押す（RecipeDetail 全体の再描画）
await scenario({
  id: "detail-task",
  title: "レシピ詳細：工程チェックをトグル",
  url: `/recipes/${detailId}`,
  ready: () => document.querySelectorAll("li[id^='task-']").length > 0,
  selector: "li[id^='task-'] button",
  nth: (i) => i % 5,
});

// D: 献立ウィザード：方向性チップを押す（rankCandidates が206件×献立履歴700件を再走査）
await scenario({
  id: "meal-rank",
  title: "献立：方向性チップ（和）をトグル → 候補ランキング再計算",
  url: "/meal",
  ready: () => [...document.querySelectorAll("button")].some((b) => b.textContent === "次へ"),
  prepare: [{ selector: "button", text: "次へ" }],
  selector: "button",
  text: "和",
});

// E: ホーム：冷蔵庫の更新でホーム全体が再描画される（recommended の全件ソート）
//    冷蔵庫リストのタイルは Link なので押すと遷移してしまう。代わりに
//    「別タブが冷蔵庫を書き換えた」= storage イベントを起こすボタンを差し込む。
if (!ONLY || ONLY === "home-rerender") {
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("a[href^='/recipes/']").length > 3, null, {
  timeout: 30_000,
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const b = document.createElement("button");
  b.id = "bench-poke";
  b.style.cssText = "position:fixed;left:-9999px";
  b.onclick = () => {
    // syncStore は storage イベントで該当キーを読み直して notify() する。
    // 冷蔵庫だけを触るので、レシピ・評価の参照は変わらない
    // （＝recommended が useMemo されていれば再計算されないはず）。
    window.dispatchEvent(new StorageEvent("storage", { key: "fridge-app:items:v2" }));
  };
  document.body.appendChild(b);
});
{
  const samples = [];
  const longTasks = await page.evaluate(() => window.__benchLongTasks.reduce((a, b) => a + b, 0));
  for (let i = 0; i < SAMPLES + 1; i++) {
    const res = await page.evaluate(() => window.__benchClick("#bench-poke", 0));
    if (i > 0) samples.push(res.ms);
    await page.waitForTimeout(120);
  }
  samples.sort((a, b) => a - b);
  const out = {
    id: "home-rerender",
    title: "ホーム：冷蔵庫更新によるホーム全体の再描画",
    median: round(samples[Math.floor(samples.length / 2)]),
    min: round(samples[0]),
    max: round(samples[samples.length - 1]),
    samples: samples.map(round),
    loadLongTaskMs: round(longTasks),
  };
  results.push(out);
  console.log(
    `  ${out.id.padEnd(14)} ${String(out.median).padStart(8)} ms (min ${out.min} / max ${out.max})  読み込み時の長タスク計 ${out.loadLongTaskMs} ms`,
  );
}
}

await browser.close();

const payload = {
  label: LABEL,
  base: BASE,
  when: new Date().toISOString(),
  dataset: {
    recipes: dataset.recipes.length,
    fridge: dataset.fridge.length,
    meals: dataset.meals.length,
    ratings: dataset.ratings.length,
  },
  results,
};

if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n→ ${OUT} に保存しました`);
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function compare(before, after) {
  console.log(`\n=== before(${before.label}) → after(${after.label}) ===`);
  console.log(
    "シナリオ".padEnd(16) + "before".padStart(10) + "after".padStart(10) + "  改善",
  );
  for (const b of before.results) {
    const a = after.results.find((x) => x.id === b.id);
    if (!a) continue;
    const ratio = b.median / a.median;
    console.log(
      b.id.padEnd(16) +
        `${b.median}ms`.padStart(10) +
        `${a.median}ms`.padStart(10) +
        `  ${ratio.toFixed(1)}倍速 (-${Math.round((1 - a.median / b.median) * 100)}%)`,
    );
  }
}

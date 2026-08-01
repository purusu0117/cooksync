// App Store 提出用スクリーンショットを撮る。scripts/shot-local.mjs の派生。
//
// ⚠️ **ポート3000（大翔が毎日使っているローカルサーバー）に read-only でしか触らない。**
//    - 止めない・再ビルドしない・環境変数を変えない。
//    - GET /api/store は**このスクリプトの中で偽の応答に差し替える**ので、
//      大翔の実データ（.data/store.json）は1バイトも読まないし書かない。
//    - GET 以外のリクエスト（PUT/POST）は同一オリジンなら全部 abort する。
//      これで「スクショを撮ったら誰かのデータが書き換わっていた」が構造的に起こらない。
//
// 何を出すか（.shots-store/）:
//    raw-6.9/*.png … 1320×2868（iPhone 6.9インチ）そのままの画面
//    raw-6.5/*.png … 1242×2688（iPhone 6.5インチ）そのままの画面
//    6.9/*.png     … 上にキャッチコピーの帯を足した提出用
//    6.5/*.png     … 同上
//    report.txt    … 画面ごとの状態（文字数・CSS・エラー）。**空っぽの画面を出さないための検算**
//
// 使い方: node scripts/shot-store.mjs [baseURL]
import { chromium } from "file:///C:/Users/daito/projects/dqx-fetch/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = ".shots-store";

// App Store Connect が要求する2サイズ。
//   6.9インチ = 440×956pt @3x = 1320×2868px（iPhone 16 Pro Max 等）
//   6.5インチ = 414×896pt @3x = 1242×2688px（iPhone 11 Pro Max / XS Max 等）
const DEVICES = [
  { id: "6.9", cssW: 440, cssH: 956, px: [1320, 2868] },
  { id: "6.5", cssW: 414, cssH: 896, px: [1242, 2688] },
];

// ---------------------------------------------------------------------------
// デモ用の在庫データ（**大翔の実データではない**。表示のためだけにこの場で作る）
// ---------------------------------------------------------------------------
// 期限は「撮った日」からの相対で作る。日付が固定だと、後日撮り直したとき
// 全部が期限切れの赤になって「食材が全部腐っているアプリ」の画になる。
const today = new Date();
const iso = (offsetDays) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// 内蔵レシピ（ナポリタン／生姜焼き／油淋鶏／リゾット）が「在庫だけで作れる」判定に
// なるように、それらの主材料で埋める。ここが噛み合っていないと提案が0件になる。
const FRIDGE = [
  ["鶏もも肉", "1枚", "肉・魚", "生鮮", 1],
  ["豚ロース薄切り", "150g", "肉・魚", "生鮮", 2],
  ["玉ねぎ", "3個", "野菜", "野菜", 12],
  ["ピーマン", "4個", "野菜", "野菜", 5],
  ["ミニトマト", "1パック", "野菜", "野菜", 4],
  ["キャベツ", "1/2玉", "野菜", "野菜", 8],
  ["長ねぎ", "1本", "野菜", "野菜", 6],
  ["ウインナー", "1袋", "肉・魚", "生鮮", 9],
  ["牛乳", "1本", "乳製品・卵", "生鮮", 3],
  ["卵", "10個", "乳製品・卵", "生鮮", 14],
  ["スライスチーズ", "1袋", "乳製品・卵", "生鮮", 20],
  ["ご飯（冷凍）", "2食分", "主食", "冷凍", 25],
  ["スパゲッティ", "1袋", "主食", "乾物・調味料", 300],
].map(([name, quantity, category, zone, days], i) => ({
  id: `demo-f-${i}`,
  name,
  quantity,
  category,
  zone,
  purchasedOn: iso(-2),
  expiresOn: iso(days),
  createdAt: Date.now() - i * 1000,
}));

const SHOPPING = [
  ["ピーマン", "1袋", "ナポリタン用"],
  ["ウインナー", "1パック", "ナポリタン用"],
  ["白身魚の切り身", "2切", "アクアパッツァ用"],
  ["にんにく", "1ネット", "アクアパッツァ用"],
  ["イタリアンパセリ", "1束", "アクアパッツァ用"],
].map(([name, amount, note], i) => ({
  id: `demo-s-${i}`,
  name,
  amount,
  note,
  checked: i === 0,
  addedAt: Date.now() - i * 1000,
}));

// syncStore が読む localStorage のキー（src/lib/storage.ts と一致させること）
const SEED = {
  "fridge-app:items:v2": FRIDGE,
  "fridge-app:shopping:v1": SHOPPING,
  "fridge-app:recipes:v1": [],
  "fridge-app:meals:v1": [],
  "cooksync:account:v1": [],
  "cooksync:ratings:v1": [],
  "cooksync:usage:v1": [],
};

// ---------------------------------------------------------------------------
// 撮る画面。step は「その画面に辿り着くための操作」。
// ---------------------------------------------------------------------------
const SHOTS = [
  {
    name: "01-home",
    path: "/",
    caption: "今日なに作るか、家にあるもので決まる",
  },
  {
    name: "02-meal",
    path: "/meal",
    caption: "家にあるものだけで、3案",
    // タイミング→方向性→提案。AIは呼ばない（内蔵レシピを在庫で絞った候補が出る）。
    steps: [{ text: "次へ" }, { text: "提案を見る" }],
    scrollTop: true,
  },
  {
    name: "03-shopping",
    path: "/shopping",
    caption: "足りない分を、買える単位で",
  },
  {
    name: "04-servings",
    path: "/recipes/shogayaki",
    caption: "手順の中の分量まで書き換わる",
    // ボタンのラベルは「4人」（「4人分」ではない・RecipeDetail.tsx L580）
    steps: [{ text: "4人" }],
    scrollTo: "何人前で作る",
  },
  {
    name: "05-sources",
    path: "/recipes/napolitan",
    caption: "どこから来たレシピか、必ず残る",
    scrollTo: "参考にしたページ",
  },
  {
    name: "06-fridge",
    path: "/fridge",
    caption: "期限が近い順に、色で分かる",
    // 食材カードの一覧そのものを見せる（追加フォームではなく）
    scrollSel: "ul",
  },
];

// ---------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
for (const d of DEVICES) {
  fs.mkdirSync(path.join(OUT, `raw-${d.id}`), { recursive: true });
  fs.mkdirSync(path.join(OUT, d.id), { recursive: true });
}

const browser = await chromium.launch();
const report = [];

/** 同一オリジンへの書き込みを止め、/api/store を偽の応答に差し替える（実データを触らない）。 */
async function guard(page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const sameOrigin = url.startsWith(BASE);
    if (sameOrigin && req.method() !== "GET") return route.abort();
    if (sameOrigin && url.includes("/api/store")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "X-CookSync-Rev": "1" },
        body: JSON.stringify(SEED),
      });
    }
    return route.continue();
  });
}

for (const dev of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: dev.cssW, height: dev.cssH },
    deviceScaleFactor: 3,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript((seed) => {
    localStorage.setItem("cooksync:onboarded:v1", "1");
    localStorage.setItem("cooksync:guide", "done");
    localStorage.setItem("cooksync:uid", "store-demo");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem(
      "cooksync:sync-meta",
      JSON.stringify({ v: 1, uid: "store-demo", anon: true, dirty: [], forced: [], migrate: false }),
    );
  }, SEED);

  const page = await ctx.newPage();
  await guard(page);

  for (const shot of SHOTS) {
    const errs = [];
    const onErr = (e) => errs.push(`JS: ${String(e).slice(0, 160)}`);
    page.on("pageerror", onErr);
    let status = "?";
    const notes = [];
    try {
      const res = await page.goto(BASE + shot.path, { waitUntil: "networkidle", timeout: 60000 });
      status = res?.status();
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(1500);

      for (const st of shot.steps ?? []) {
        const el = page.getByRole("button", { name: st.text, exact: false }).first();
        try {
          await el.click({ timeout: 6000 });
          await page.waitForTimeout(900);
          notes.push(`click:${st.text}=ok`);
        } catch {
          notes.push(`click:${st.text}=${st.optional ? "skip" : "FAIL"}`);
        }
      }

      if (shot.scrollTop) {
        // 画面側が遷移後に自前で scrollIntoView する（/meal の提案結果）ので、
        // 一度戻しただけでは効かない。落ち着いてからもう一度、確実に一番上へ。
        await page.waitForTimeout(900);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(700);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(400);
      }

      if (shot.scrollSel) {
        const ok = await page
          .evaluate((sel) => {
            // 同じセレクタが複数当たるときは**子要素が一番多いもの**を選ぶ。
            // /fridge は「冷蔵庫メンテナンス」の小さな ul が先に当たってしまい、
            // 見せたい食材カードの一覧（13件）ではない場所へスクロールしていた。
            const all = Array.from(document.querySelectorAll(sel));
            const el = all.sort((a, b) => b.children.length - a.children.length)[0];
            if (!el) return false;
            el.scrollIntoView({ block: "start" });
            window.scrollBy(0, -110);
            return true;
          }, shot.scrollSel)
          .catch(() => false);
        notes.push(`scrollSel:${shot.scrollSel}=${ok ? "ok" : "NOTFOUND"}`);
        await page.waitForTimeout(600);
      }

      if (shot.scrollTo) {
        const ok = await page
          .evaluate((needle) => {
            const els = Array.from(document.querySelectorAll("h1,h2,h3,p,div,span"));
            const hit = els.reverse().find((e) => e.textContent?.trim().startsWith(needle));
            if (!hit) return false;
            hit.scrollIntoView({ block: "start" });
            window.scrollBy(0, -80);
            return true;
          }, shot.scrollTo)
          .catch(() => false);
        notes.push(`scroll:${shot.scrollTo}=${ok ? "ok" : "NOTFOUND"}`);
        await page.waitForTimeout(600);
      }

      // Next.js の開発オーバーレイは提出物に写ってはいけない
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
      await page.screenshot({ path: path.join(OUT, `raw-${dev.id}`, `${shot.name}.png`), fullPage: false });
    } catch (e) {
      errs.push(`goto: ${String(e).slice(0, 200)}`);
    }
    page.off("pageerror", onErr);

    // 「撮れた」で終わらせない。中身が入っているかを毎回数える。
    const stat = await page
      .evaluate(() => {
        let rules = 0;
        for (const s of document.styleSheets) {
          try {
            rules += s.cssRules.length;
          } catch {
            /* cross-origin */
          }
        }
        return { rules, text: document.body.innerText.trim().length };
      })
      .catch(() => null);

    if (dev.id === DEVICES[0].id) {
      report.push(
        `${shot.name} ${shot.path}\n  status=${status} cssRules=${stat?.rules ?? "?"} 文字数=${stat?.text ?? "?"}\n  ${notes.join(" / ") || "操作なし"}\n  errors=${errs.length ? [...new Set(errs)].slice(0, 4).join(" | ") : "なし"}`,
      );
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// キャッチコピーの帯を足した提出用を作る。
// 端末の画面をそのまま貼るだけだと「何のアプリか」が一覧で伝わらないため。
// ---------------------------------------------------------------------------
const composeCtx = await browser.newContext({ deviceScaleFactor: 1 });
for (const dev of DEVICES) {
  const page = await composeCtx.newPage();
  await page.setViewportSize({ width: dev.px[0], height: dev.px[1] });
  for (const shot of SHOTS) {
    const src = path.join(OUT, `raw-${dev.id}`, `${shot.name}.png`);
    if (!fs.existsSync(src)) continue;
    const b64 = fs.readFileSync(src).toString("base64");
    const W = dev.px[0];
    const H = dev.px[1];
    // 帯 22% ／ 端末 78%。端末画像は幅の 84% に収め、角丸で「アプリの画面」と分かるようにする。
    const capH = Math.round(H * 0.22);
    const shotW = Math.round(W * 0.84);
    await page.setContent(
      `<style>
        @import url('');
        html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden}
        body{background:linear-gradient(170deg,#f0ece1 0%,#e3ebdd 100%);
             font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;}
        .cap{height:${capH}px;display:flex;align-items:center;justify-content:center;
             padding:0 ${Math.round(W * 0.07)}px;box-sizing:border-box;text-align:center}
        .cap h1{margin:0;color:#1f3d2b;font-weight:800;letter-spacing:.01em;
                font-size:${Math.round(W * 0.062)}px;line-height:1.45}
        .frame{display:flex;justify-content:center}
        .frame img{width:${shotW}px;border-radius:${Math.round(W * 0.045)}px;
                   box-shadow:0 ${Math.round(W * 0.02)}px ${Math.round(W * 0.05)}px rgba(31,61,43,.22);
                   display:block}
      </style>
      <div class="cap"><h1>${shot.caption}</h1></div>
      <div class="frame"><img src="data:image/png;base64,${b64}"></div>`,
      { waitUntil: "load" },
    );
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, dev.id, `${shot.name}.png`), fullPage: false });
  }
  await page.close();
}
await composeCtx.close();
await browser.close();

// 出来上がりの実寸を検算する（App Store は1pxでも違うと弾く）
const sizes = [];
for (const dev of DEVICES) {
  for (const sub of [`raw-${dev.id}`, dev.id]) {
    const dir = path.join(OUT, sub);
    for (const f of fs.readdirSync(dir)) {
      const buf = fs.readFileSync(path.join(dir, f));
      // PNG の IHDR から幅・高さを読む（sharp を使わずに済ませる）
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      const want = dev.px;
      sizes.push(`${sub}/${f} ${w}×${h} ${w === want[0] && h === want[1] ? "OK" : "★サイズ不一致"}`);
    }
  }
}

const out = report.join("\n\n") + "\n\n---- 実寸の検算 ----\n" + sizes.join("\n");
fs.writeFileSync(path.join(OUT, "report.txt"), out);
console.log(out);

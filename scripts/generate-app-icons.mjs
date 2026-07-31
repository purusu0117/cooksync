// アプリアイコン／スプラッシュ生成：iOSネイティブ（Capacitor 8）用の画像を書き出す。
//   - AppIcon      … 1024x1024 単一（Capacitor 8 の AppIcon.appiconset はこれ1枚）
//   - Splash       … 2732x2732 を3枚（1x/2x/3x で同じ画像を使う Capacitor の既定構成）
// 角丸はOS側が適用するため焼き込まない（full-bleed正方形のまま）。
// アイコンはアルファ付きだとApp Storeのアップロードで弾かれるので、背景色で必ず塗りつぶす。
//   実行: node scripts/generate-app-icons.mjs
//
// ⚠️ アイコンの元画像は **public/icon-512.jpg**（＝PWA/ホーム画面と同じもの）。
//    一度 public/cooksync-mark.svg（ベクタ）に変えたことがあるが、これは**別のデザイン**で、
//    アプリのアイコンだけ見た目が変わってしまった（2026-07-31・大翔が実機で気づいて発覚）。
//    「ベクタの方が劣化しない」は技術的には正しくても、**ブランドの見た目を変える判断は別物**。
//    Web/PWA/iOS でアイコンを揃えること。変えたいときは先に大翔に確認する。
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// PWA(icon-512.jpg)と同一。実体は1024x1024あるのでAppIconにそのまま足りる。
const src = path.join(root, "public", "icon-512.jpg");
// スプラッシュ中央に置くマーク（ロゴ単体）。こちらはベクタでよい。
const splashSrc = path.join(root, "public", "cooksync-logo.svg");

// src/app/manifest.ts の background_color と揃える（起動時に色が変わって見えないように）
const BG = { r: 0xf0, g: 0xec, b: 0xe1, alpha: 1 };

const ICON_DIR = "ios/App/App/Assets.xcassets/AppIcon.appiconset";
const SPLASH_DIR = "ios/App/App/Assets.xcassets/Splash.imageset";

/** ベクタを指定サイズで描画してバッファ化（densityを上げないとぼやける） */
function renderVector(file, size) {
  return sharp(file, { density: Math.max(72, (72 * size) / 1024) })
    .resize(size, size, { fit: "contain", background: { ...BG, alpha: 0 } })
    .png()
    .toBuffer();
}

/** AppIcon＝PWAと同じ画像を全面に敷く（トリミングも余白追加もしない） */
async function writeIcon(out, size) {
  await sharp(src)
    .resize(size, size, { fit: "cover" })
    .flatten({ background: BG })
    .removeAlpha() // アルファを残さない（App Store Connect の検証で弾かれる）
    .png()
    .toFile(path.join(root, out));
  console.log(`OK ${out} (${size}x${size})`);
}

/** スプラッシュ＝背景色ベタ塗りの中央にロゴを小さく置く（拡大でぼやけないよう余白多め） */
async function writeSplash(out, size, markRatio = 0.28) {
  const markSize = Math.round(size * markRatio);
  const mark = await renderVector(splashSrc, markSize);
  await sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .removeAlpha()
    .png()
    .toFile(path.join(root, out));
  console.log(`OK ${out} (${size}x${size})`);
}

await writeIcon(`${ICON_DIR}/AppIcon-512@2x.png`, 1024);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await writeSplash(`${SPLASH_DIR}/${name}`, 2732);
}

// 生成物の実測チェック（サイズ・形式・アルファ無しを保証する）
const expected = [
  { file: `${ICON_DIR}/AppIcon-512@2x.png`, size: 1024 },
  { file: `${SPLASH_DIR}/splash-2732x2732.png`, size: 2732 },
  { file: `${SPLASH_DIR}/splash-2732x2732-1.png`, size: 2732 },
  { file: `${SPLASH_DIR}/splash-2732x2732-2.png`, size: 2732 },
];
let ng = 0;
for (const e of expected) {
  const m = await sharp(path.join(root, e.file)).metadata();
  const ok = m.width === e.size && m.height === e.size && m.format === "png" && !m.hasAlpha;
  if (!ok) ng++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${e.file} ${m.width}x${m.height} ${m.format} alpha=${m.hasAlpha}`,
  );
}
if (ng > 0) {
  console.error(`検証NG: ${ng}件`);
  process.exit(1);
}

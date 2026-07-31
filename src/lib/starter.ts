// 初回の「最初の5分」を軽くするための決定論ロジック。**AIは一切呼ばない。**
//
// なぜこれが要るか（2026-08-01 の調査）:
//   Food & Drink カテゴリの継続率は全カテゴリ最下位（Day1 16.5% / Day7 7% / Day30 3.9%）で、
//   死因はどのアプリも同じ「登録が面倒で続かない」。
//   50万DLの競合ですら ★2「もともと家にある食材も登録しようとするとかなりの時間がかかる」
//   と言われている。つまり **入力の重さを削ること自体が機能** になる。
//
// ここでやること:
//   1) 「食材名だけ」から FridgeItem を1つ組み立てる（カテゴリ・期限・保存ゾーン・数量は推定で埋める）
//   2) タップで足せる「よく買うもの」候補を返す（AIを呼ばないので0円・0秒）
//   3) 「あと何個で献立を出せるか」というゴールまでの距離を返す
//
// ★ STARTER_FOODS は **必ず guess.ts の辞書に載っている名前だけ** で構成する。
//   辞書に無いと guessItem().needsAI が true になり、タップ1回でAI（/api/estimate-expiry）
//   が飛ぶ。「タップで足せる候補」がAI課金の入口になっては本末転倒なので、
//   starter.test.ts でここを固定している。

import { todayISO, zoneForCategory, type FridgeItem } from "./food";
import { guessItem } from "./guess";
import { packOf } from "./packaging";
import { normalizeName } from "./recipe";

/**
 * 献立を提案できるようになる在庫数の目安。
 *
 * 「冷蔵庫を全部登録してください」と言わないための数字。
 * 主菜1品は だいたい「主材料1＋野菜1〜2」で成立するので3つ。
 * 3つなら30秒で終わり、写真1枚ならもっと速い。
 */
export const SUGGEST_THRESHOLD = 3;

/** 献立を出せるようになるまで、あと何個か（0なら到達済み） */
export function remainingToSuggest(count: number): number {
  return Math.max(0, SUGGEST_THRESHOLD - count);
}

/**
 * タップで足せる「よく買うもの」。
 * 総務省家計調査で購入頻度の高い生鮮＋一人暮らしの定番から、
 * guess.ts の辞書に載っている表記だけを選んである（＝AIを呼ばない）。
 */
export const STARTER_FOODS: string[] = [
  "卵",
  "牛乳",
  "玉ねぎ",
  "人参",
  "キャベツ",
  "じゃがいも",
  "鶏もも肉",
  "豚こま肉",
  "豆腐",
  "納豆",
  "もやし",
  "しめじ",
  "ピーマン",
  "トマト",
  "ウインナー",
  "食パン",
];

/** 冷蔵庫に既に入っているものを候補から外す（同じものを2度勧めない） */
export function starterSuggestions(
  existingNames: string[] = [],
  limit = 8,
): string[] {
  const have = new Set(existingNames.map((n) => normalizeName(n)));
  return STARTER_FOODS.filter((f) => !have.has(normalizeName(f))).slice(0, limit);
}

/**
 * 食材名だけから冷蔵庫アイテムを作る。
 *
 * 手入力フォームは 食材名／数量／カテゴリ／購入日／期限／開封済み の6項目あったが、
 * 初回に6項目を埋めさせるのは「作業」であって「料理」ではない。
 * 埋められる欄は全部こちらで埋める（カテゴリ・期限は既存の推定、数量は販売単位）。
 * 推定が外れても FoodCard からいつでも直せる。
 */
export function quickItem(name: string, today: string = todayISO()): FridgeItem {
  const trimmed = name.trim();
  const g = guessItem(trimmed, today);
  const pack = packOf(trimmed);
  return {
    id: crypto.randomUUID(),
    name: trimmed,
    // 「1パック」等、店で売っている単位を既定にする（個数が分からなくても入れられる）
    quantity: pack ? `1${pack.unit}` : "",
    category: g.category,
    zone: zoneForCategory(g.category),
    purchasedOn: today,
    expiresOn: g.expiresOn,
    createdAt: Date.now(),
  };
}

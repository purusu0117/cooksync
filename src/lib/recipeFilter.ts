// レシピの絞り込みロジック（純関数）。UIから切り離してテストできるようにする。
//
// 狙い：検索窓に「肉系」「魚」「ヘルシー」のような“ざっくりした言葉”を入れても効くこと。
// 料理名や材料名にその単語が入っていることは稀なので、言葉を具体的な食材名の集合に展開してから照合する。

import { ingredientMatches, type Recipe } from "./recipe";

/** 主材料の系統 */
export type MainKind = "肉" | "魚介" | "野菜";

const MEAT = [
  "鶏", "とりにく", "豚", "ぶたにく", "牛", "ぎゅうにく", "ひき肉", "挽肉", "ミンチ",
  "もも", "むね", "ささみ", "ロース", "バラ", "肩", "ヒレ", "レバー", "ラム", "ジンギスカン",
  "ハム", "ベーコン", "ウインナー", "ソーセージ", "肉",
];
const SEAFOOD = [
  "鮭", "サーモン", "さけ", "さば", "鯖", "ぶり", "ブリ", "あじ", "アジ", "いわし", "イワシ",
  "たら", "タラ", "まぐろ", "マグロ", "かつお", "カツオ", "ツナ", "しらす", "白身魚", "魚",
  "えび", "エビ", "海老", "いか", "イカ", "たこ", "タコ", "あさり", "アサリ", "しじみ",
  "ホタテ", "帆立", "貝", "カニ", "かに", "刺身", "切り身", "ちくわ", "はんぺん",
];
const VEGETABLE = [
  "野菜", "キャベツ", "レタス", "トマト", "なす", "きゅうり", "大根", "だいこん",
  "にんじん", "人参", "玉ねぎ", "たまねぎ", "じゃがいも", "ピーマン", "パプリカ",
  "ほうれん草", "小松菜", "水菜", "もやし", "ブロッコリー", "アスパラ", "オクラ",
  "きのこ", "しめじ", "えのき", "しいたけ", "まいたけ", "ねぎ", "白菜", "ごぼう",
  "れんこん", "かぼちゃ", "豆腐", "納豆", "アボカド",
];

const KIND_KEYWORDS: Record<MainKind, string[]> = {
  肉: MEAT,
  魚介: SEAFOOD,
  野菜: VEGETABLE,
};

// 食材名に見えるが実際は違うもの。判定の前に取り除く。
//  例：「タコライス」の"タコ"はたこ、「かつお節」は出汁であって魚料理ではない。
const FALSE_FRIENDS = [
  "タコライス", "タコス", "かつお節", "かつおぶし", "鰹節", "だしの素", "白だし",
  "オイスターソース", "ナンプラー", "アンチョビペースト", "鶏がらスープ", "鶏ガラ",
  "魚醤", "エビチリソース",
];

function stripFalseFriends(text: string): string {
  let t = text;
  for (const w of FALSE_FRIENDS) t = t.split(w).join("");
  return t;
}

/** 材料に「その系統の食材」が含まれるか（基本調味料は主材料とみなさない） */
function hasKind(recipe: Recipe, kind: MainKind): boolean {
  const words = KIND_KEYWORDS[kind];
  return recipe.ingredients.some((i) => {
    if (i.basicSeasoning) return false;
    const name = stripFalseFriends(i.name);
    return words.some((w) => name.includes(w));
  });
}

/**
 * そのレシピが該当する主材料の系統。
 * 「野菜」は“野菜が入っている”ではなく **肉も魚介も使わない＝野菜中心** の意味にする
 * （肉入り野菜炒めを「野菜」で絞ったときに出てこない方が使う側の期待に合う）。
 */
export function kindsOf(recipe: Recipe): MainKind[] {
  const out: MainKind[] = [];
  const meat = hasKind(recipe, "肉");
  const sea = hasKind(recipe, "魚介");
  if (meat) out.push("肉");
  if (sea) out.push("魚介");
  if (!meat && !sea && hasKind(recipe, "野菜")) out.push("野菜");
  return out;
}

// 「肉」「魚」のような“系統”の言葉は、単語照合ではなく kindsOf の判定に回す。
// 単語照合だと「タコライス」が魚介、「かつお節入りサラダ」が魚料理になってしまうため。
const KIND_TRIGGERS: [MainKind, string[]][] = [
  ["肉", ["肉", "肉系", "お肉", "にく"]],
  ["魚介", ["魚", "魚系", "魚介", "さかな", "シーフード", "海鮮"]],
  ["野菜", ["野菜", "やさい", "ベジ", "ヘルシー", "野菜系"]],
];

/** その検索語が主材料の系統を指しているか */
export function kindTriggerOf(term: string): MainKind | null {
  const t = term.trim().toLowerCase();
  for (const [kind, triggers] of KIND_TRIGGERS) {
    if (triggers.some((k) => k.toLowerCase() === t)) return kind;
  }
  return null;
}

// ざっくりした検索語 → 実際に探す語の展開表。
// 左のどれかに一致したら、右のいずれかを含むレシピを拾う。
const QUERY_EXPANSIONS: [string[], string[]][] = [
  [["さっぱり", "あっさり", "軽い"], ["さっぱり", "あっさり"]],
  [["がっつり", "ガッツリ", "こってり", "がっつり系"], ["ガッツリ", "こってり"]],
  [["時短", "簡単", "早い", "すぐ"], ["15", "簡単", "時短", "5分", "10分"]],
  [["ご飯", "ごはん", "米"], ["ご飯", "丼", "チャーハン", "リゾット", "ライス"]],
  [["麺", "めん"], ["麺", "パスタ", "スパゲ", "うどん", "そば", "ラーメン", "スパゲッティ"]],
];

/** 検索語1つを、実際に照合する語の候補に広げる */
export function expandTerm(term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  for (const [triggers, words] of QUERY_EXPANSIONS) {
    if (triggers.some((k) => k.toLowerCase() === t)) return words;
  }
  return [t];
}

/** レシピを検索対象の1本のテキストにする（料理名・キャッチ・材料・タグ） */
function haystackOf(recipe: Recipe): string {
  return [
    recipe.name,
    recipe.catch,
    ...recipe.ingredients.map((i) => i.name),
    recipe.tags.cuisine ?? "",
    recipe.tags.heaviness ?? "",
    recipe.tags.staple ?? "",
    recipe.tags.cookTime ? `${recipe.tags.cookTime}分` : "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * 検索語にマッチするか。
 * 空白区切りは AND（「肉 さっぱり」＝肉を使うさっぱり系）。
 */
export function matchesQuery(recipe: Recipe, query: string): boolean {
  const terms = query.trim().split(/[\s　]+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystackOf(recipe);
  const kinds = kindsOf(recipe);
  return terms.every((term) => {
    // 「肉」「魚」等は材料から系統を判定する（文字列一致だと誤爆するため）
    const kind = kindTriggerOf(term);
    if (kind) return kinds.includes(kind);
    const words = expandTerm(term);
    return words.some((w) => hay.includes(w.toLowerCase()));
  });
}

/** 期限が近い（🔴🟡）食材を使えるレシピか */
export function usesExpiring(recipe: Recipe, expiringNames: string[]): boolean {
  if (expiringNames.length === 0) return false;
  return recipe.ingredients.some((i) =>
    expiringNames.some((n) => ingredientMatches(n, i.name)),
  );
}

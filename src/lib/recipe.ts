// レシピ（Cook Notes 相当）のドメインモデルと純粋ヘルパ。
// /meal スキルの Cook Notes フォーマット（材料グルーピング・工程に分量・余り保存・出典）をそのまま型にする。

export type Cuisine = "和" | "洋" | "中" | "アジアン";
export type Heaviness = "ガッツリ" | "さっぱり" | "あっさり";
export type StapleType = "ご飯" | "麺" | "パン";
export type CookTimeBucket = 15 | 30 | 60;

export interface RecipeIngredient {
  name: string;
  amount: string; // 「大さじ4」「1/2個」。工程内にも再掲する
  group?: string; // 「主材料」「ソース」「仕上げ」等のグルーピング
  toBuy?: boolean; // ★買い足し
  basicSeasoning?: boolean; // 塩・こしょう等。Step 5.5 の網羅確認対象
}

export interface RecipeStep {
  title: string; // 「1. 下準備」
  text: string; // その工程の手順（分量を再掲する）
  tip?: string; // 💡 一言コツ
}

export interface LeftoverStorage {
  ingredient: string;
  method: string; // 冷蔵/冷凍 + 下処理 + 日持ち目安
}

export interface RecipeSource {
  label: string; // 「リュウジのバズレシピ」「クックパッド殿堂」
  url: string;
  popularity?: string; // 「つくれぽ1,200件」「YouTube320万回」
}

export interface RecipeTags {
  cuisine?: Cuisine;
  heaviness?: Heaviness;
  staple?: StapleType;
  cookTime?: CookTimeBucket;
}

export interface Recipe {
  id: string;
  name: string;
  emoji: string;
  image?: string; // 料理写真（/public 配下のパス or URL）
  kcal?: number; // 目安カロリー
  catch: string; // 1行キャッチ
  servings: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  sideDishes?: string[]; // 合わせる主食・副菜
  leftoverStorage: LeftoverStorage[];
  variations?: string[]; // アレンジ・保存
  sources: RecipeSource[];
  tags: RecipeTags;
  createdAt: number;
  madeCount?: number;
}

/** 買い足し（★toBuy）材料だけを返す */
export function ingredientsToBuy(recipe: Recipe): RecipeIngredient[] {
  return recipe.ingredients.filter((i) => i.toBuy);
}

/** 料理名から画像を自動生成するURL（Pollinations＝キー不要）。AI/ユーザー追加レシピ用 */
export function generatedImageUrl(name: string): string {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) % 100000;
  const prompt = `${name}、プロの料理写真、おいしそう、自然光、food photography`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=600&height=450&nologo=true&seed=${seed}`;
}

// カタカナ→ひらがな（タマネギ＝たまねぎ を同一視するため）
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

// 食材の表記ゆれ辞書：各行の先頭が代表表記、残りが別表記（正規化後＝小文字・かな化済みの形で記載）。
const SYNONYM_GROUPS: string[][] = [
  ["たまねぎ", "玉ねぎ", "玉葱", "おにおん"],
  ["にんじん", "人参"],
  ["だいこん", "大根"],
  ["たまご", "卵", "玉子"],
  ["ながねぎ", "長ねぎ", "長葱", "長ネギ"],
  ["ねぎ", "葱"],
  ["なす", "茄子"],
  ["きゅうり", "胡瓜"],
  ["じゃがいも", "じゃが芋", "馬鈴薯"],
  ["さつまいも", "さつま芋", "薩摩芋"],
  ["かぼちゃ", "南瓜"],
  ["にんにく", "大蒜"],
  ["しょうが", "生姜"],
  ["ピーマン", "ぴーまん"],
  ["とりにく", "鶏肉", "鳥肉", "とり肉"],
  ["ぶたにく", "豚肉"],
  ["ぎゅうにく", "牛肉"],
  ["ひきにく", "挽肉", "ひき肉"],
  ["しょうゆ", "醤油"],
  ["みそ", "味噌"],
  ["さとう", "砂糖"],
  ["しお", "塩"],
  ["こしょう", "胡椒", "こしょー"],
  ["さけ", "鮭", "しゃけ"],
  ["とうふ", "豆腐"],
  ["ごま", "胡麻"],
];
// 別表記→代表表記の置換リスト（長い別表記から適用＝部分置換でも壊れない）。
// 名前に数量が混ざる（例「玉ねぎ1個」）ケースでも部分一致が効くよう、完全一致ではなく置換にする。
const SYNONYM_REPLACERS: [string, string][] = (() => {
  const list: [string, string][] = [];
  for (const group of SYNONYM_GROUPS) {
    const canon = group[0];
    for (const v of group.slice(1)) {
      list.push([kataToHira(v.toLowerCase()), canon]);
    }
  }
  return list.sort((a, b) => b[0].length - a[0].length);
})();

/** 材料名をマッチング用に正規化（表記ゆれ・全角空白・括弧書き・かな/漢字を吸収） */
export function normalizeName(name: string): string {
  let s = kataToHira(
    name
      .toLowerCase()
      .replace(/[（(].*?[)）]/g, "") // 括弧書きを除去
      .replace(/\s|　/g, "")
      .replace(/[・,、]/g, "")
      .trim(),
  );
  for (const [variant, canon] of SYNONYM_REPLACERS) {
    if (s.includes(variant)) s = s.split(variant).join(canon);
  }
  return s;
}

/** 2つの食材名が同一食材を指すか（部分一致で寛容に判定） */
export function ingredientMatches(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

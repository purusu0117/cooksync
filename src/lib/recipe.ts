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

/** 材料名をマッチング用に正規化（表記ゆれ・全角空白・括弧書きを吸収） */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, "") // 括弧書きを除去
    .replace(/\s|　/g, "")
    .replace(/[・,、]/g, "")
    .trim();
}

/** 2つの食材名が同一食材を指すか（部分一致で寛容に判定） */
export function ingredientMatches(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

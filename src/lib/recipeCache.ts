// 共有レシピプール ＝ AI原価を下げる最大のレバー。
//
// 発想：冷蔵庫は個人ごとでも「材料の組み合わせ → 料理」の写像は全ユーザーで共有できる。
//       同じ「鶏むね×ピーマン×中華×30分」を1,000人が探索するたびにAPIを叩くのは純粋な無駄。
//       一度生成したレシピをサーバー側のプールに貯め、条件が合う人には **API 0円** で返す。
//
// 【キーは粗く、絞り込みは細かく】が肝。
//   冷蔵庫の中身をそのままキーにすると完全一致がまず起きずヒット率が0になる。
//   そこでキーは「ジャンル・好み・主食・時間・人数・買い物方針・作りたいもの」だけにし、
//   「その人の冷蔵庫で本当に作れるか」はプールから取り出したあとコード側で判定する（無料）。
//
// レシピ資産が溜まるほど原価が下がる＝スケールするほど利益率が上がる。
// 設計根拠: .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";
import { ingredientMatches, isSameDish, normalizeDishName } from "./recipe";

/** AIが返す生のレシピ（storage前の形）。ここでは必要な部分だけ見る。 */
export interface PooledRecipe {
  name?: string;
  ingredients?: {
    name?: string;
    toBuy?: boolean;
    basicSeasoning?: boolean;
  }[];
  [k: string]: unknown;
}

export interface PoolQuery {
  wish?: string;
  fridge?: string[];
  expiring?: string[];
  servings?: number;
  filters?: {
    cuisine?: string;
    heaviness?: string;
    staple?: string;
    cookTime?: number;
  };
  avoid?: string[];
  existing?: string[];
  shopMode?: "stock" | "buy";
}

const POOL_TTL_SEC = 120 * 24 * 3600; // レシピは腐らないので長め
const POOL_MAX = 60; // 1キーあたりの保持数（古いものから捨てる）
const WANT = 3; // 返す候補数
const MIN_HIT = 2; // これ未満しか揃わなければ生成にフォールバック

/** 調理時間はバケット化してキーの分散を防ぐ（29分と30分を別キーにしない） */
function timeBucket(min?: number): string {
  if (!min) return "any";
  if (min <= 15) return "15";
  if (min <= 30) return "30";
  return "60";
}

/** 「作りたいもの」は自由入力なので正規化して丸める（表記ゆれで別キーにしない） */
function wishKey(wish?: string): string {
  const w = (wish ?? "").trim();
  if (!w) return "any";
  return normalizeDishName(w).slice(0, 24) || "any";
}

/** キーの素（デバッグ・テスト用に可視化しておく） */
export function poolKeyParts(q: PoolQuery): string {
  const f = q.filters ?? {};
  return [
    q.shopMode === "buy" ? "buy" : "stock",
    `s${q.servings && q.servings > 0 ? q.servings : 2}`,
    f.cuisine || "any",
    f.heaviness || "any",
    f.staple || "any",
    timeBucket(f.cookTime),
    wishKey(q.wish),
  ].join("|");
}

/** プールのキー。**冷蔵庫の中身は入れない**（入れるとヒット率が0になる） */
export function poolKey(q: PoolQuery): string {
  return createHash("sha1").update(poolKeyParts(q)).digest("hex").slice(0, 20);
}

// ---- 保存層（公開=Redis / ローカル=ファイル） ----
// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
// ⚠️ モジュール読み込み時に固定すると、テストが環境変数を設定する前に確定してしまい、
//    **実際に .data/ の中身が消える事故が起きた**（2026-08-01・監査で発覚）。呼び出しごとに読む。
function dataDir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
const FILE = path.join(dataDir(), "recipe-pool.json");

async function loadPool(key: string): Promise<PooledRecipe[]> {
  try {
    if (redis) {
      const v = await redis.get<unknown>(`cooksync:rpool:${key}`);
      if (!v) return [];
      const arr = typeof v === "string" ? JSON.parse(v) : v;
      return Array.isArray(arr) ? (arr as PooledRecipe[]) : [];
    }
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<
      string,
      PooledRecipe[]
    >;
    return all[key] ?? [];
  } catch {
    return [];
  }
}

async function savePool(key: string, list: PooledRecipe[]): Promise<void> {
  const trimmed = list.slice(-POOL_MAX);
  try {
    if (redis) {
      await redis.set(`cooksync:rpool:${key}`, JSON.stringify(trimmed), {
        ex: POOL_TTL_SEC,
      });
      return;
    }
    await fs.mkdir(dataDir(), { recursive: true });
    let all: Record<string, PooledRecipe[]> = {};
    try {
      all = JSON.parse(await fs.readFile(FILE, "utf8"));
    } catch {
      /* 初回 */
    }
    all[key] = trimmed;
    await fs.writeFile(FILE, JSON.stringify(all), "utf8");
  } catch {
    /* プール保存の失敗は本流を止めない */
  }
}

/** そのレシピが「この人の冷蔵庫だけで」作れるか。
 *  基本調味料と、AIが買い足し前提(toBuy)にした材料は在庫チェックの対象外。 */
function makeableFrom(recipe: PooledRecipe, fridge: string[]): boolean {
  const need = (recipe.ingredients ?? []).filter(
    (i) => i && i.name && !i.basicSeasoning && i.toBuy !== true,
  );
  if (need.length === 0) return false; // 材料が読めないものは配らない
  return need.every((i) => fridge.some((f) => ingredientMatches(f, i.name!)));
}

/** 期限が近い食材をいくつ使うか（多いものを優先して返したい） */
function expiringScore(recipe: PooledRecipe, expiring: string[]): number {
  if (expiring.length === 0) return 0;
  const names = (recipe.ingredients ?? []).map((i) => i?.name).filter(Boolean) as string[];
  return expiring.filter((e) => names.some((n) => ingredientMatches(e, n))).length;
}

/** 名前がユーザーの既存レシピ／除外リストに当たるか */
function isExcluded(recipe: PooledRecipe, blocked: string[]): boolean {
  const name = recipe.name;
  if (!name) return true;
  return blocked.some((b) => isSameDish(b, name));
}

export interface PoolHit {
  recipes: PooledRecipe[];
  key: string;
}

/**
 * プールから条件に合うレシピを取り出す。
 * 見つからない（MIN_HIT未満）なら null を返す＝呼び出し側がAI生成にフォールバックする。
 */
export async function takeFromPool(q: PoolQuery): Promise<PoolHit | null> {
  const key = poolKey(q);
  const pool = await loadPool(key);
  if (pool.length === 0) return null;

  const fridge = q.fridge ?? [];
  const expiring = q.expiring ?? [];
  const blocked = [...(q.existing ?? []), ...(q.avoid ?? [])];
  const stock = q.shopMode !== "buy";

  const candidates = pool
    .filter((r) => !isExcluded(r, blocked))
    // 在庫モードのときだけ「その冷蔵庫で作れるか」を検査する。
    // 買い物モードは新しく買う前提なので在庫制約なし。
    .filter((r) => (stock ? makeableFrom(r, fridge) : true));

  if (candidates.length < MIN_HIT) return null;

  // 期限が近い食材を多く使うものを優先。同点なら主材料を散らす。
  const seen = new Set<string>();
  const picked: PooledRecipe[] = [];
  for (const r of candidates.sort(
    (a, b) => expiringScore(b, expiring) - expiringScore(a, expiring),
  )) {
    const main = (r.ingredients ?? []).find(
      (i) => i && i.name && !i.basicSeasoning,
    )?.name;
    const mk = main ? main : `#${picked.length}`;
    if (seen.has(mk)) continue; // 3案が同じ主材料になるのを防ぐ
    seen.add(mk);
    picked.push(r);
    if (picked.length >= WANT) break;
  }
  // 主材料の分散で減りすぎたら重複を許して補充
  if (picked.length < MIN_HIT) {
    for (const r of candidates) {
      if (picked.includes(r)) continue;
      picked.push(r);
      if (picked.length >= WANT) break;
    }
  }

  return picked.length >= MIN_HIT ? { recipes: picked, key } : null;
}

/** 生成したレシピをプールに足す（同名は上書きせず捨てる）。 */
export async function addToPool(q: PoolQuery, recipes: unknown[]): Promise<void> {
  const list = (recipes ?? []).filter(
    (r): r is PooledRecipe =>
      !!r && typeof r === "object" && typeof (r as PooledRecipe).name === "string",
  );
  if (list.length === 0) return;
  const key = poolKey(q);
  const pool = await loadPool(key);
  const merged = [...pool];
  for (const r of list) {
    if (merged.some((p) => p.name && isSameDish(p.name, r.name!))) continue;
    merged.push(r);
  }
  if (merged.length === pool.length) return; // 増えていないなら書かない
  await savePool(key, merged);
}

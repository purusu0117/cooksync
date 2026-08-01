// 食材の日持ちをAIに推定させる（決定論テーブルに無い食材のフォールバック）。
// 返すのは「日数」だけ＝クライアントが購入日に足して期限にする。
// 同じ食材を何度も聞かないよう、サーバー側でキャッシュする（Redis→無ければファイル）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { askClaudeForJsonNoWeb } from "@/lib/ai";
import { redis } from "@/lib/kv";
import { guardAi } from "@/lib/quotaServer";
import { estimateExpiryEstYen } from "@/lib/aiCost";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  items?: { name: string; opened?: boolean }[];
}

export interface ExpiryEstimate {
  name: string;
  days: number;
  storage?: string; // 冷蔵 / 冷凍 / 常温
  note?: string;
}

const CACHE_FILE = path.join(process.cwd(), ".data", "expiry-cache.json");
const memCache = new Map<string, ExpiryEstimate>();
let fileLoaded = false;

function keyOf(name: string, opened: boolean): string {
  return `${name.trim()}|${opened ? "opened" : "sealed"}`;
}

async function loadFileCache(): Promise<void> {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, ExpiryEstimate>;
    for (const [k, v] of Object.entries(obj)) memCache.set(k, v);
  } catch {
    /* 初回は無い */
  }
}

async function saveFileCache(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(
      CACHE_FILE,
      JSON.stringify(Object.fromEntries(memCache), null, 2),
      "utf8",
    );
  } catch {
    /* 読み取り専用FS（Vercel）ではメモリ/Redisだけで動く */
  }
}

async function getCached(key: string): Promise<ExpiryEstimate | null> {
  if (redis) {
    const v = await redis.get<unknown>(`expiry:${key}`);
    if (v) return (typeof v === "string" ? JSON.parse(v) : v) as ExpiryEstimate;
    return null;
  }
  await loadFileCache();
  return memCache.get(key) ?? null;
}

async function setCached(key: string, val: ExpiryEstimate): Promise<void> {
  if (redis) {
    await redis.set(`expiry:${key}`, JSON.stringify(val), { ex: 180 * 24 * 3600 });
    return;
  }
  memCache.set(key, val);
  await saveFileCache();
}

function buildPrompt(items: { name: string; opened?: boolean }[]): string {
  // 食材の対応づけは「通し番号(no)」で行う。名前を返させると、モデルが行ごと
  // コピーしたり別表記・別の食材に書き換えたりして取り違えが起きるため。
  const lines = items.map(
    (i, idx) =>
      `${idx + 1}. ${i.name} / 状態: ${i.opened ? "開封後" : "未開封（買ってきた状態）"}`,
  );
  return [
    "あなたは食品保存の専門家です。次の食品それぞれについて、日本の家庭で普通に保存した場合に",
    "「安全かつ美味しく食べられる目安の日数」を答えてください。",
    "",
    ...lines,
    "",
    "ルール:",
    "- no は上のリストの番号をそのまま返す（対応づけに使う）。",
    "- days は購入日（開封後の場合は開封日）からの日数。整数。",
    "- 缶詰・乾物・砂糖・塩など年単位で保存できるものは、遠慮せず 365 / 1095 / 3650 のように大きい数を返す。90日で頭打ちにしない。",
    "- 生鮮（肉・魚・葉物）は短く正確に（ひき肉1日、鶏肉2日など）。",
    "- storage は 冷蔵 / 冷凍 / 常温 のいずれか。note は保存のコツを20文字以内で。",
    "- 食品でないもの・判断できないものは days: 0 を返す。",
    "",
    '出力は次のJSONだけ（前後に文章やコードフェンスを付けない）: {"items":[{"no":number,"days":number,"storage":string,"note":string}]}',
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const items = (body.items ?? [])
      .filter((i) => i && typeof i.name === "string" && i.name.trim())
      .slice(0, 40);
    if (items.length === 0) return Response.json({ results: [] });

    // キャッシュ済みは即返し、残りだけAIに聞く
    const results: ExpiryEstimate[] = [];
    // 対応づけできずに捨てた項目（デバッグ用に返す）
    const dropped: string[] = [];
    const ask: { name: string; opened?: boolean }[] = [];
    for (const i of items) {
      const cached = await getCached(keyOf(i.name, !!i.opened));
      if (cached) results.push(cached);
      else ask.push(i);
    }

    if (ask.length > 0) {
      // 公開時のコスト暴走ガード（ローカル＝Max枠は対象外）
      if (redis) {
        const cap = Number(process.env.COOKSYNC_MONTHLY_AI_CAP) || 300;
        const month = new Date().toISOString().slice(0, 7);
        const k = `cooksync:aiquota:${month}`;
        const n = await redis.incr(k);
        if (n === 1) await redis.expire(k, 40 * 24 * 3600);
        if (n > cap) {
          return Response.json({ results, capped: true });
        }
      }

      // 予算・利用者日次・IPの防御。キャッシュに当たった分は原価0なので、**実際にAIを呼ぶ直前**に見る。
      // 原価は固定値ではなく**実際にAIへ聞く件数**でスケールさせる（監査 3。40件を¥0.3で申告していた）。
      const g = await guardAi(
        request,
        estimateExpiryEstYen(ask.length),
        request.headers.get("x-cooksync-uid") ?? undefined,
      );
      if (!g.ok) return Response.json({ results, capped: true, reason: g.message });

      const out = await askClaudeForJsonNoWeb<{ items?: unknown[] }>(
        buildPrompt(ask),
      );
      const list = Array.isArray(out.items) ? out.items : [];
      for (const raw of list) {
        const r = raw as { no?: number; days?: number; storage?: string; note?: string };
        if (typeof r.days !== "number" || !isFinite(r.days) || r.days <= 0) continue;
        // 番号で元の食材に戻す。名前はこちらが持っているものを使う（モデルの表記に引きずられない）
        const src = typeof r.no === "number" ? ask[r.no - 1] : undefined;
        if (!src) {
          dropped.push(String(r.no ?? "?"));
          continue;
        }
        const est: ExpiryEstimate = {
          name: src.name,
          days: Math.round(r.days),
          storage: typeof r.storage === "string" ? r.storage : undefined,
          note: typeof r.note === "string" ? r.note : undefined,
        };
        await setCached(keyOf(est.name, !!src.opened), est);
        results.push(est);
      }
    }

    return Response.json(dropped.length > 0 ? { results, dropped } : { results });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "estimate failed", results: [] },
      { status: 500 },
    );
  }
}

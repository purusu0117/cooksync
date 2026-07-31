// 「まとめて買う」導線のクリック数。**個人を識別する情報は一切持たない**。
//
// なぜ要るか：送客先は複数あり、置き場所も複数（買い物リスト／レシピ詳細）ある。
// どれが押されているか分からないと、増やすべき導線と外すべき導線を勘で決めることになる。
// AI原価（aiCost.ts）と同じで、収益の話は実測が無いと机上の空論で終わる。
//
// ⚠️ ここの数字は**成果の数ではない**。報酬が確定するのはASP（A8.net等）の管理画面の方で、
//    こちらが分かるのは「アプリ側で何回押されたか」だけ。CVR＝ASPの成果数 ÷ この数、で見る。
//
// 保存するもの：月・送客先・置き場所・回数の4つだけ。
// uid も IP もユーザーエージェントも持たない（持てば個人情報の扱いが増えるだけで、
// 導線の良し悪しの判断には1ミリも要らない）。

import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";
import type { PartnerId, Placement } from "./affiliate";

// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
// ⚠️ モジュール読み込み時に固定すると、テストが環境変数を設定する前に確定してしまい、
//    **実際に .data/ の中身が消える事故が起きた**（2026-08-01・監査で発覚）。呼び出しごとに読む。
function dataDir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
const FILE = path.join(dataDir(), "affiliate.json");

export interface PartnerClicks {
  clicks: number;
  /** 置き場所ごとの内訳（shopping / recipe） */
  byPlacement: Record<string, number>;
}

export interface AffiliateSummary {
  month: string;
  clicks: number;
  byPartner: Record<string, PartnerClicks>;
}

function month(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function emptySummary(m: string): AffiliateSummary {
  return { month: m, clicks: 0, byPartner: {} };
}

async function readFileDb(): Promise<Record<string, AffiliateSummary>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

/**
 * 1クリックを記録する。**失敗しても本流を止めない**（計測のために送客を止めない）。
 * 呼び出し側は await せずに投げっぱなしでよい。
 */
export async function logAffiliateClick(
  partner: PartnerId,
  placement: Placement,
): Promise<void> {
  const m = month();
  try {
    if (redis) {
      const k = `cooksync:aff:${m}`;
      await Promise.all([
        redis.hincrby(k, "clicks", 1),
        redis.hincrby(k, `${partner}:clicks`, 1),
        redis.hincrby(k, `${partner}:${placement}`, 1),
      ]);
      // AI原価ログと同じ保持期間（約13か月）。前年同月と比べられる長さ。
      await redis.expire(k, 400 * 24 * 3600);
      return;
    }
    const db = await readFileDb();
    const cur = db[m] ?? emptySummary(m);
    const p = cur.byPartner[partner] ?? { clicks: 0, byPlacement: {} };
    p.clicks += 1;
    p.byPlacement[placement] = (p.byPlacement[placement] ?? 0) + 1;
    cur.byPartner[partner] = p;
    cur.clicks += 1;
    db[m] = cur;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db), "utf8");
  } catch {
    /* 計測の失敗で本流を止めない */
  }
}

/** 今月（または指定月）のクリック内訳を読む。/api/admin/stats 用。 */
export async function readAffiliateSummary(
  m: string = month(),
  partners: readonly string[] = [],
): Promise<AffiliateSummary> {
  try {
    if (redis) {
      const h = await redis.hgetall<Record<string, string | number>>(
        `cooksync:aff:${m}`,
      );
      if (!h) return emptySummary(m);
      const num = (k: string) => Number(h[k] ?? 0) || 0;
      const out = emptySummary(m);
      out.clicks = num("clicks");
      // Redisのhashはフィールド名を知らないと引けないので、既知の送客先だけ舐める
      for (const id of partners) {
        const clicks = num(`${id}:clicks`);
        if (!clicks) continue;
        const byPlacement: Record<string, number> = {};
        for (const pl of ["shopping", "recipe"]) {
          const n = num(`${id}:${pl}`);
          if (n) byPlacement[pl] = n;
        }
        out.byPartner[id] = { clicks, byPlacement };
      }
      return out;
    }
    const db = await readFileDb();
    return db[m] ?? emptySummary(m);
  } catch {
    return emptySummary(m);
  }
}

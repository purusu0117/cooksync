// アカウントの削除。**アプリ内から本人が実行できる**必要がある
// （App Store審査ガイドライン 5.1.1(v)：アカウント作成をさせるアプリは、
//  アプリ内からアカウント削除を開始できるようにしなければならない）。
//
// 消すもの（Redis／ローカルJSONの両方）:
//   - cooksync:users のレコード（メール → dataId の対応）
//   - cooksync:u:<dataId>  … 冷蔵庫・買い物・レシピ・献立・評価などの本体データ
//   - cooksync:push:<uid>  … プッシュ通知の購読
//   - cooksync:usage:<uid>:<YYYY-MM> … AI利用回数のカウンタ（当月・前月）
//
// ⚠️ 削除は**セッションCookieを持っている本人のみ**が実行できる。
//    クライアントが送る uid は書き換えできるので判断材料にしない。

import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";
import { clearSessionCookie, readCookie, SESSION_COOKIE, verifySession } from "@/lib/session";
import { deleteUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DIR, "store.json");

/** 当月と前月の "YYYY-MM"（AI利用カウンタのキーに使う） */
function recentMonths(): string[] {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return [now.toISOString().slice(0, 7), prev.toISOString().slice(0, 7)];
}

/** Redisのキーに使える形へ（他ファイルの userKey/subsKey と同じ規則） */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
}

export async function POST(request: Request) {
  const s = verifySession(readCookie(request, SESSION_COOKIE));
  if (!s) {
    return Response.json(
      { error: "ログインが確認できませんでした。ログインし直してからお試しください。" },
      { status: 401 },
    );
  }

  try {
    if (redis) {
      const keys = [
        `cooksync:u:${safeId(s.dataId)}`,
        `cooksync:push:${safeId(s.uid)}`,
        `cooksync:push:${safeId(s.dataId)}`,
        ...recentMonths().map((m) => `cooksync:usage:${safeId(s.uid)}:${m}`),
      ];
      await redis.del(...keys);
      await redis.srem("cooksync:premium", s.uid).catch(() => {});
      if (s.email) await deleteUser(s.email);
    } else {
      // ローカル（.data/）：ユーザーレジストリと本体データを消す
      if (s.email) await deleteUser(s.email);
      await fs.rm(STORE_FILE, { force: true }).catch(() => {});
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "削除に失敗しました。" },
      { status: 500 },
    );
  }

  // 削除できたらセッションも即時失効させる（消えたアカウントで操作を続けさせない）
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

// アカウントの削除。**アプリ内から本人が実行できる**必要がある
// （App Store審査ガイドライン 5.1.1(v)：アカウント作成をさせるアプリは、
//  アプリ内からアカウント削除を開始できるようにしなければならない）。
//
// 消すもの（Redis／ローカルJSONの両方）:
//   - cooksync:users のレコード（メール → dataId の対応）
//   - cooksync:u:<dataId>  … 冷蔵庫・買い物・レシピ・献立・評価などの本体データ
//   - cooksync:push:<uid>  … Web Push の購読
//   - cooksync:apns:<uid> / cooksync:apnsowner:<token> … iOSの端末トークン
//   - cooksync:usage:<uid>:<YYYY-MM> … AI利用回数のカウンタ（当月・前月）
//   - cooksync:premium の所属
//
// ⚠️ 削除は**セッションCookieを持っている本人のみ**が実行できる。
//    クライアントが送る uid は書き換えできるので判断材料にしない。
//
// 2026-08-01 の監査で直した3点（H-10）:
//   (a) ローカル経路が**全ユーザー共通のファイルごと** rm していた → uidのバケツだけ消す
//   (b) 前月キーの計算がUTC変換で9時間巻き戻り、常に「2ヶ月前」を指していた
//       → quotaServer.recentUsageMonths() に一本化（キーを作る側と同じ基準）
//   (c) APNsの端末トークン（cooksync:apns:*）が消し漏れ、削除後も通知が届きえた
//       → purgePushFor() で購読・トークン・所有者マップまで消す

import { redis } from "@/lib/kv";
import { purgePushFor } from "@/lib/pushServer";
import { recentUsageMonths } from "@/lib/quotaServer";
import { clearSessionCookie, readCookie, SESSION_COOKIE, verifySession } from "@/lib/session";
import { localDeleteUser } from "@/lib/storeLocal";
import { deleteUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

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
    // 通知は uid / dataId の両方で登録されうるので両方消す（購読・端末トークン・所有者マップ）
    await purgePushFor(s.uid).catch(() => {});
    if (s.dataId !== s.uid) await purgePushFor(s.dataId).catch(() => {});

    if (redis) {
      const months = recentUsageMonths();
      const keys = [
        `cooksync:u:${safeId(s.dataId)}`,
        ...months.map((m) => `cooksync:usage:${safeId(s.uid)}:${m}`),
        ...months.map((m) => `cooksync:usage:${safeId(s.dataId)}:${m}`),
      ];
      await redis.del(...Array.from(new Set(keys)));
      await redis.srem("cooksync:premium", s.uid).catch(() => {});
      if (s.dataId !== s.uid) {
        await redis.srem("cooksync:premium", s.dataId).catch(() => {});
      }
      if (s.email) await deleteUser(s.email);
    } else {
      // ローカル（.data/）：ユーザーレジストリと**この人のバケツだけ**を消す
      if (s.email) await deleteUser(s.email);
      await localDeleteUser(s.dataId);
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

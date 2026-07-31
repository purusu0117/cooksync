// 管理用エンドポイントの鍵チェック（大翔専用）。
// /api/admin/* が個別に持っていた判定と同じ規則をここにも置く：
//   ・COOKSYNC_ADMIN_KEY が未設定 or 16文字未満なら **誰も通さない**（fail closed）
//   ・長さの違いで早期returnしないよう固定時間で比較する

import { timingSafeEqual } from "crypto";

export function adminKeyMatches(given: string | null | undefined): boolean {
  const expected = process.env.COOKSYNC_ADMIN_KEY;
  if (!expected || expected.length < 16) return false;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `?key=` を見る（管理画面と同じ渡し方） */
export function isAdminRequest(request: Request): boolean {
  return adminKeyMatches(new URL(request.url).searchParams.get("key"));
}

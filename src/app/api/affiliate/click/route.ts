// 「まとめて買う」導線が押されたことだけを数える。
//
// 受け取るのは送客先IDと置き場所の2つだけ。uid・IP・買い物の中身は**受け取らない**
// （送らせない設計にしておけば、うっかり保存してしまう事故も起きない）。
//
// クライアントは navigator.sendBeacon で投げっぱなしにする＝レスポンスは読まれない。
// なので本文は返さず 204 を返す。不正な値は 400 で弾く（Redisのフィールド名になるため、
// 知らない文字列をそのままキーに使うとゴミを書き込まれる）。

import { isPartnerId, isPlacement } from "@/lib/affiliate";
import { logAffiliateClick } from "@/lib/affiliateStats";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      partner?: unknown;
      placement?: unknown;
    };
    if (!isPartnerId(body?.partner) || !isPlacement(body?.placement)) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    await logAffiliateClick(body.partner, body.placement);
  } catch {
    // JSONが壊れていても 400 は返さない。計測の失敗はユーザーに1ミリも影響しないので、
    // ここで例外を上げてログを汚す価値がない。
  }
  return new Response(null, { status: 204 });
}

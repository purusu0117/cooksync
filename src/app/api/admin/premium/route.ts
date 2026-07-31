// 管理用：プレミアム扱いにする uid の付け外し（大翔専用）。
//
// ⚠️ これが無かったせいで、**開発者本人も無料枠のまま**だった（2026-07-31 発覚）。
//    quotaServer は `cooksync:premium` の集合を見てフェアユース上限を切り替えるが、
//    その集合に uid を入れる手段がどこにも実装されていなかった。
//    ＝毎日使う大翔が「AIレシピ探索は月3回」で止まる状態。
//
// stats と同じく ?key=<秘密> で保護し、**未設定なら誰も通さない**（fail closed）。

import { timingSafeEqual } from "crypto";
import { redis } from "@/lib/kv";

export const dynamic = "force-dynamic";

function keyMatches(given: string | null): boolean {
  const expected = process.env.COOKSYNC_ADMIN_KEY;
  if (!expected || expected.length < 16) return false;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 現在のプレミアム一覧 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!keyMatches(url.searchParams.get("key"))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!redis) return Response.json({ error: "redis not configured" }, { status: 503 });
  const uids = await redis.smembers("cooksync:premium");
  return Response.json({ count: uids.length, uids });
}

/** 付ける／外す。 body: {uid, on} */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!keyMatches(url.searchParams.get("key"))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!redis) return Response.json({ error: "redis not configured" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { uid?: string; on?: boolean };
  const uid = (body.uid ?? "").trim();
  if (!uid) return Response.json({ error: "uid required" }, { status: 400 });

  if (body.on === false) {
    await redis.srem("cooksync:premium", uid);
  } else {
    await redis.sadd("cooksync:premium", uid);
  }
  const on = (await redis.sismember("cooksync:premium", uid)) === 1;
  return Response.json({ uid, premium: on });
}

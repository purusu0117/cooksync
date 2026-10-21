import { randomUUID } from "crypto";
import { createSession, identify, sessionCookie, readCookie, verifySession, SESSION_COOKIE } from "@/lib/session";
import { activateKitchen, cancelKitchenOperation, commitKitchen, copyVerifiedDeviceKitchen, exportDigest, readKitchenData } from "@/lib/kitchen/server";
import { decodeCommand, KitchenError, object } from "@/lib/kitchen/engine";
import { LEGACY_MUTABLE } from "@/lib/kitchen/model";
import { aiConfiguration } from "@/lib/kitchen/aiBudget";
import { requireSameOrigin } from "@/lib/kitchen/identity";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "Vary": "Cookie" };
function identity(request: Request) {
  const account = identify(request);
  if (account.trusted) return account;
  const guest = verifySession(readCookie(request, "cooksync_kitchen_guest"));
  return guest ? { ...account, uid: guest.uid, dataId: guest.dataId, trusted: true } : account;
}
function errorResponse(error: unknown): Response { return Response.json({ error: error instanceof KitchenError ? error.message : "保存処理を完了できませんでした。操作履歴を再確認してください" }, { status: error instanceof KitchenError ? error.status : 503, headers }); }
function verifiedDevice(request: Request) {
  const account = identify(request), guest = verifySession(readCookie(request, "cooksync_kitchen_guest"));
  if (!account.trusted || account.uid.startsWith("guest:") || !guest?.uid.startsWith("guest:") || account.dataId === guest.dataId) throw new KitchenError("ログイン中のアカウントと、この端末の署名付き保存先の両方を確認してください", 403);
  return { account: account.dataId, device: guest.dataId };
}
export async function GET(request: Request) {
  try {
    const user = identity(request);
    if (!user.trusted) return Response.json({ state: null, needsSession: true }, { headers });
    const result = await readKitchenData(user.dataId);
    const url = new URL(request.url);
    if (url.searchParams.has("device-copy")) {
      const verified = verifiedDevice(request), source = await readKitchenData(verified.device);
      if (!source.state) throw new KitchenError("この端末の新しい在庫管理データがありません", 404);
      return Response.json({ digest: exportDigest(source.state), sourceRevision: source.state.revision, locations: source.state.locations.map(l => l.name), lots: source.state.lots.length, plans: source.state.plans.length, transactions: source.state.transactions.length, canCopy: !result.state && !LEGACY_MUTABLE.some(k => Array.isArray(result.legacy[k]) && result.legacy[k].length) }, { headers });
    }
    if (url.searchParams.has("export") && result.state) return Response.json({ state: result.state, sha256: exportDigest(result.state), exportedAt: new Date().toISOString() }, { headers: { ...headers, "Content-Disposition": "attachment; filename=cooksync-kitchen-backup.json" } });
    const config = aiConfiguration();
    return Response.json({ state: result.state, isGuest: user.uid.startsWith("guest:"), legacyRevision: result.revision, legacyCounts: Object.fromEntries(LEGACY_MUTABLE.map(k => [k, Array.isArray(result.legacy[k]) ? result.legacy[k].length : 0])), owner: user.dataId, ai: { enabled: config.enabled, environment: config.environment, model: config.model } }, { headers });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new KitchenError("入力形式を確認してください", 415);
    const reader = request.body?.getReader(); if (!reader) throw new KitchenError("入力がありません");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 512 * 1024) { await reader.cancel(); throw new KitchenError("入力が大きすぎます", 413); } chunks.push(value); }
    const body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const user = identity(request);
    if (body.action === "guest") {
      if (user.trusted) return Response.json({ owner: user.dataId }, { headers });
      const owner = randomUUID();
      const token = createSession({ uid: `guest:${owner}`, dataId: owner });
      // Never adopt a client-supplied legacy ID: it is not proof of ownership.
      return Response.json({ owner }, { headers: { ...headers, "Set-Cookie": sessionCookie(token).replace(`${SESSION_COOKIE}=`, "cooksync_kitchen_guest=") } });
    }
    if (!user.trusted) throw new KitchenError("この端末の利用を開始するか、ログインしてください", 401);
    if (body.owner !== undefined && body.owner !== user.dataId) throw new KitchenError("利用者が変わりました。元の利用者で操作を確認してください", 409);
    if (body.action === "copy-device-to-account") {
      const verified = verifiedDevice(request);
      if (typeof body.digest !== "string" || !/^[a-f0-9]{64}$/.test(body.digest)) throw new KitchenError("コピー内容を再確認してください");
      return Response.json({ state: await copyVerifiedDeviceKitchen(verified.device, verified.account, body.digest) }, { headers });
    }
    if (body.action === "activate") {
      if (!Number.isSafeInteger(body.legacyRevision)) throw new KitchenError("移行内容を読み直してください", 409);
      if (body.deviceData && !user.uid.startsWith("guest:")) throw new KitchenError("端末コピーは新しい端末用保存先で確認してください", 409);
      return Response.json({ state: await activateKitchen(user.dataId, Number(body.legacyRevision), body.deviceData ? object(body.deviceData) : undefined, body.timeZone) }, { headers });
    }
    if (body.action === "cancel-operation") return Response.json({ state: await cancelKitchenOperation(user.dataId, decodeCommand(body.command)) }, { headers });
    return Response.json({ state: await commitKitchen(user.dataId, decodeCommand(body.command)) }, { headers });
  } catch (e) { return errorResponse(e); }
}

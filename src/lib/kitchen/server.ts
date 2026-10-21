import { redis, assertKvConfigured } from "../kv";
import { localPeek, localSetKey } from "../storeLocal";
import { KITCHEN_KEY, LEGACY_MUTABLE, type KitchenState } from "./model";
import { canonicalJSON, execute, initialState, KitchenError, timeZone, type decodeCommand } from "./engine";
import { createHash } from "crypto";
import { MAX_KITCHEN_BYTES } from "./limits";

function userKey(uid: string): string {
  // Existing account dataIds are UUIDs. Refuse lossy normalization and possible collisions.
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(uid)) throw new KitchenError("保存先の確認が必要です", 403);
  return `cooksync:u:${uid}`;
}
export async function readKitchenData(owner: string): Promise<{ state: KitchenState | null; legacy: Record<string, unknown>; revision: number }> {
  assertKvConfigured(); userKey(owner);
  let data: Record<string, unknown>, revision: number;
  if (redis) {
    data = await redis.hgetall<Record<string, unknown>>(userKey(owner)) || {};
    for (const [k, v] of Object.entries(data)) if (typeof v === "string") { try { data[k] = JSON.parse(v); } catch { /* legacy plain text */ } }
    revision = Number(data.__rev || 0);
  } else { const result = await localPeek(owner); data = result.data; revision = result.rev; }
  const value = data[KITCHEN_KEY];
  if (value && (typeof value !== "object" || (value as KitchenState).schema !== 3 || (value as KitchenState).owner !== owner)) throw new KitchenError("保存データを確認できません。上書きを停止しました", 503);
  if (value) {
    const state = value as KitchenState;
    if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !state.operations || ![state.locations, state.lots, state.plans, state.shopping, state.cooking, state.transactions, state.recipes].every(Array.isArray)) throw new KitchenError("保存データの構造が不正です。原本を保持して復旧してください", 503);
  }
  return { state: value ? value as KitchenState : null, legacy: data, revision };
}
const CAS = `
local current = tonumber(redis.call('HGET', KEYS[1], '__rev') or '0')
if current ~= tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3], '__rev', current + 1)
return 1
`;
async function save(owner: string, revision: number, state: KitchenState): Promise<boolean> {
  const encoded = JSON.stringify(state);
  if (Buffer.byteLength(encoded) > MAX_KITCHEN_BYTES) throw new KitchenError("履歴の保存上限に近づきました。元データは変更していません。履歴を保全して容量の拡張が必要です", 503);
  if (redis) return Number(await redis.eval(CAS, [userKey(owner)], [revision, KITCHEN_KEY, encoded])) === 1;
  return (await localSetKey(owner, KITCHEN_KEY, state, { expectRev: revision, kitchenWrite: true })).ok;
}
export async function activateKitchen(owner: string, expectedLegacyRevision: number, deviceData?: Record<string, unknown>, zone?: unknown): Promise<KitchenState> {
  const current = await readKitchenData(owner);
  if (current.state) return current.state;
  if (current.revision !== expectedLegacyRevision) throw new KitchenError("旧データが更新されました。移行内容を読み直してください", 409);
  if (deviceData && LEGACY_MUTABLE.some(k => Array.isArray(current.legacy[k]) && current.legacy[k].length > 0)) throw new KitchenError("保存先に既存データがあります。端末コピーとの結合は自動で行いません", 409);
  const source = deviceData ? Object.fromEntries(LEGACY_MUTABLE.filter(k => deviceData[k] !== undefined).map(k => [k, deviceData[k]])) : current.legacy;
  const state = initialState(owner, source, current.revision, new Date().toISOString());
  state.locations[0].timeZone = timeZone(zone);
  if (!await save(owner, current.revision, state)) throw new KitchenError("保存中に更新がありました。内容を読み直してください", 409);
  return state;
}
export async function commitKitchen(owner: string, command: ReturnType<typeof decodeCommand>): Promise<KitchenState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readKitchenData(owner);
    if (!current.state) throw new KitchenError("先に在庫管理を開始してください", 409);
    const state = execute(current.state, owner, command, new Date().toISOString());
    if (state === current.state || await save(owner, current.revision, state)) return state;
    // The next read will either recognize the operation ID or reject a changed revision.
  }
  throw new KitchenError("他の操作と重なりました。内容を読み直してください", 409);
}
export function exportDigest(state: KitchenState): string { return createHash("sha256").update(JSON.stringify(state)).digest("hex"); }
export async function cancelKitchenOperation(owner: string, command: ReturnType<typeof decodeCommand>): Promise<KitchenState> {
  const fingerprint = canonicalJSON({ type: command.type, locationId: command.locationId, payload: command.payload });
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readKitchenData(owner), s = current.state;
    if (!s || !s.locations.some(l => l.id === command.locationId)) throw new KitchenError("この操作の保存先を確認してください", 403);
    const prior = s.operations[command.id];
    if (prior) { if (prior.fingerprint !== fingerprint) throw new KitchenError("操作内容が一致しません", 409); return s; }
    const state = structuredClone(s); state.revision++;
    state.operations[command.id] = { fingerprint, revision: state.revision, cancelled: true };
    state.transactions.push({ id: `${command.id}-cancelled`, commandId: command.id, locationId: command.locationId, type: "operation.cancel", at: new Date().toISOString(), changes: [], createdLots: [], note: "未確定の操作を取消。遅れて届く同じ操作は適用しません" });
    if (await save(owner, current.revision, state)) return state;
  }
  throw new KitchenError("取消の結果をもう一度照合してください", 409);
}
export async function copyVerifiedDeviceKitchen(sourceOwner: string, targetOwner: string, digest: string): Promise<KitchenState> {
  if (sourceOwner === targetOwner) throw new KitchenError("同じ保存先にはコピーできません", 409);
  const target = await readKitchenData(targetOwner);
  if (target.state?.migration.signedDeviceCopy?.sourceOwner === sourceOwner && target.state.migration.signedDeviceCopy.digest === digest) return target.state;
  if (target.state || LEGACY_MUTABLE.some(k => Array.isArray(target.legacy[k]) && target.legacy[k].length)) throw new KitchenError("アカウントに既存データがあります。上書きせず、別々のバックアップを保持してください", 409);
  const source = await readKitchenData(sourceOwner);
  if (!source.state || exportDigest(source.state) !== digest) throw new KitchenError("端末の在庫が更新されました。コピー内容を再確認してください", 409);
  const state = structuredClone(source.state); state.owner = targetOwner;
  state.migration.signedDeviceCopy = { sourceOwner, digest, sourceRevision: source.state.revision, copiedAt: new Date().toISOString() };
  if (!await save(targetOwner, target.revision, state)) throw new KitchenError("アカウントに更新がありました。上書きせず停止しました", 409);
  return state;
}

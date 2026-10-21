import { execute } from "./engine";
import type { KitchenCommand, KitchenState } from "./model";
export interface PendingOperation { owner: string; command: KitchenCommand; at?: string; sent?: boolean }
export function projectQueue(state: KitchenState, queue: PendingOperation[], rebase = false): { state: KitchenState; queue: PendingOperation[] } {
  let projected = state;
  const remaining: PendingOperation[] = [];
  for (const queued of queue) {
    if (queued.owner !== state.owner) throw new Error("別の利用者の操作は再送できません");
    if (projected.operations[queued.command.id]) { execute(projected, state.owner, queued.command, queued.at || new Date().toISOString()); continue; }
    const item = rebase ? { ...queued, command: { ...queued.command, expectedRevision: projected.revision } } : queued;
    projected = execute(projected, state.owner, item.command, item.at || new Date().toISOString());
    remaining.push(item);
  }
  return { state: projected, queue: remaining };
}
const prefix = (owner: string) => `cooksync:kitchen:queued:${owner}:`;
export function loadQueue(storage: Storage, owner: string): PendingOperation[] {
  const legacyKey = `cooksync:kitchen:outbox:${owner}`;
  const legacy = storage.getItem(legacyKey);
  if (legacy) { const item = JSON.parse(legacy) as PendingOperation; if (item.owner === owner && item.command?.id) { storage.setItem(prefix(owner) + item.command.id, JSON.stringify({ ...item, sent: true })); storage.removeItem(legacyKey); } }
  const values: PendingOperation[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith(prefix(owner))) continue;
    const value = JSON.parse(storage.getItem(key) || "null") as PendingOperation;
    if (!value || value.owner !== owner || !value.command?.id || key !== prefix(owner) + value.command.id) throw new Error("保留操作を読み取れません。データを消さずに確認してください");
    values.push(value);
  }
  return values.sort((a, b) => a.command.expectedRevision - b.command.expectedRevision || (a.at || "").localeCompare(b.at || "") || a.command.id.localeCompare(b.command.id));
}
export function storePending(storage: Storage, item: PendingOperation) { storage.setItem(prefix(item.owner) + item.command.id, JSON.stringify(item)); }
export function removePending(storage: Storage, item: PendingOperation) { storage.removeItem(prefix(item.owner) + item.command.id); }

"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { KitchenCommand, KitchenState } from "./model";
import { loadQueue, projectQueue, removePending, storePending, type PendingOperation } from "./outbox";
import { showQuantity } from "./quantity";
interface Snapshot { state: KitchenState | null; owner?: string; isGuest?: boolean; needsSession?: boolean; legacyRevision?: number; legacyCounts?: Record<string, number>; ai?: { enabled: boolean; environment: string; model: string } }
interface Review { owner: string; revision: number; queue: PendingOperation[]; changes: string[] }
interface Context {
  snapshot: Snapshot | null; locationId: string; chooseLocation: (id: string) => void; busy: boolean;
  error: string; notice: string; pending: PendingOperation | null; pendingCount: number; review: Review | null; refresh: () => Promise<void>;
  send: (type: string, payload: Record<string, unknown>, locationId?: string) => Promise<boolean>;
  activate: (deviceData?: Record<string, unknown>) => Promise<void>; guest: () => Promise<void>; retry: () => Promise<void>; dismissPending: () => Promise<void>; reviewPending: () => Promise<void>; confirmPending: () => Promise<void>;
}
const KitchenContext = createContext<Context | null>(null);
async function request(body?: unknown): Promise<Snapshot> {
  const response = await fetch("/api/kitchen", { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) }).catch(() => { throw new Error("通信を確認できません。入力した操作は端末に保留し、接続後に保存結果を照合します。"); });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "処理を完了できませんでした"), { status: response.status });
  return value;
}
export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [locationId, setLocation] = useState("default");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<PendingOperation[]>([]), [review, setReview] = useState<Review | null>(null);
  const server = useRef<Snapshot | null>(null), busyRef = useRef(false), generation = useRef(0);
  const accept = useCallback((value: Snapshot) => {
    const owner = value.state?.owner || value.owner, previousOwner = server.current?.state?.owner || server.current?.owner;
    if (!value.ai && owner === previousOwner) value = { ...value, ai: server.current?.ai };
    if (owner !== previousOwner) { const selected = owner ? localStorage.getItem(`cooksync:kitchen:location:${owner}`) : null; setLocation(selected && value.state?.locations.some(l => l.id === selected) ? selected : "default"); setReview(null); }
    server.current = value;
    try {
      const pending = owner ? loadQueue(localStorage, owner) : []; setQueue(pending);
      if (value.state && pending.length) {
        try { setSnapshot({ ...value, state: projectQueue(value.state, pending).state }); return; }
        catch (e) { setError(`保留操作と最新データの確認が必要です：${(e as Error).message}`); }
      }
    } catch (e) { setError((e as Error).message); }
    setSnapshot(value);
  }, []);
  const refresh = useCallback(async () => { const current = ++generation.current; try { const value = await request(); if (current === generation.current) accept(value); } catch (e) { if (current === generation.current) setError((e as Error).message); } }, [accept]);
  useEffect(() => { void refresh(); const focus = () => { if (!busyRef.current) void refresh(); }; window.addEventListener("focus", focus); window.addEventListener("online", focus); window.addEventListener("storage", focus); return () => { window.removeEventListener("focus", focus); window.removeEventListener("online", focus); window.removeEventListener("storage", focus); }; }, [refresh]);
  const chooseLocation = (id: string) => { const s = snapshot?.state; if (!s?.locations.some(l => l.id === id)) return; setLocation(id); localStorage.setItem(`cooksync:kitchen:location:${s.owner}`, id); setNotice(""); setError(""); };
  const locked = async (action: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(""); ++generation.current;
    try { if (!navigator.locks) throw new Error("このブラウザでは安全な操作の同期が使えません。対応ブラウザで開いてください"); await navigator.locks.request("cooksync-kitchen-writer", action); }
    catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const drain = async (owner: string) => {
    let fresh = await request(); if ((fresh.state?.owner || fresh.owner) !== owner) { accept(fresh); throw new Error("利用者が変わりました。操作は元の利用者の保留一覧に残しています"); }
    for (const item of loadQueue(localStorage, owner)) {
      storePending(localStorage, { ...item, sent: true });
      fresh = await request({ owner, command: item.command });
      removePending(localStorage, item); accept(fresh);
    }
    accept(fresh); setNotice("保留していた操作もすべて保存しました"); setReview(null);
  };
  const send = async (type: string, payload: Record<string, unknown>, target = locationId) => {
    let accepted = false;
    await locked(async () => {
      const base = server.current?.state; if (!base) return;
      const pending = loadQueue(localStorage, base.owner);
      const projected = projectQueue(base, pending).state;
      const command: KitchenCommand = { id: crypto.randomUUID(), locationId: target, expectedRevision: projected.revision, type, payload };
      const item: PendingOperation = { owner: base.owner, command, at: new Date().toISOString(), sent: false };
      projectQueue(projected, [item]);
      storePending(localStorage, item); accept(server.current!); setReview(null); accepted = true;
      try { await drain(base.owner); }
      catch (e) { setError((e as Error).message); setNotice("この端末に保留しました。表示は保留操作を含みます。実際の保存は再送時に確認します。"); }
    }); return accepted;
  };
  const retry = async () => { await locked(async () => { const owner = server.current?.state?.owner; if (owner) await drain(owner); }); };
  const reviewPending = async () => { await locked(async () => {
    const fresh = await request(), owner = server.current?.state?.owner;
    if (!fresh.state || fresh.state.owner !== owner) { accept(fresh); throw new Error("同じ利用者で確認してください"); }
    const pending = loadQueue(localStorage, owner), projected = projectQueue(fresh.state, pending, true);
    const changes = projected.state.lots.filter(l => JSON.stringify(l) !== JSON.stringify(fresh.state!.lots.find(v => v.id === l.id))).map(l => `${projected.state.locations.find(p => p.id === l.locationId)?.name}・${l.name}：${showQuantity(fresh.state!.lots.find(v => v.id === l.id)?.quantity || null)} → ${showQuantity(l.quantity)}（${l.compartment}・${l.condition}）`);
    accept(fresh); setReview({ owner, revision: fresh.state.revision, queue: projected.queue, changes });
  }); };
  const confirmPending = async () => { await locked(async () => {
    if (!review) return; const fresh = await request();
    if (fresh.state?.owner !== review.owner || fresh.state.revision !== review.revision) { accept(fresh); setReview(null); throw new Error("確認中に更新がありました。もう一度変更内容を確認してください"); }
    const current = loadQueue(localStorage, review.owner);
    if (current.some(v => !review.queue.some(q => q.command.id === v.command.id) && !fresh.state!.operations[v.command.id])) throw new Error("別の画面から操作が追加されました。再確認してください");
    for (const item of current) if (fresh.state.operations[item.command.id]) removePending(localStorage, item);
    for (const item of review.queue) storePending(localStorage, item);
    await drain(review.owner);
  }); };
  const dismissPending = async () => { await locked(async () => {
    const fresh = await request(), owner = server.current?.state?.owner;
    if (!fresh.state || fresh.state.owner !== owner) throw new Error("元の利用者で保存結果を確認してから解除してください");
    const pending = loadQueue(localStorage, owner);
    for (const item of pending) { await request({ owner, action: "cancel-operation", command: item.command }); removePending(localStorage, item); }
    setReview(null); await refresh(); setNotice("送信済み操作の結果を照合しました。未送信の保留を解除しました。保存済みの取消は履歴から行えます。");
  }); };
  const initialize = async (action: "guest" | "activate", deviceData?: Record<string, unknown>) => { await locked(async () => { await request({ action, owner: snapshot?.owner, legacyRevision: snapshot?.legacyRevision ?? 0, deviceData, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); await refresh(); }); };
  return <KitchenContext.Provider value={{ snapshot, locationId, chooseLocation, busy, error, notice, pending: queue[0] || null, pendingCount: queue.length, review, refresh, send, activate: data => initialize("activate", data), guest: () => initialize("guest"), retry, dismissPending, reviewPending, confirmPending }}>{children}</KitchenContext.Provider>;
}
export function useKitchen() { const value = useContext(KitchenContext); if (!value) throw new Error("KitchenProvider missing"); return value; }
export function useOptionalKitchen() { return useContext(KitchenContext); }

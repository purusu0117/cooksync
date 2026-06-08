"use client";

// 調理タイマー（複数同時）。
// ★終了時刻(endAt)ベース＝実際の壁時計で計算するので秒単位で正確。
//   アプリを離れている間はJSが止まるため鳴らないが、戻った瞬間に正しい残り時間を表示し、
//   既に終わっていれば即アラームする（visibilitychangeで復帰検知）。
//  - 止めるまで鳴り続けるアラーム（Web Audio）
//  - スクロールしても見える固定の完了バナー
//  - OS通知（Notifications API・許可時）
//  - 実行中は画面スリープ防止（Wake Lock・対応端末）
// ※ iOSはバイブAPI非対応。アプリを離れている間の通知が要る場合はネイティブ化が必要。

import { useCallback, useEffect, useRef, useState } from "react";
import { Timer, X, Pause, Play, Plus, BellOff } from "lucide-react";
import { enablePush } from "@/lib/pushClient";

// サーバー側に完了時刻を予約／解除（アプリを閉じていても終了時刻ちょうどに通知）
function scheduleServerTimer(id: string, endAt: number, label: string) {
  void fetch("/api/timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, endAt, label }),
  }).catch(() => {});
}
function cancelServerTimer(id: string) {
  void fetch("/api/timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, cancel: true }),
  }).catch(() => {});
}

interface TimerItem {
  id: string;
  label: string;
  total: number;
  endAt: number; // 終了時刻(ms)。一時停止中は pausedLeft を使う
  paused: boolean;
  pausedLeft: number; // 一時停止時点の残り秒
}

type WakeNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
  };
};

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// イベントハンドラ内で現在時刻を取る（lintのpurity誤検知を避けるためのラッパ）
const clockNow = (): number => Date.now();

function secLeft(t: TimerItem, now: number): number {
  if (t.paused) return t.pausedLeft;
  if (now <= 0) return t.total;
  return Math.max(0, Math.ceil((t.endAt - now) / 1000));
}
function isDoneAt(t: TimerItem, now: number): boolean {
  return !t.paused && now > 0 && now >= t.endAt;
}

export default function CookingTimer({
  suggestions = [],
}: {
  suggestions?: number[];
}) {
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [now, setNow] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);
  const rung = useRef<Set<string>>(new Set());
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  const presets = Array.from(new Set([3, 5, 10, ...suggestions]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .slice(0, 8);

  const hasActive = timers.some((t) => !t.paused && t.endAt > now);
  const doneTimers = timers.filter((t) => isDoneAt(t, now));
  const anyDone = doneTimers.length > 0;

  const beep = useCallback(() => {
    try {
      (
        navigator as Navigator & { vibrate?: (p: number[]) => boolean }
      ).vibrate?.([400, 200, 400]);
    } catch {
      /* iOSは非対応 */
    }
    const ctx = audioRef.current;
    if (!ctx) return;
    [0, 0.5, 1.0].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  }, []);

  // 壁時計を刻む（タイマーがある間）。復帰時(visibilitychange)にも即更新＝正確。
  useEffect(() => {
    if (timers.length === 0) return;
    const update = () => setNow(Date.now());
    const t0 = setTimeout(update, 0);
    const iv = setInterval(update, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [timers.length]);

  // 新たに完了 → OS通知（1回だけ）
  useEffect(() => {
    const newly = timers.filter(
      (t) => isDoneAt(t, now) && !rung.current.has(t.id),
    );
    if (newly.length === 0) return;
    newly.forEach((t) => rung.current.add(t.id));
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        newly.forEach(
          (t) =>
            new Notification("⏰ CookSync タイマー", {
              body: `${t.label}が完了しました`,
              tag: t.id,
            }),
        );
      }
    } catch {
      /* noop */
    }
  }, [now, timers]);

  // 完了が1つでもある間は鳴らし続ける＋タブタイトル点滅
  useEffect(() => {
    if (!anyDone) return;
    beep();
    const iv = setInterval(beep, 1600);
    const title = document.title;
    document.title = "⏰ タイマー完了！";
    return () => {
      clearInterval(iv);
      document.title = title;
    };
  }, [anyDone, beep]);

  // 実行中は画面スリープ防止（対応端末のみ）
  useEffect(() => {
    if (!hasActive) return;
    const nav = navigator as WakeNavigator;
    const acquire = () => {
      nav.wakeLock
        ?.request("screen")
        .then((w) => (wakeRef.current = w))
        .catch(() => {});
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [hasActive]);

  function ensureAudioAndPermission() {
    try {
      if (!audioRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioRef.current = new Ctx();
      }
      void audioRef.current?.resume();
    } catch {
      /* 音が出せない端末は無視 */
    }
    try {
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch {
      /* noop */
    }
  }

  function addTimer(min: number) {
    ensureAudioAndPermission();
    void enablePush(); // 離脱中もサーバーから通知できるよう購読を確保
    const start = clockNow();
    setNow(start);
    const item: TimerItem = {
      id: crypto.randomUUID(),
      label: `${min}分`,
      total: min * 60,
      endAt: start + min * 60 * 1000,
      paused: false,
      pausedLeft: min * 60,
    };
    setTimers((prev) => [...prev, item]);
    scheduleServerTimer(item.id, item.endAt, item.label); // 完了時刻を予約
  }
  function togglePause(id: string) {
    const nowMs = clockNow();
    const t = timers.find((x) => x.id === id);
    if (!t || isDoneAt(t, nowMs)) return;
    if (t.paused) {
      // 再開：残り秒から終了時刻を引き直し、サーバー予約も入れ直す
      const endAt = nowMs + t.pausedLeft * 1000;
      setTimers((prev) =>
        prev.map((x) => (x.id === id ? { ...x, paused: false, endAt } : x)),
      );
      scheduleServerTimer(id, endAt, t.label);
    } else {
      // 一時停止：残り秒を保存し、サーバー予約を解除
      setTimers((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, paused: true, pausedLeft: secLeft(x, nowMs) } : x,
        ),
      );
      cancelServerTimer(id);
    }
  }
  function removeTimer(id: string) {
    rung.current.delete(id);
    cancelServerTimer(id);
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }
  function stopAlarm() {
    const nowMs = clockNow();
    timers.forEach((t) => {
      if (isDoneAt(t, nowMs)) {
        rung.current.delete(t.id);
        cancelServerTimer(t.id);
      }
    });
    setTimers((prev) => prev.filter((t) => !isDoneAt(t, nowMs)));
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
        <Timer size={16} className="text-brand" /> 調理タイマー
        <span className="ml-1 text-xs font-normal text-ink-soft">
          （タップで複数同時にかけられます）
        </span>
      </h2>

      <div className="flex flex-wrap gap-2">
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => addTimer(m)}
            className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark transition hover:bg-brand hover:text-white"
          >
            <Plus size={12} />
            {m}分
          </button>
        ))}
      </div>

      {timers.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {timers.map((t) => {
            const done = isDoneAt(t, now);
            return (
              <li
                key={t.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
                  done ? "bg-accent-soft" : "bg-paper"
                }`}
              >
                <span className="text-xs font-medium text-ink-soft">
                  {t.label}
                </span>
                <span
                  className={`font-mono text-xl font-bold tabular-nums ${
                    done ? "text-accent-dark" : "text-ink"
                  }`}
                >
                  {done ? "⏰ 完了！" : fmt(secLeft(t, now))}
                </span>
                {!done && (
                  <button
                    type="button"
                    onClick={() => togglePause(t.id)}
                    className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-brand text-white"
                    aria-label={t.paused ? "再開" : "一時停止"}
                  >
                    {t.paused ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeTimer(t.id)}
                  className={`grid h-8 w-8 place-items-center rounded-full border border-line text-ink-soft ${
                    done ? "ml-auto" : ""
                  }`}
                  aria-label="削除"
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* スクロールしても見える固定の完了バナー（鳴り続ける） */}
      {anyDone && (
        <div className="fixed inset-x-0 bottom-24 z-40 px-4">
          <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4 shadow-lg">
            <span className="animate-pulse text-2xl" aria-hidden>
              ⏰
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-accent-dark">タイマー完了！</p>
              <p className="truncate text-xs text-ink-soft">
                {doneTimers.map((t) => t.label).join("・")} が鳴っています
              </p>
            </div>
            <button
              type="button"
              onClick={stopAlarm}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-dark px-4 py-2 text-sm font-semibold text-white active:scale-95"
            >
              <BellOff size={15} />
              止める
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

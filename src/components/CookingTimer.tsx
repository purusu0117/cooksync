"use client";

// 調理タイマー（複数同時）。完了に気づけるよう：
//  - 止めるまで鳴り続けるアラーム（Web Audio）
//  - スクロールしても見える固定の完了バナー
//  - OS通知（Notifications API・許可時）＝OS側の音/バイブ
//  - 実行中は画面スリープ防止（Wake Lock・対応端末）
// ※ iOSはバイブAPI(navigator.vibrate)非対応。通知はホーム画面追加したPWA(16.4+)で有効。

import { useCallback, useEffect, useRef, useState } from "react";
import { Timer, X, Pause, Play, Plus, BellOff } from "lucide-react";

interface TimerItem {
  id: string;
  label: string;
  total: number;
  secondsLeft: number;
  paused: boolean;
  done: boolean;
}

type WakeNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
};

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CookingTimer({
  suggestions = [],
}: {
  suggestions?: number[];
}) {
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const rung = useRef<Set<string>>(new Set());
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  const presets = Array.from(new Set([3, 5, 10, ...suggestions]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .slice(0, 8);

  const hasActive = timers.some(
    (t) => !t.paused && !t.done && t.secondsLeft > 0,
  );
  const doneTimers = timers.filter((t) => t.done);
  const anyDone = doneTimers.length > 0;

  const beep = useCallback(() => {
    try {
      (navigator as Navigator & { vibrate?: (p: number[]) => boolean }).vibrate?.(
        [400, 200, 400],
      );
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

  // 1秒ごとに全タイマーを進める（実行中がある間だけ）
  useEffect(() => {
    if (!hasActive) return;
    const iv = setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (t.paused || t.done || t.secondsLeft <= 0) return t;
          const s = t.secondsLeft - 1;
          return s <= 0
            ? { ...t, secondsLeft: 0, done: true }
            : { ...t, secondsLeft: s };
        }),
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [hasActive]);

  // 新たに完了 → OS通知（1回だけ）
  useEffect(() => {
    const newly = timers.filter((t) => t.done && !rung.current.has(t.id));
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
  }, [timers]);

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
    setTimers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: `${min}分`,
        total: min * 60,
        secondsLeft: min * 60,
        paused: false,
        done: false,
      },
    ]);
  }
  function togglePause(id: string) {
    setTimers((prev) =>
      prev.map((t) =>
        t.id === id && !t.done ? { ...t, paused: !t.paused } : t,
      ),
    );
  }
  function removeTimer(id: string) {
    rung.current.delete(id);
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }
  function stopAlarm() {
    doneTimers.forEach((t) => rung.current.delete(t.id));
    setTimers((prev) => prev.filter((t) => !t.done));
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
          {timers.map((t) => (
            <li
              key={t.id}
              className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
                t.done ? "bg-accent-soft" : "bg-paper"
              }`}
            >
              <span className="text-xs font-medium text-ink-soft">
                {t.label}
              </span>
              <span
                className={`font-mono text-xl font-bold tabular-nums ${
                  t.done ? "text-accent-dark" : "text-ink"
                }`}
              >
                {t.done ? "⏰ 完了！" : fmt(t.secondsLeft)}
              </span>
              {!t.done && (
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
                  t.done ? "ml-auto" : ""
                }`}
                aria-label="削除"
              >
                <X size={14} />
              </button>
            </li>
          ))}
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
              <p className="text-sm font-bold text-accent-dark">
                タイマー完了！
              </p>
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

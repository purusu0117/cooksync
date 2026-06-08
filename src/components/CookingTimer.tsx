"use client";

// 調理タイマー。レシピ手順から拾った「N分」をワンタップで開始できる。
// 終了時：ビープ音（Web Audio）＋バイブ（対応端末）＋画面表示。

import { useCallback, useEffect, useRef, useState } from "react";
import { Timer, X, Pause, Play } from "lucide-react";

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
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  const done = remaining === 0;
  const active = remaining !== null && remaining > 0 && !paused;

  const presets = Array.from(new Set([3, 5, 10, ...suggestions]))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .slice(0, 8);

  const ring = useCallback(() => {
    try {
      navigator.vibrate?.([400, 200, 400, 200, 400]);
    } catch {
      /* noop */
    }
    const ctx = audioRef.current;
    if (!ctx) return;
    [0, 0.6, 1.2].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  }, []);

  // カウントダウン（setTimeoutのコールバック内でのみ更新＝effect同期setStateを避ける）
  useEffect(() => {
    if (remaining === null || remaining <= 0 || paused) return;
    const t = setTimeout(
      () => setRemaining((r) => (r === null ? r : r - 1)),
      1000,
    );
    return () => clearTimeout(t);
  }, [remaining, paused]);

  // 終了時に鳴らす（外部システム=音/バイブの同期。setStateはしない）
  useEffect(() => {
    if (remaining === 0) ring();
  }, [remaining, ring]);

  function ensureAudio() {
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
  }

  function start(min: number) {
    ensureAudio();
    setPaused(false);
    setRemaining(min * 60);
  }
  function stop() {
    setRemaining(null);
    setPaused(false);
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
        <Timer size={16} className="text-brand" /> 調理タイマー
      </h2>
      <div className="flex flex-wrap gap-2">
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => start(m)}
            className="rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-dark transition hover:bg-brand hover:text-white"
          >
            {m}分
          </button>
        ))}
      </div>

      {remaining !== null && (
        <div
          className={`mt-3 flex items-center gap-3 rounded-xl px-4 py-3 ${
            done ? "bg-accent-soft" : "bg-paper"
          }`}
        >
          <span
            className={`font-mono text-2xl font-bold tabular-nums ${
              done ? "text-accent-dark" : "text-ink"
            }`}
          >
            {done ? "⏰ 時間です！" : fmt(remaining)}
          </span>
          {!done && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-brand text-white"
              aria-label={active ? "一時停止" : "再開"}
            >
              {active ? <Pause size={16} /> : <Play size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={stop}
            className={`grid h-9 w-9 place-items-center rounded-full border border-line text-ink-soft ${
              done ? "ml-auto" : ""
            }`}
            aria-label="閉じる"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

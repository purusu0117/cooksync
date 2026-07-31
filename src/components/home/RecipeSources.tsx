"use client";

// ホームの「レシピをつくる」入口。何ができるアプリなのかが一目で分かるように、
// 作り方の入口を3つだけ並べる。
//   ① AIに献立を提案してもらう（冷蔵庫＋気分から）
//   ② 動画から（YouTube / TikTok）
//   ③ 写真から（レシピ本・スクショ・料理写真）
//
// URL入力やファイル選択は **選んだときだけ開く**（常時出すと画面が散らかるため）。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, ChefHat, ChevronRight, Images, Link2, Loader2, Video } from "lucide-react";
import ImportedRecipePreview, {
  type ImportResult,
} from "@/components/recipes/ImportedRecipePreview";
import { getUid } from "@/lib/syncStore";
import { readApiError, useUsage } from "@/lib/usage";
import { isNativeApp } from "@/lib/native";
import { MAX_RECIPE_PHOTOS, pickPhotosFromLibrary, takePhoto } from "@/lib/nativeCamera";

type Mode = "video" | "photo" | null;

export default function RecipeSources() {
  const usage = useUsage();
  const [mode, setMode] = useState<Mode>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 動画からの取り込みは yt-dlp を起動できるローカル版だけ。公開サーバーでは必ず501になるので、
  // 入口ごと出さない（押しても失敗する機能を審査担当者に触らせないため。ガイドライン2.1）。
  const [videoEnabled, setVideoEnabled] = useState(false);
  // アプリ版はOSのカメラ/フォトピッカーを直接呼ぶ。Web版は <input type="file"> のまま。
  // 初期値falseでマウント後に確定させる＝サーバー描画（＝Web版）とズレさせない。
  const [native, setNative] = useState(false);

  useEffect(() => {
    // マウント後に確定させる（effect本体での同期setStateを避ける）
    const t = setTimeout(() => setNative(isNativeApp()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/health");
        const h = (await res.json()) as { videoImport?: boolean };
        if (alive) setVideoEnabled(!!h.videoImport);
      } catch {
        /* 取れなければ出さないまま（安全側） */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function reset() {
    if (pollRef.current) clearTimeout(pollRef.current);
    setResult(null);
    setError("");
    setLoading(false);
    setStep("");
  }

  function choose(next: Mode) {
    reset();
    setUrl("");
    setMode(mode === next ? null : next);
  }

  // ---- 動画（ジョブ方式：30〜120秒） ----
  // サーバーが黙ったまま（＝after()が殺された等）でも**永久には回さない**。
  // 3秒間隔×120回＝約6分で打ち切る。サーバー側のTTLは30分あるので、
  // 上限が無いと最悪30分スピナーを見せ続けることになる。
  const MAX_POLLS = 120;

  async function poll(jobId: string, tries = 0) {
    if (tries >= MAX_POLLS) {
      setLoading(false);
      setError("時間がかかりすぎています。もう一度お試しください。");
      return;
    }
    try {
      const res = await fetch(`/api/import-video?jobId=${jobId}`);
      const data = await res.json();
      if (data.status === "done") {
        setLoading(false);
        // done なのにレシピが無い＝読み取れなかった回（古いジョブ対策の保険）。
        // ここで通すと ImportedRecipePreview が undefined を触って画面ごと落ちる。
        if (!data.recipe) {
          setError("この動画からはレシピを読み取れませんでした。");
          return;
        }
        setResult({
          recipe: data.recipe,
          missing: data.missing,
          confidence: data.confidence,
          source: data.source,
        });
        return;
      }
      if (data.status === "error" || data.status === "missing") {
        setLoading(false);
        setError(data.error || "取り込みに失敗しました");
        return;
      }
      if (data.step) setStep(data.step);
      pollRef.current = setTimeout(() => poll(jobId, tries + 1), 3000);
    } catch {
      pollRef.current = setTimeout(() => poll(jobId, tries + 1), 4000);
    }
  }

  async function startVideo() {
    if (loading || !url.trim()) return;
    reset();
    setLoading(true);
    setStep("動画の情報を取得中…");
    try {
      const res = await fetch("/api/import-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.jobId) throw new Error(data.error || "開始できませんでした");
      poll(data.jobId);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : "取り込みに失敗しました");
    }
  }

  // ---- 写真 ----
  // Web：<input type="file">（複数選択可）から
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 同じ写真を選び直せるように
    await runPhotos(files);
  }

  // ネイティブ：撮影（1枚）／ライブラリから複数選択（4枚まで）
  async function onNativePhotos(mode: "camera" | "library") {
    if (loading) return;
    setError("");
    try {
      const files =
        mode === "camera"
          ? await takePhoto().then((f) => (f ? [f] : []))
          : await pickPhotosFromLibrary(MAX_RECIPE_PHOTOS);
      await runPhotos(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "写真を取得できませんでした");
    }
  }

  // 取得経路がどちらでも、ここから先（送信・表示）は同じ
  async function runPhotos(files: File[]) {
    if (files.length === 0) return;
    reset();
    // 事前チェックは表示用（押す前に気づけるように）。文言はサーバーの429と揃える。
    if (!usage.canUse("import")) {
      setError(usage.limitMessage("import"));
      return;
    }
    usage.recordUse("import");
    setLoading(true);
    setStep(
      files.length > 1
        ? `${files.length}枚をAIが読み取り中…（順番も判定します）`
        : "AIが写真を読み取り中…",
    );
    try {
      const fd = new FormData();
      // 同じキーで複数枚送る（サーバー側は getAll("image") で受ける）
      for (const f of files) fd.append("image", f);
      const res = await fetch("/api/import-photo", {
        method: "POST",
        headers: { "x-cooksync-uid": getUid() },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        // 429（枠切れ）は**サーバーの文言をそのまま**出す。断られた理由（本人の枠／回線／
        // 全体／予算）はサーバーしか知らないので、こちらで書き換えると嘘になる。
        // 読み取れなかった422のときはサーバーが枠を戻すので、こちらの表示も戻す。
        const fail = readApiError(data, "レシピを読み取れませんでした");
        usage.syncFromServer("import", fail.quota);
        throw new Error(fail.message);
      }
      if (!data.recipe) throw new Error("レシピを読み取れませんでした");
      setResult({
        recipe: data.recipe,
        missing: data.missing,
        confidence: data.confidence,
        photoOrder: data.photoOrder,
        photoCount: data.photoCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み取りに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-base font-bold text-brand-dark">レシピをつくる</h2>

      {/* ①主役：AIに提案してもらう */}
      <Link
        href="/meal"
        className="flex items-center gap-3 rounded-2xl bg-brand p-4 text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20">
          <ChefHat size={22} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">AIに今日の献立を提案してもらう</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-white/85">
            冷蔵庫の食材と気分から、作れる料理を提案します
          </span>
        </span>
        <ChevronRight size={20} className="shrink-0" />
      </Link>

      {/* ②③取り込み。押したときだけ入力欄を開く */}
      <div className={`mt-2 grid gap-2 ${videoEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
        {videoEnabled && (
          <SourceCard
            active={mode === "video"}
            icon={<Video size={18} strokeWidth={2} />}
            title="動画から作る"
            desc="YouTube・TikTok"
            onClick={() => choose("video")}
          />
        )}
        <SourceCard
          active={mode === "photo"}
          icon={<Camera size={18} strokeWidth={2} />}
          title="写真から作る"
          desc="レシピ本・スクショ"
          onClick={() => choose("photo")}
        />
      </div>

      {mode && (
        <div className="animate-pop-in mt-2 rounded-2xl border border-brand/30 bg-surface p-3">
          {mode === "video" ? (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2
                    size={15}
                    strokeWidth={1.8}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
                  />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="動画のURLを貼り付け"
                    inputMode="url"
                    autoComplete="off"
                    className="w-full rounded-xl border border-line bg-paper py-2.5 pr-3 pl-9 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
                  />
                </div>
                <button
                  type="button"
                  onClick={startVideo}
                  disabled={loading || !url.trim()}
                  className="shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
                >
                  作る
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                料理動画のURLを貼るだけ。概要欄と字幕から材料・手順を書き起こします（30〜120秒）。
              </p>
            </>
          ) : (
            <>
              {native ? (
                // アプリ版：撮影とライブラリをOSのUIで分けて出す（複数選択はライブラリ側）
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onNativePhotos("camera")}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:bg-line disabled:text-ink-soft"
                  >
                    <Camera size={16} strokeWidth={2} />
                    写真を撮る
                  </button>
                  <button
                    type="button"
                    onClick={() => onNativePhotos("library")}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 rounded-xl border border-brand bg-surface py-2.5 text-sm font-semibold text-brand-dark transition hover:bg-brand-soft disabled:border-line disabled:text-ink-soft"
                  >
                    <Images size={16} strokeWidth={2} />
                    ライブラリから選ぶ
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:bg-line disabled:text-ink-soft"
                  >
                    <Camera size={16} strokeWidth={2} />
                    写真を選ぶ・撮る（複数可）
                  </button>
                </>
              )}
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                レシピ本のページ、SNSのスクショ、手書きメモでOK（4枚まで）。
                <strong>順番はバラバラでも大丈夫</strong>— 調理の進み方から並べ直して手順にします。
              </p>
            </>
          )}

          {loading && (
            <p className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-brand-dark">
              <Loader2 size={14} className="animate-spin" />
              {step}
            </p>
          )}
          {error && <p className="mt-2 text-xs leading-relaxed text-red-600">{error}</p>}
          {result && <ImportedRecipePreview result={result} onDiscard={reset} />}
        </div>
      )}
    </section>
  );
}

function SourceCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition ${
        active
          ? "border-brand bg-brand-soft"
          : "border-line bg-surface hover:border-brand/40 hover:shadow-sm"
      }`}
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand-dark">
        {icon}
      </span>
      <span className="text-sm font-bold text-ink">{title}</span>
      <span className="text-xs text-ink-soft">{desc}</span>
    </button>
  );
}

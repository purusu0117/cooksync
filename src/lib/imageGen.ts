"use client";

// レシピ写真生成のクライアント側まとめ：
//  - 「生成中」のアプリ内共有ストア（一覧・詳細の「生成中…」表示）
//  - ジョブ方式の起動/ポーリング/再開（送信は即jobId→裏で生成→数秒おきに回収）。
//    進行中ジョブは localStorage に永続化するので、画面ロック・アプリ切替・リロード後も
//    自動で回収が再開する（スマホで生成が失敗して見えた問題の対策）。

import { useSyncExternalStore } from "react";
import type { Recipe } from "./recipe";
import { recipeStore } from "./storage";
import { getUid, updateServerList } from "./syncStore";

const generating = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];
const EMPTY: string[] = [];

function emit() {
  snapshot = [...generating];
  listeners.forEach((l) => l());
}

export function startGenerating(id: string) {
  generating.add(id);
  emit();
}
export function stopGenerating(id: string) {
  generating.delete(id);
  emit();
}

export function useGeneratingIds(): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
}

export function useIsGenerating(id: string): boolean {
  return useGeneratingIds().includes(id);
}

// 画像生成が使えるか（公開=API=不可 / ローカル=Maxプランで可）。/api/health を一度だけ確認。
let imgEnabled: boolean | null = null;
let imgLoading = false;
const imgListeners = new Set<() => void>();
function ensureImgFlag() {
  if (imgEnabled !== null || imgLoading) return;
  imgLoading = true;
  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => {
      imgEnabled = j?.aiProvider === "local";
    })
    .catch(() => {
      imgEnabled = false;
    })
    .finally(() => {
      imgLoading = false;
      imgListeners.forEach((l) => l());
    });
}
export function useImageGenEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      imgListeners.add(cb);
      ensureImgFlag();
      return () => imgListeners.delete(cb);
    },
    () => imgEnabled === true,
    () => false,
  );
}

// ---- ジョブ方式の生成（永続化＋再開つき） ----

const LS_JOBS = "cooksync:imageJobs:v1"; // { [recipeId]: jobId }

function readJobs(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_JOBS) || "{}");
  } catch {
    return {};
  }
}
function writeJobs(jobs: Record<string, string>): void {
  try {
    window.localStorage.setItem(LS_JOBS, JSON.stringify(jobs));
  } catch {}
}

const polling = new Set<string>(); // 多重ポーリング防止（jobId）

function pollJob(recipeId: string, jobId: string): void {
  if (polling.has(jobId)) return;
  polling.add(jobId);
  startGenerating(recipeId);

  const finish = (image: string | null) => {
    polling.delete(jobId);
    stopGenerating(recipeId);
    const jobs = readJobs();
    if (jobs[recipeId] === jobId) {
      delete jobs[recipeId];
      writeJobs(jobs);
    }
    if (image) {
      updateServerList<Recipe>(recipeStore.key, (prev) =>
        prev.map((r) => (r.id === recipeId ? { ...r, image } : r)),
      );
    }
  };

  const tick = async () => {
    try {
      const r = await fetch(`/api/recipe-image/poll?jobId=${jobId}`, { cache: "no-store" });
      if (r.status === 404) return finish(null); // サーバー再起動等でジョブ消失
      const d = await r.json();
      if (d.status === "done" && d.image) return finish(d.image);
      if (d.status === "error") return finish(null);
    } catch {
      /* オフライン等 → 次の周期で再試行 */
    }
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 3000);
}

/** 写真生成を開始（即返し）。完了したらレシピストアに自動反映＋プッシュ通知。 */
export function beginImageGeneration(recipeId: string, name: string): void {
  startGenerating(recipeId);
  void (async () => {
    try {
      const res = await fetch("/api/recipe-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: recipeId, name, uid: getUid() }),
      });
      const d = await res.json();
      if (!res.ok || !d.jobId) throw new Error(d.error || "start failed");
      const jobs = readJobs();
      jobs[recipeId] = d.jobId;
      writeJobs(jobs);
      pollJob(recipeId, d.jobId);
    } catch {
      stopGenerating(recipeId);
    }
  })();
}

/** 進行中ジョブの回収を再開（リロード・PWA復帰時） */
export function resumeImageJobs(): void {
  if (typeof window === "undefined") return;
  for (const [recipeId, jobId] of Object.entries(readJobs())) pollJob(recipeId, jobId);
}

// アプリ読み込み時に自動再開（どの画面からでも回収できる）
if (typeof window !== "undefined") {
  setTimeout(resumeImageJobs, 1500);
}

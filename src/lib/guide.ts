"use client";

// 初回の操作ガイド。登録直後→冷蔵庫→レシピ探索、の順に「次の一歩」を案内する。
// 端末ごとに進行（localStorage）。
import { useSyncExternalStore } from "react";

const KEY = "cooksync:guide";
export type GuideStep = "fridge" | "meal" | "done" | null;

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getGuide(): GuideStep {
  try {
    const v = window.localStorage.getItem(KEY);
    return v ? (v as GuideStep) : null;
  } catch {
    return null;
  }
}

export function setGuide(step: GuideStep): void {
  try {
    if (step) window.localStorage.setItem(KEY, step);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  emit();
}

export function useGuide(): GuideStep {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => getGuide(),
    () => null,
  );
}

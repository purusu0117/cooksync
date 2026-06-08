// 食事計画の履歴モデルと純粋ロジック。
// 「連日同一料理を避ける」「Step0b の消費推定」の根拠になる。

import { todayISO } from "./food";

export type MealSlot = "昼" | "夜";
export type MealTiming = "昼" | "夜" | "両方" | "翌日も";

export interface MealEntry {
  id: string;
  date: string; // yyyy-mm-dd
  slot: MealSlot;
  recipeId: string;
  recipeName: string; // 表示用に非正規化
}

const DAY_MS = 86_400_000;

function parseDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 直近 days 日（今日含む）の食事エントリを新しい順で返す */
export function recentMeals(
  entries: MealEntry[],
  days = 2,
  today: string = todayISO(),
): MealEntry[] {
  const cutoff = parseDate(today) - (days - 1) * DAY_MS;
  return entries
    .filter((e) => parseDate(e.date) >= cutoff)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date));
}

/** 直近 days 日にそのレシピを作ったか（連日回避用） */
export function wasMadeRecently(
  entries: MealEntry[],
  recipeId: string,
  days = 2,
  today: string = todayISO(),
): boolean {
  return recentMeals(entries, days, today).some((e) => e.recipeId === recipeId);
}

/** タイミング選択から、埋めるべきスロット（日付＋昼夜）を展開 */
export function slotsForTiming(
  timing: MealTiming,
  today: string = todayISO(),
): { date: string; slot: MealSlot }[] {
  const tomorrow = (() => {
    const t = parseDate(today) + DAY_MS;
    const d = new Date(t);
    const offsetMs = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
  })();
  switch (timing) {
    case "昼":
      return [{ date: today, slot: "昼" }];
    case "夜":
      return [{ date: today, slot: "夜" }];
    case "両方":
      return [
        { date: today, slot: "昼" },
        { date: today, slot: "夜" },
      ];
    case "翌日も":
      return [
        { date: today, slot: "昼" },
        { date: today, slot: "夜" },
        { date: tomorrow, slot: "昼" },
        { date: tomorrow, slot: "夜" },
      ];
  }
}

import { describe, it, expect } from "vitest";
import { pickResumable, type CookProgressEntry } from "../cookProgress";

// 「作りかけに戻る」をホームに出す条件。
// 出しすぎると常設バナーになって邪魔になり、出さなすぎると導線が無いままになる。
// 判定は純粋関数に切り出してあるので、ここで境界を固定する。

const NOW = Date.parse("2026-07-31T20:00:00+09:00");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function entry(
  recipeId: string,
  doneCount: number,
  agoMs: number,
): CookProgressEntry {
  return { recipeId, doneCount, updatedAt: NOW - agoMs };
}

/** レシピID→作業数 */
function totals(map: Record<string, number>) {
  return (id: string) => map[id] ?? 0;
}

describe("pickResumable", () => {
  it("途中まで進んでいるものを返す", () => {
    const got = pickResumable([entry("curry", 3, 2 * HOUR)], totals({ curry: 7 }), NOW);
    expect(got?.recipeId).toBe("curry");
    expect(got?.doneCount).toBe(3);
  });

  it("**作り終えたものは出さない**（「作った」を押しても進捗は消えない作りなので、ここで弾く）", () => {
    expect(pickResumable([entry("curry", 7, HOUR)], totals({ curry: 7 }), NOW)).toBeNull();
    // 手順が増減してチェック数のほうが多くなっている場合も終わり扱い
    expect(pickResumable([entry("curry", 9, HOUR)], totals({ curry: 7 }), NOW)).toBeNull();
  });

  it("古すぎるものは出さない（1週間前の刻みかけに戻る人はいない）", () => {
    expect(pickResumable([entry("curry", 2, 7 * DAY)], totals({ curry: 7 }), NOW)).toBeNull();
    expect(
      pickResumable([entry("curry", 2, 2 * DAY)], totals({ curry: 7 }), NOW)?.recipeId,
    ).toBe("curry");
  });

  it("削除されたレシピの残骸は出さない（作業数が引けない）", () => {
    expect(pickResumable([entry("gone", 2, HOUR)], totals({}), NOW)).toBeNull();
  });

  it("複数あるときは、条件を満たす**先頭**（＝新しい順の1件目）を返す", () => {
    const list = [entry("new", 1, HOUR), entry("old", 4, 2 * DAY)];
    expect(pickResumable(list, totals({ new: 5, old: 8 }), NOW)?.recipeId).toBe("new");
  });

  it("先頭が対象外なら次を見る（1件目で諦めない）", () => {
    const list = [entry("done", 7, HOUR), entry("wip", 2, 2 * DAY)];
    expect(pickResumable(list, totals({ done: 7, wip: 8 }), NOW)?.recipeId).toBe("wip");
  });

  it("時刻を持たない旧データは、古さでは捨てない（進捗は残っているので拾える）", () => {
    const legacy: CookProgressEntry = { recipeId: "legacy", doneCount: 2, updatedAt: 0 };
    expect(pickResumable([legacy], totals({ legacy: 6 }), NOW)?.recipeId).toBe("legacy");
  });

  it("何も無ければ null（カードごと描かない）", () => {
    expect(pickResumable([], totals({ curry: 7 }), NOW)).toBeNull();
  });
});

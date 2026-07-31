"use client";

// 初回ウェルカム（全画面オーバーレイ・1回だけ・スキップ可）。
// ログイン前トップでも表示。マイページの「使い方を見る」から再表示（window イベント）。
//
// ★ 2026-08-01：4枚のスライドで「説明する」のをやめ、**1画面で最初の1アクションに直行**させた。
//
//   なぜか：ここは初見の人が最初に見る場所で、離脱がいちばん多い場所でもある。
//   前は「AIが勝手に、分量を変えない」→「① まず冷蔵庫に入れる」→「② 在庫だけで提案」→
//   「③ 買い物 & 作った記録」の4枚を読ませてから「はじめる（登録・ログイン）」だった。問題は3つ：
//     1. 1枚目が否定形（Preferences/copywriting-audience.md）。
//        「分量を変える」現象を知らない初見の人には意味が通らない。
//        競合の失点を根拠にした言葉は比較検討層まで下ろす（＝LPやストアの詳細に置く）。
//     2. 4枚読ませても、読み終わった時点で **アプリは何も進んでいない**。
//        「①まず冷蔵庫に入れる」と読ませたあとに、また自分で冷蔵庫を探しに行かせていた。
//     3. 最後のCTAが「登録・ログイン」だった。AppGate はログイン不要にしてあるので、
//        いきなりアカウント作成に送るのは離脱を増やすだけだった。
//
//   いまは「今日なに作るか決まらない」（夕食の悩み1位 65.8%）を言い当てて、
//   ボタン1つで /fridge の「あと3つ」画面に着地させる。説明は3行だけ残す。

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Camera, ChefHat, Hand, X } from "lucide-react";
import { setGuide } from "@/lib/guide";
import { SUGGEST_THRESHOLD } from "@/lib/starter";

const FLAG = "cooksync:onboarded:v1";
export const OPEN_EVENT = "cooksync:tutorial";

// 「読ませる」ためではなく「これなら自分にもできそう」と思ってもらうための3行。
// 手順の説明ではなく、**その人の手間がどれだけ小さいか**を書く。
const POINTS: { Icon: typeof Camera; text: string }[] = [
  { Icon: Camera, text: "冷蔵庫を1枚撮れば、写っている食材をまとめて読み取ります" },
  { Icon: Hand, text: "よく買うものはタップで入ります。全部そろえなくて大丈夫です" },
  { Icon: ChefHat, text: "あるものだけで作れる料理と、足りない分の買い物リストが出ます" },
];

export default function Onboarding() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      // 初回（未オンボード）だけ表示＝localStorageとの同期。意図的な初回setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!window.localStorage.getItem(FLAG)) setOpen(true);
    } catch {
      /* noop */
    }
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(FLAG, "1");
    } catch {
      /* noop */
    }
    setOpen(false);
  }, []);

  if (!open || pathname === "/lp") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center">
      {/* max-h は EditItemForm と同じ理由で dvh（vh はキーボード表示中に縮まない） */}
      <div className="flex max-h-[88dvh] w-full max-w-sm flex-col overflow-y-auto overscroll-contain rounded-3xl bg-paper p-6 shadow-xl">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={finish}
            className="flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-medium text-ink-soft transition hover:bg-line/40"
          >
            {/* 「あとで」だけだと、押したあと何が起きるか分からない。
                動作（見てまわる）＋結果（このまま＝閉じてアプリに残る）を書く。 */}
            あとで自分で見てまわる
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* 初見の人が既に持っている悩みの言葉で、肯定形で書く */}
        <h2 className="font-display text-xl leading-snug font-bold text-brand-dark">
          今日なに作るか、
          <br />
          まだ決まっていないなら
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
          いま家にあるものを{SUGGEST_THRESHOLD}つ入れるだけで、今日の一品が決まります。
        </p>

        <ul className="mt-4 flex flex-col gap-2.5">
          {POINTS.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft">
                <Icon className="h-4 w-4 text-brand" strokeWidth={2} aria-hidden />
              </span>
              <span className="text-xs leading-relaxed text-ink">{text}</span>
            </li>
          ))}
        </ul>

        {/* 説明を読み終わらせるのが目的ではないので、出口は1つだけ＝最初の1アクションに直行 */}
        <button
          type="button"
          onClick={() => {
            finish();
            setGuide("fridge");
            router.push("/fridge");
          }}
          className="mt-6 min-h-[44px] w-full rounded-full bg-brand py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
        >
          {/* 動作（入れる）＋対象（家にあるもの）＋結果（献立が出る）。
              「入れる」だけだと、入れた先に何があるのかが書かれていない。 */}
          家にあるものを入れて献立を出す
        </button>
        <p className="mt-2 text-center text-xs text-ink-soft">
          登録もログインも要りません
        </p>
      </div>
    </div>
  );
}

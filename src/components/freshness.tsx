"use client";

// 賞味期限の信号表示（🔴🟡🟢の置き換え）。lucideアイコン＋色付きピル＋色帯でスタイリッシュに。
// food.ts は純ロジック（ラベル文言）に保ち、見た目はここに集約。

import { Flame, Clock, Leaf, type LucideIcon } from "lucide-react";
import { FRESHNESS, type Freshness, type FreshnessBucket } from "@/lib/food";

interface FreshUi {
  Icon: LucideIcon;
  badge: string; // ピル（淡背景＋文字＋リング）
  accentBorder: string; // カード左の色帯
  dot: string; // ドット色
}

export const FRESHNESS_UI: Record<Freshness, FreshUi> = {
  expired: {
    Icon: Flame,
    badge: "bg-red-50 text-red-600 ring-1 ring-red-200",
    accentBorder: "border-l-red-400",
    dot: "bg-red-500",
  },
  urgent: {
    Icon: Flame,
    badge: "bg-red-50 text-red-600 ring-1 ring-red-200",
    accentBorder: "border-l-red-400",
    dot: "bg-red-500",
  },
  soon: {
    Icon: Clock,
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    accentBorder: "border-l-amber-400",
    dot: "bg-amber-400",
  },
  fresh: {
    Icon: Leaf,
    badge: "bg-brand-soft text-brand-dark ring-1 ring-brand/20",
    accentBorder: "border-l-brand",
    dot: "bg-brand",
  },
};

export function FreshnessBadge({
  freshness,
  daysLeft,
}: {
  freshness: Freshness;
  daysLeft: number;
}) {
  const ui = FRESHNESS_UI[freshness];
  const Icon = ui.Icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ui.badge}`}
    >
      <Icon size={13} strokeWidth={2.4} />
      {FRESHNESS[freshness].label(daysLeft)}
    </span>
  );
}

// 冷蔵庫サマリ用（超優先/優先/余裕）
export const BUCKET_UI: Record<
  FreshnessBucket,
  { Icon: LucideIcon; label: string; tint: string; num: string }
> = {
  priority: {
    Icon: Flame,
    label: "超優先",
    tint: "bg-red-50 text-red-500 ring-1 ring-red-100",
    num: "text-red-600",
  },
  soon: {
    Icon: Clock,
    label: "優先",
    tint: "bg-amber-50 text-amber-500 ring-1 ring-amber-100",
    num: "text-amber-600",
  },
  fresh: {
    Icon: Leaf,
    label: "余裕あり",
    tint: "bg-brand-soft text-brand ring-1 ring-brand/15",
    num: "text-brand-dark",
  },
};

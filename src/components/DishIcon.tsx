import Image from "next/image";
import { dishIconOf, dishIconSrc, type DishIconName } from "@/lib/dishIcon";
import type { StapleType } from "@/lib/recipe";

// レシピの絵文字の代わりに出す専用イラスト。
// 料理名から型を判定して public/icons/dish/*.svg（recraft製ベクター）を出す。

const TINT: Record<string, string> = {
  和: "bg-emerald-50",
  洋: "bg-amber-50",
  中: "bg-rose-50",
  アジアン: "bg-orange-50",
};

export default function DishIcon({
  name,
  staple,
  cuisine,
  size = 40,
  tile = true,
  className = "",
}: {
  /** 料理名（これでイラストを決める） */
  name: string;
  staple?: StapleType;
  /** タイル背景の色分けに使う（和洋中） */
  cuisine?: string;
  /** イラストの表示サイズ(px) */
  size?: number;
  /** 角丸タイルの上に載せるか（false＝イラストだけ） */
  tile?: boolean;
  className?: string;
}) {
  const icon: DishIconName = dishIconOf(name, staple);
  const img = (
    <Image
      src={dishIconSrc(icon)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
  if (!tile) return img;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl ${
        TINT[cuisine ?? ""] ?? "bg-brand-soft"
      } ${className}`}
      style={{ width: size * 1.5, height: size * 1.5 }}
    >
      {img}
    </span>
  );
}

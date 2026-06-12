"use client";

// レシピのサムネ。画像があれば表示、無い/読み込み失敗（404等）なら
// ジャンル別グラデ＋絵文字に必ずフォールバック（「？」の壊れ画像を出さない）。
import { useState } from "react";
import Image from "next/image";

const CUISINE_GRADIENT: Record<string, string> = {
  和: "from-emerald-100 to-lime-50",
  洋: "from-amber-100 to-orange-50",
  中: "from-rose-100 to-orange-50",
  アジアン: "from-orange-100 to-yellow-50",
};

interface Props {
  image?: string;
  emoji?: string;
  cuisine?: string;
  alt: string;
  sizes?: string;
  emojiClass?: string;
}

export default function RecipeThumb({
  image,
  emoji,
  cuisine,
  alt,
  sizes,
  emojiClass = "text-5xl",
}: Props) {
  // 失敗はURL単位で記録：再生成でURL(?v=)が変われば自動で再試行する
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === image;

  if (image && !failed) {
    return (
      <Image
        src={image}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
        onError={() => setFailedFor(image)}
      />
    );
  }

  return (
    <div
      className={`grid h-full w-full place-items-center bg-gradient-to-br ${emojiClass} ${
        CUISINE_GRADIENT[cuisine ?? ""] ?? "from-brand-soft to-emerald-50"
      }`}
    >
      <span aria-hidden>{emoji || "🍽"}</span>
    </div>
  );
}

"use client";

import { Star } from "lucide-react";

// 5つ星評価。onChange があればタップで設定（同じ星をタップで解除）、無ければ表示専用。
export default function StarRating({
  value,
  onChange,
  size = 20,
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
}) {
  const interactive = typeof onChange === "function";
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const star = (
          <Star
            size={size}
            strokeWidth={1.5}
            className={
              filled ? "fill-amber-400 text-amber-400" : "fill-none text-line"
            }
          />
        );
        if (!interactive) {
          return (
            <span key={n} aria-hidden>
              {star}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(value === n ? 0 : n)}
            className="p-0.5 transition active:scale-90"
            aria-label={`${n}つ星`}
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}

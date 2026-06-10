import Image from "next/image";

// HiggsField製の透過アイコン（フラット緑×クリームで統一）。絵文字の置き換え用。
const ICONS = {
  fridge: "/icons/fridge.png",
  meal: "/icons/meal.png",
  recipe: "/icons/recipe.png",
  shopping: "/icons/shopping.png",
  camera: "/icons/camera.png",
  timer: "/icons/timer.png",
  star: "/icons/star.png",
  loop: "/icons/loop.png",
  signal: "/icons/signal.png",
  check: "/icons/check.png",
} as const;

export type IconName = keyof typeof ICONS;

export default function AppIcon({
  name,
  size = 22,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={ICONS[name]}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain align-[-0.2em] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

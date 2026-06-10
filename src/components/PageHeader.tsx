import Image from "next/image";

interface Props {
  kicker?: string; // 互換のため受け取るが現デザインでは未使用
  title: string;
  tagline?: string;
  icon?: string; // 透過アイコンのパス（例: /icons/fridge.png）
  tint?: string; // アイコンタイルの背景色（Tailwindクラス）。色分けで単調さを回避
}

export default function PageHeader({
  title,
  tagline,
  icon,
  tint = "bg-brand-soft",
}: Props) {
  return (
    <header className="mb-6 flex items-center gap-3.5">
      {icon && (
        <span
          className={`grid h-16 w-16 shrink-0 place-items-center rounded-3xl shadow-sm ${tint}`}
        >
          <Image
            src={icon}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 object-contain"
          />
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-brand-dark">
          {title}
        </h1>
        {tagline && (
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{tagline}</p>
        )}
      </div>
    </header>
  );
}

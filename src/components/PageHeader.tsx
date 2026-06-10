import type { LucideIcon } from "lucide-react";

interface Props {
  kicker?: string; // 互換のため受け取るが現デザインでは未使用
  title: string;
  tagline?: string;
  Icon?: LucideIcon; // 左上のアイコン（lucide＝ボトムナビと同系のシンプル線画）
  iconClass?: string; // アイコンの色（Tailwindクラス）。ページごとに色分け
}

export default function PageHeader({
  title,
  tagline,
  Icon,
  iconClass = "text-brand",
}: Props) {
  return (
    <header className="mb-6 flex items-center gap-3.5">
      {Icon && (
        <Icon
          className={`h-14 w-14 shrink-0 ${iconClass}`}
          strokeWidth={1.5}
          aria-hidden
        />
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

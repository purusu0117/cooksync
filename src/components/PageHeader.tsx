import Image from "next/image";

interface Props {
  kicker?: string; // 互換のため受け取るが現デザインでは未使用
  title: string;
  tagline?: string;
  icon?: string; // 透過アイコンのパス（例: /icons/fridge.png）
}

export default function PageHeader({ title, tagline, icon }: Props) {
  return (
    <header className="mb-6 flex items-center gap-3">
      {icon && (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft">
          <Image src={icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
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

interface Props {
  kicker?: string; // 互換のため受け取るが現デザインでは未使用
  title: string;
  tagline?: string;
}

export default function PageHeader({ title, tagline }: Props) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-brand-dark">
        {title}
      </h1>
      {tagline && (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{tagline}</p>
      )}
    </header>
  );
}

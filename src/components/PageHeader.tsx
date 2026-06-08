interface Props {
  kicker: string;
  title: string;
  tagline?: string;
}

export default function PageHeader({ kicker, title, tagline }: Props) {
  return (
    <header className="mb-7">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-ink-soft">
        {kicker}
      </p>
      <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-ink">
        {title}
      </h1>
      <div className="mt-2.5 h-px w-10 bg-accent" />
      {tagline && (
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{tagline}</p>
      )}
    </header>
  );
}

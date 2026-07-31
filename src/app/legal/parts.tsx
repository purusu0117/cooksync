// 法務・サポートページ用の小さな組版部品（読みやすさ優先・アプリ本体のトークンに合わせる）
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-ink">
        {children}
      </div>
    </section>
  );
}

export function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}

export function Faint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-ink-soft">{children}</p>;
}

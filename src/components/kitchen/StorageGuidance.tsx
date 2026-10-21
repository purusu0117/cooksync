"use client";
import { useState } from "react";
import { storageGuidance, type SafetyConditions } from "@/lib/kitchen/foodSafety";
export default function StorageGuidance({ conditions }: { conditions: SafetyConditions }) {
  const [stew, setStew] = useState(false);
  const guide = storageGuidance({ ...conditions, category: stew ? "stew" : "other" });
  return <details className="rounded-xl bg-stone-50 p-3 text-sm"><summary className="min-h-11 cursor-pointer font-semibold">保存方法の根拠と確認事項</summary>
    {conditions.kind === "prepared" && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={stew} onChange={e => setStew(e.target.checked)} />カレー・シチューなどの煮込み料理</label>}
    {guide.items.map((item, i) => <div className="mb-3" key={i}><p>{item.text}</p><a href={item.source.url} target="_blank" rel="noreferrer" className="text-xs underline">{item.source.title}（確認 {item.source.verifiedOn}）</a></div>)}
    {!!guide.unknown.length && <p className="text-xs">未確認：{guide.unknown.join("、")}</p>}<p className="text-xs">{guide.limitation}</p>
  </details>;
}

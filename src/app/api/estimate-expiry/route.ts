export const dynamic = "force-dynamic";
/** A food name/opened flag alone cannot substantiate a safe storage duration. */
export async function POST() {
  return Response.json({ results: [], status: "needs_conditions", message: "保存期限は未確認です。食品・調理・保存温度と、包装表示など確認できる根拠を登録してください。" }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ error: "画像生成は停止中です" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
/** Anthropic's recipe-reading API is not an image-generation service. Never use a hidden CLI. */
export async function POST() {
  return Response.json({ disabled: true, reason: "料理画像の生成は未設定です。登録済みの画像・アイコンを表示します。" }, { headers: { "Cache-Control": "no-store" } });
}

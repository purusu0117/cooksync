import { getPublicKey } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ key: await getPublicKey() });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "vapid error" },
      { status: 500 },
    );
  }
}

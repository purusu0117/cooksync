import { addSubscription } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

interface SubBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(request: Request) {
  try {
    const sub = (await request.json()) as SubBody;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return Response.json({ error: "invalid subscription" }, { status: 400 });
    }
    await addSubscription({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "subscribe failed" },
      { status: 500 },
    );
  }
}

import { getImageJob } from "@/lib/imageJobs";

export const dynamic = "force-dynamic";

/** 画像生成ジョブの進捗。done なら image（/recipes/<id>.png?v=…）を返す。 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId") ?? "";
  const job = getImageJob(jobId);
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ status: job.status, image: job.image, error: job.error });
}

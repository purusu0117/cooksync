import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { after as nextAfter } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { aiConfiguration, aiJobCancelled, cancelAiJob, budgetKey, ownsAiJob, registerAiJob, requireAiConfiguration, reserveAttempt, settleAttempt, type AiScope } from "./aiBudget";
import { kitchenIdentity, requireSameOrigin } from "./identity";
import { readKitchenData } from "./server";
import { KitchenError } from "./engine";
import { atomicDocument } from "./atomicDocument";
import { MAX_AI_REQUEST_BYTES } from "./limits";
import { APPROVED_AI_RATES } from "./aiPricing";
const context = new AsyncLocalStorage<AiScope>();
export function managedAfter(task: () => Promise<void>) { const scope = context.getStore(); nextAfter(() => scope ? context.run(scope, task) : task()); }
export function requireAiScope(): AiScope { const scope = context.getStore(); if (!scope) throw new KitchenError("認可済みのAIジョブから実行してください", 403); return scope; }
export async function requestScope(request: Request): Promise<AiScope> {
  requireSameOrigin(request);
  const user = kitchenIdentity(request); if (!user.trusted) throw new KitchenError("利用者を確認してください", 401);
  const expectedOwner = request.headers.get("x-cooksync-owner");
  if (expectedOwner && expectedOwner !== user.dataId) throw new KitchenError("利用者が変わりました。処理を開始し直してください", 409);
  const locationId = request.headers.get("x-cooksync-location-id") || new URL(request.url).searchParams.get("locationId") || "";
  const { state } = await readKitchenData(user.dataId);
  if (!state?.locations.some(l => l.id === locationId)) throw new KitchenError("この場所は利用できません", 403);
  return { owner: user.dataId, locationId, jobId: randomUUID(), environment: aiConfiguration().environment };
}
export function withAiRequest(handler: (request: Request) => Promise<Response>, polling = false) {
  return async (request: Request): Promise<Response> => {
    try {
      const scope = await requestScope(request);
      if (polling) { const id = new URL(request.url).searchParams.get("jobId") || ""; if (!await ownsAiJob(scope, id)) throw new KitchenError("ジョブが見つかりません", 404); if (await aiJobCancelled(scope, id)) return Response.json({ status: "cancelled", error: "取消済みです。実行済みの費用は照合まで保持します" }, { headers: { "Cache-Control": "no-store, private" } }); }
      else requireAiConfiguration();
      let receiptKey = "";
      if (!polling) {
        const operation = request.headers.get("x-cooksync-operation-id") || "";
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(operation)) throw new KitchenError("AI操作IDを付けて開始してください", 400);
        scope.jobId = operation;
        const chunks: Uint8Array[] = []; let length = 0;
        const reader = request.body?.getReader();
        if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > MAX_AI_REQUEST_BYTES) { await reader.cancel(); throw new KitchenError("アップロードの上限を超えています。写真は合計3MB以内にしてください", 413); } chunks.push(value); }
        const body = Buffer.concat(chunks), fingerprint = createHash("sha256").update(request.url).update(body).digest("hex");
        receiptKey = `cooksync:ai-request:${scope.environment}:${scope.owner}:${operation}`;
        const prior = await atomicDocument<{ fingerprint: string; locationId: string; started: boolean; response?: { status: number; body: unknown } }, { status: number; body: unknown } | null>(receiptKey, () => ({ fingerprint, locationId: scope.locationId, started: false }), receipt => {
          if (receipt.fingerprint !== fingerprint || receipt.locationId !== scope.locationId) throw new KitchenError("同じAI操作の内容が変わっています", 409);
          if (receipt.response) return receipt.response;
          if (receipt.started) throw new KitchenError("このAI操作は開始済みです。ジョブの結果を確認してください", 409);
          receipt.started = true; return null;
        });
        if (prior) {
          if (await aiJobCancelled(scope)) return Response.json({ status: "cancelled", error: "取消済みの処理です" }, { status: 409 });
          return Response.json(prior.body, { status: prior.status, headers: { "Cache-Control": "no-store, private" } });
        }
        await registerAiJob(scope, operation);
        request = new Request(request.url, { method: request.method, headers: request.headers, body });
      }
      return await context.run(scope, async () => {
        let response = await handler(request);
        if (!polling && await aiJobCancelled(scope)) response = Response.json({ status: "cancelled", error: "処理を取り消しました。結果は適用していません" }, { status: 409 });
        if (!polling) {
          const body = await response.clone().json();
          if (response.ok && typeof body.jobId === "string") await registerAiJob(scope, body.jobId);
          await atomicDocument<{ response?: { status: number; body: unknown } }, void>(receiptKey, () => ({}), receipt => { receipt.response = { status: response.status, body }; });
        }
        const headers = new Headers(response.headers); headers.set("Cache-Control", "no-store, private"); headers.set("X-CookSync-Location", scope.locationId);
        return new Response(response.body, { status: response.status, headers });
      });
    } catch (e) { return Response.json({ error: e instanceof KitchenError ? e.message : "AI処理を開始できませんでした" }, { status: e instanceof KitchenError ? e.status : 503 }); }
  };
}
export async function requireActiveAiJob(): Promise<void> {
  if (await aiJobCancelled(requireAiScope())) throw new KitchenError("AI処理は取消済みです", 409);
}
export async function cancelAiRequest(request: Request): Promise<Response> {
  try {
    const scope = await requestScope(request), id = new URL(request.url).searchParams.get("jobId") || "";
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new KitchenError("ジョブを確認してください");
    await cancelAiJob(scope, id);
    return Response.json({ status: "cancelled" }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (e) { return Response.json({ error: e instanceof KitchenError ? e.message : "取消を確認できませんでした" }, { status: e instanceof KitchenError ? e.status : 503 }); }
}
/** SDK retries are disabled. Every provider request gets its own atomic budget reservation. */
export async function managedMessage(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  const scope = requireAiScope(), config = requireAiConfiguration();
  await requireActiveAiJob();
  // Conservative full-context upper bound; unsupported model pricing fails closed.
  const rate = APPROVED_AI_RATES[params.model]; if (!rate) throw new KitchenError("このモデルの料金と利用可否を確認してください", 503);
  if (JSON.stringify(params).length > 24 * 1024 * 1024 || params.max_tokens > 16000) throw new KitchenError("AI入力が上限を超えています", 413);
  // No prompt caching or unbounded tool loops. Search limit is explicit for each request.
  const tools = params.tools?.map(tool => tool.type === "web_search_20250305" ? { ...tool, max_uses: 2, allowed_callers: ["direct" as const] } : tool);
  if (tools?.some(t => t.type !== "web_search_20250305")) throw new KitchenError("未確認のAIツールです", 503);
  // Text bytes conservatively bound tokens; each validated image reserves 32k tokens.
  // Search may fill context, so reserve the entire 1M-token ceiling for those requests.
  let inputBound = Buffer.byteLength(JSON.stringify(params.system || "")) + 4096;
  for (const message of params.messages) {
    if (typeof message.content === "string") inputBound += Buffer.byteLength(message.content);
    else for (const block of message.content) inputBound += block.type === "image" ? 32000 : Buffer.byteLength(JSON.stringify(block));
  }
  inputBound = tools?.length ? 1000000 : inputBound;
  if (inputBound > 1000000) throw new KitchenError("AI入力が上限を超えています", 413);
  const ceiling = inputBound * rate[0] * 2 + params.max_tokens * rate[1] + (tools?.length ? 20000 : 0);
  const key = budgetKey(scope.environment, config.org), attemptId = randomUUID();
  await reserveAttempt(key, attemptId, scope, ceiling, config.limit);
  const controller = new AbortController();
  let checking = false;
  const timer = setInterval(() => { if (checking) return; checking = true; void aiJobCancelled(scope).then(cancelled => { if (cancelled) controller.abort(); }).catch(() => controller.abort()).finally(() => { checking = false; }); }, 1000);
  try {
    await requireActiveAiJob();
    const result = await client.messages.create({ ...params, tools, stream: false }, { maxRetries: 0, timeout: 120000, signal: controller.signal });
    const usage = result.usage;
    const search = usage.server_tool_use?.web_search_requests || 0;
    const cache = (usage.cache_creation_input_tokens || 0) * rate[0] * 2 + Math.ceil((usage.cache_read_input_tokens || 0) * rate[0] / 10);
    const actual = usage.input_tokens * rate[0] + usage.output_tokens * rate[1] + search * 10000 + cache;
    await settleAttempt(key, attemptId, actual, (result as Anthropic.Message & { _request_id?: string })._request_id);
    await requireActiveAiJob();
    return result;
  } catch (e) { await settleAttempt(key, attemptId, null).catch(() => {}); throw e; }
  finally { clearInterval(timer); }
}

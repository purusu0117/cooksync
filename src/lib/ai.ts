// Server-only Anthropic API. Authorized location and approved budget are mandatory.
// Missing configuration stops inference; developer-machine CLI fallback is disabled.

import { managedMessage, requireAiScope } from "./kitchen/managedAi";
import { requireAiConfiguration } from "./kitchen/aiBudget";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { logAiCost, logAiCostEstimated, usageFrom } from "./aiCost";

// CLI fallback is disabled. Every provider call requires an authorized location and budget.

// === DEPLOY SEAM (A) ===
// A key alone does not enable use: api() also verifies the approved configuration.
const USE_API = !!process.env.ANTHROPIC_API_KEY;

// モデルは**タスクの難しさで振り分ける**（全部Sonnetにすると原価が数倍になる）。
//   MAIN  … レシピ探索・写真からレシピ（品質が売りそのもの。ここは削らない）
//   CHEAP … 食材名の読み取り・校正・整形（定型で短い。Haikuで十分＝1/3の単価）
// 実測の裏取りは .data/ai-cost.json（logAiCost）。
const MAIN_MODEL = process.env.COOKSYNC_AI_MODEL || "claude-sonnet-5";
const CHEAP_MODEL = process.env.COOKSYNC_AI_MODEL_CHEAP || "claude-haiku-4-5";

// SDKの既定は timeout=10分・maxRetries=2。つまり最悪 30分 1本のリクエストで粘る。
// Route Handler 側は maxDuration=300（5分）なので、既定のままだと**必ず先に**
// after() が殺され、catch も走らず、ジョブが status:"running" のまま Redis に
// 30分残る（クライアントは回り続けて、30分後にやっと失敗が出る）。
// SDK retries are disabled; each explicit retry needs a separate budget reservation.
const API_TIMEOUT_MS = 120_000;
const API_MAX_RETRIES = 0;

let _client: Anthropic | null = null;
function api(): Anthropic {
  requireAiScope(); requireAiConfiguration();
  // ANTHROPIC_API_KEY を自動参照。timeout はミリ秒（TypeScript SDK）。
  if (!_client)
    _client = new Anthropic({ timeout: API_TIMEOUT_MS, maxRetries: API_MAX_RETRIES });
  return _client;
}
function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

const SYSTEM_VISION_API =
  "You are a food-recognition API. Look at the image and output ONLY the requested JSON object (no prose, no code fences).";

/** API: テキスト1往復（Webなし）。校正・整形なので安いモデルで足りる。 */
async function apiText(system: string, prompt: string): Promise<string> {
  const msg = await managedMessage(api(), {
    model: CHEAP_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  await logAiCost("text", usageFrom(CHEAP_MODEL, msg));
  return textOf(msg).trim();
}

/** API: Web検索ツール付きで研究（pause_turn は数回まで継続）。
 *  web_search_20260209 ＝ dynamic filtering 版。検索結果をコード実行で絞ってから
 *  コンテキストに入れるので、基本版より入力トークンが大幅に減る（原価の主因がここ）。 */
async function apiResearch(prompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const params = {
    model: MAIN_MODEL,
    max_tokens: 16000,
    system: SYSTEM_JSON,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const }],
  };
  // ⚠️ タイムアウトで例外が飛ぶと usage が取れないが、**Anthropic側の生成は完走していて
  //    課金は発生している**。記録が残らないと月間予算の上限が静かに破られる（監査 高-8）。
  //    さらに maxRetries で1回自動再実行されるので、1操作で最大2回分が未記録になる。
  //    実測が取れない以上、見積もりで記録して安全側に倒す。
  try {
    let msg = await managedMessage(api(), { ...params, messages });
    await logAiCost("research", usageFrom(MAIN_MODEL, msg));
    let guard = 0;
    while (msg.stop_reason === "pause_turn" && guard++ < 4) {
      messages.push({ role: "assistant", content: msg.content });
      msg = await managedMessage(api(), { ...params, messages });
      // 継続分も課金されるので必ず足す（ここを漏らすと実測が過小になる）
      await logAiCost("research", usageFrom(MAIN_MODEL, msg));
    }
    return textOf(msg);
  } catch (e) {
    await logAiCostEstimated("research").catch(() => {});
    throw e;
  }
}

/** API: 画像つきで研究（動画のコマを見せながらWeb検索も許す）。
 *  apiResearch と同じ pause_turn ループだが、最初のユーザーメッセージに画像が入る。 */
async function apiResearchWithImages(prompt: string, imagePaths: string[]): Promise<string> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const buf = await fs.readFile(imagePaths[i]);
    const media: "image/png" | "image/jpeg" = imagePaths[i].endsWith(".png")
      ? "image/png"
      : "image/jpeg";
    blocks.push({ type: "text", text: `コマ${i + 1}:` });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: media, data: buf.toString("base64") },
    });
  }
  blocks.push({ type: "text", text: prompt });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: blocks }];
  const params = {
    model: MAIN_MODEL,
    max_tokens: 16000,
    system: SYSTEM_JSON,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const }],
  };
  try {
    let msg = await managedMessage(api(), { ...params, messages });
    await logAiCost("import", usageFrom(MAIN_MODEL, msg));
    let guard = 0;
    while (msg.stop_reason === "pause_turn" && guard++ < 4) {
      messages.push({ role: "assistant", content: msg.content });
      msg = await managedMessage(api(), { ...params, messages });
      await logAiCost("import", usageFrom(MAIN_MODEL, msg));
    }
    return textOf(msg);
  } catch (e) {
    await logAiCostEstimated("research").catch(() => {});
    throw e;
  }
}

/** API: 画像（base64）から食材名。
 *  「写っている食材の名前を挙げる」だけの定型タスクなので CHEAP で足りる。
 *  Haiku 4.5 は画像1枚あたりのトークン上限も低い（〜1,568）ので二重に安い。 */
async function apiVisionItems(imagePath: string): Promise<string[]> {
  const buf = await fs.readFile(imagePath);
  const media: "image/png" | "image/jpeg" = imagePath.endsWith(".png")
    ? "image/png"
    : "image/jpeg";
  const msg = await managedMessage(api(), {
    model: CHEAP_MODEL,
    max_tokens: 1024,
    system: SYSTEM_VISION_API,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: media, data: buf.toString("base64") },
          },
          {
            type: "text",
            text: '写っている食材だけを日本語の一般名でリスト化。調理済みの完成料理・食器・背景は無視。同じ食材は1つに。出力はJSONだけ: {"items":["…","…"]}',
          },
        ],
      },
    ],
  });
  await logAiCost("scan", usageFrom(CHEAP_MODEL, msg));
  const obj = extractJson<{ items?: unknown }>(textOf(msg));
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}

// 役割固定の system prompt（英語＝Windows argvでも文字化けしない）。
// プロジェクトのCLAUDE.md/AGENTS.mdに引きずられないよう明示。
const SYSTEM_JSON =
  // ⚠️ 日本語の強制はここ（system）に置く。ユーザープロンプトが日本語でも、
  //    Web検索が英語ソースを拾うとモデルが英語で書いてしまうことがある
  //    （2026-08-01・ローカルCLI経路のAI探索が全部英語になった実害）。
  "You are a recipe-research API. All human-readable string values in your JSON output (name, catch, steps, tips, labels, storage notes, etc.) MUST be written in natural Japanese — translate into Japanese even when your web sources are in English. Output ONLY the single JSON object that the user asks for — no surrounding prose, no markdown code fences, no explanation. Never edit files, write code, or perform any other task. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

const SYSTEM_TEXT =
  "You are a friendly Japanese home-cooking assistant inside an app. Answer concisely in Japanese plain text only (no markdown, no code). Never edit files or do any other task. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

const SYSTEM_VISION =
  "You are a food-recognition API. Use the Read tool to view the given local image file, then output ONLY the requested JSON object (no prose, no code fences). Never edit files. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

// 動画のコマ（ローカルの画像ファイル）を Read で開きつつ、出典確認のためWeb検索も許す用。
const SYSTEM_VIDEO =
  "You are a recipe-research API. Use the Read tool to view every local image file the user lists (they are frames extracted from a cooking video), and you may use WebSearch/WebFetch to confirm the official recipe. All human-readable string values in your JSON output MUST be natural Japanese. Output ONLY the single JSON object the user asks for — no prose, no markdown code fences. Never edit files. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

/** Compatibility failure for old call sites; never starts a CLI process. */
function runClaude(
  prompt: string,
  allowWeb = true,
  system: string = SYSTEM_JSON,
  tools?: string[],
): Promise<string> {
  void prompt; void allowWeb; void system; void tools;
  return Promise.reject(new Error("API接続は停止中です。開発者PCのCLIへは切り替えません。"));
}

/** テキストから最初のJSONオブジェクトを抜き出してパース（```json フェンス対応） */
export function extractJson<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in model output");
  return JSON.parse(t.slice(start, end + 1)) as T;
}

/** プロンプトを渡してプレーンテキストを得る（Web無し＝速い・軽い） */
export async function askClaudeText(prompt: string): Promise<string> {
  if (USE_API) return apiText(SYSTEM_TEXT, prompt);
  const text = await runClaude(prompt, false, SYSTEM_TEXT);
  return text.trim();
}

/** プロンプトを渡してJSONを得る（Web研究あり） */
export async function askClaudeForJson<T>(prompt: string): Promise<T> {
  const text = USE_API ? await apiResearch(prompt) : await runClaude(prompt, true);
  try {
    return extractJson<T>(text);
  } catch {
    throw new Error(`JSON parse failed. raw=${text.slice(0, 600)}`);
  }
}

/**
 * 画像（動画から抜いたコマ）を見せたうえでJSONを得る。Web検索も許す。
 * ローカルCLI経路では Read でファイルを開かせ、API経路では base64 で送る。
 */
export async function askClaudeForJsonWithImages<T>(
  prompt: string,
  imagePaths: string[],
): Promise<T> {
  if (imagePaths.length === 0) return askClaudeForJson<T>(prompt);
  let text: string;
  if (USE_API) {
    text = await apiResearchWithImages(prompt, imagePaths);
  } else {
    const list = imagePaths.map((p, i) => `コマ${i + 1}: ${p}`).join("\n");
    const withFiles = [
      `次の${imagePaths.length}枚の画像は、この動画から時系列順に等間隔で抜き出したコマです。`,
      "**Read ツールで全部開いて、実際に映像を見てから**書き起こしてください。",
      list,
      "",
      prompt,
    ].join("\n");
    text = await runClaude(withFiles, true, SYSTEM_VIDEO, ["Read", "WebSearch", "WebFetch"]);
  }
  try {
    return extractJson<T>(text);
  } catch {
    throw new Error(`JSON parse failed. raw=${text.slice(0, 600)}`);
  }
}

/**
 * recipes 配列を「途中で切れていても」救出する寛容パーサ。
 * モデル出力が長く末尾が欠けても、完成しているレシピだけ拾う（errorで全滅させない）。
 */
export function parseRecipesTolerant(text: string): unknown[] {
  try {
    const obj = extractJson<{ recipes?: unknown[] }>(text);
    if (Array.isArray(obj.recipes) && obj.recipes.length) return obj.recipes;
  } catch {
    /* 続けてサルベージ */
  }
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const key = t.indexOf('"recipes"');
  const arrStart = key >= 0 ? t.indexOf("[", key) : -1;
  if (arrStart < 0) return [];
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;
  for (let p = arrStart + 1; p < t.length; p++) {
    const c = t[p];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) objStart = p;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(t.slice(objStart, p + 1)));
        } catch {
          /* 不完全な末尾オブジェクトは捨てる */
        }
        objStart = -1;
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }
  return out;
}

/** レシピ研究：途中欠けに強い形でレシピ配列を返す */
export async function askClaudeRecipes(prompt: string): Promise<unknown[]> {
  const text = USE_API ? await apiResearch(prompt) : await runClaude(prompt, true);
  return parseRecipesTolerant(text);
}

/** 画像ファイルを見て、写っている食材名（日本語）の配列を返す（冷蔵庫の写真入力用） */
export async function askClaudeVisionItems(imagePath: string): Promise<string[]> {
  if (USE_API) return apiVisionItems(imagePath);
  const prompt = [
    "次の画像ファイルを Read ツールで開いて、写っている食材だけを日本語の一般名でリスト化してください。",
    "・包装や見た目から具体的な名前にする（例：豚こま肉、玉ねぎ、牛乳、卵、絹豆腐、にんじん）。",
    "・食器・人・背景・調理済みの完成料理は無視し、“食材/食品そのもの”を挙げる。",
    "・同じ食材は1つにまとめる。数量や賞味期限は不要。",
    `ファイル: ${imagePath}`,
    '出力はJSONだけ: {"items":["…","…"]}',
  ].join("\n");
  const text = await runClaude(prompt, false, SYSTEM_VISION, ["Read"]);
  const obj = extractJson<{ items?: unknown }>(text);
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}

/**
 * 写真（レシピ本・スクショ・手書きメモ・料理写真）からレシピJSONを読み取る。
 * 複数枚を渡せる。**順番がバラバラでもよい**（調理の進行から並べ直させる）。
 * ⚠️ 写真に写っていない分量を推測で埋めさせない（[[mistakes]] 2026-05-22 の再発防止）。
 */
export async function askClaudeVisionRecipe<T>(imagePaths: string[]): Promise<T> {
  const many = imagePaths.length > 1;
  const rules = [
    many
      ? `${imagePaths.length}枚の画像は**同じ1つの料理**のものです。全部を突き合わせて1つのレシピにまとめ、JSONにしてください。`
      : "この画像から料理のレシピを読み取り、JSONにしてください。",
    "",
    ...(many
      ? [
          "【並び順について】",
          "- 渡した画像の順番は**バラバラかもしれません**。調理が進む順に並べ直してから手順を書いてください。",
          "- 並べ替えの手がかりは次の優先順で使う：",
          "  ①写真に写っている番号・①②③・「STEP2」・ページ番号など明示的な順序表記",
          "  ②食材の状態の進行（丸ごと→切った→炒めた→煮えた→盛り付け・完成）",
          "  ③調理器具の変化（まな板→フライパン→鍋→器）、色や焼き色の付き方、水分の減り方",
          "- 判断した並び順を photoOrder に「渡された画像の番号（1始まり）」で入れる。",
          "  例：3枚目→1枚目→2枚目の順だと判断したら [3,1,2]。",
          "- 各手順には、その根拠になった画像番号を fromPhoto に入れる。",
          "- **順番が確信を持てない場合は、その手順の text の末尾に「（順序は要確認）」と書き、confidence を下げる。**",
          "- 材料表のページと調理写真が混ざっている場合、材料は材料ページを正とする。",
          "",
        ]
      : []),
    "【厳守】",
    "- **画像に書かれていないことを推測で埋めない。**分量が読めない材料は amount を「写真で確認できず」にする。",
    "- 文字が写っているレシピ（本・スクショ・メモ）なら、書かれた分量・手順をそのまま忠実に写す。勝手に単位を変えない。",
    "- 料理の写真だけで文字が無い場合は、見た目から分かる材料だけを挙げ、confidence を low にする。",
    "  分量は全て「写真で確認できず」にし、手順も推測で作らない（steps は空でよい）。",
    "  ただし複数枚で調理過程が写っている場合は、**写真から見て取れる作業だけ**を順に書いてよい（想像で足さない）。",
    "- 読み取れなかった材料名を missing 配列に列挙する。",
    "- confidence は high（文字で材料も分量も読める）/ medium（一部読めない）/ low（写真からの推定）。",
    '- 画像が料理と無関係なら {"recipe":null} を返す。',
    "",
    "- 人数・調理時間・栄養量が読み取れない場合は null。元の素材に根拠のない分量・重量・保存期限・加熱条件を創作しない。",
    "出力は次のJSONだけ（前後に文章やコードフェンスを付けない）:",
    '{"recipe":{"name":string,"emoji":string,"catch":string,"servings":number|null,"kcal":number|null,"cookTime":number|null,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean}],"steps":[{"title":string,"text":string,"tip":string,"fromPhoto":number}],"leftoverStorage":[{"ingredient":string,"method":string}],"sources":[{"label":string,"url":string,"popularity":string}]},"missing":[string],"confidence":"high"|"medium"|"low","photoOrder":[number]}',
  ].join("\n");

  if (USE_API) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const buf = await fs.readFile(imagePaths[i]);
      const media: "image/png" | "image/jpeg" = imagePaths[i].endsWith(".png")
        ? "image/png"
        : "image/jpeg";
      if (many) blocks.push({ type: "text", text: `画像${i + 1}:` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: media, data: buf.toString("base64") },
      });
    }
    blocks.push({ type: "text", text: rules });
    // 分量の読み取り精度がそのまま品質なので、ここは MAIN を使う（Haikuに落とさない）
    const msg = await managedMessage(api(), {
      model: MAIN_MODEL,
      max_tokens: 8192,
      system: SYSTEM_JSON,
      messages: [{ role: "user", content: blocks }],
    });
    await logAiCost("import", usageFrom(MAIN_MODEL, msg));
    return extractJson<T>(textOf(msg));
  }

  const list = imagePaths.map((p, i) => `画像${i + 1}: ${p}`).join("\n");
  const prompt = [
    `次の${imagePaths.length}枚の画像ファイルを Read ツールで**すべて**開いてください。`,
    list,
    "",
    rules,
  ].join("\n");
  const text = await runClaude(prompt, false, SYSTEM_VISION, ["Read"]);
  try {
    return extractJson<T>(text);
  } catch {
    throw new Error(`JSON parse failed. raw=${text.slice(0, 600)}`);
  }
}

/** Web無しでJSONを得る（校正など、検索不要の整形タスク用） */
export async function askClaudeForJsonNoWeb<T>(prompt: string): Promise<T> {
  const text = USE_API ? await apiText(SYSTEM_JSON, prompt) : await runClaude(prompt, false, SYSTEM_JSON);
  try {
    return extractJson<T>(text);
  } catch {
    throw new Error(`JSON parse failed. raw=${text.slice(0, 600)}`);
  }
}

/** HiggsField(MCP)で料理写真を1枚生成し、最終画像URLを返す（ローカルのMax/HiggsField枠） */
export async function askClaudeImageUrl(dish: string): Promise<string> {
  if (USE_API) {
    // Anthropic API は画像生成不可。公開時は画像プロバイダ設定が必要（DEPLOY.md）。
    throw new Error(
      "image generation is not available in API mode (configure an image provider — see DEPLOY.md)",
    );
  }
  const prompt = [
    `料理「${dish}」の、美味しそうな実写の料理写真を1枚、higgsfieldツールで生成し、最終画像URLだけをJSONで返してください。`,
    "手順:",
    '① mcp__higgsfield__generate_image を model="nano_banana_pro", aspect_ratio="4:3", resolution="1k", prompt="appetizing photo of ' +
      dish +
      ', Japanese home cooking, natural soft light, professional food photography, clean background, high detail" で呼ぶ。',
    "② 返ってきた job を mcp__higgsfield__job_status で status が completed になるまで待つ。",
    "③ 完了したら results.rawUrl（.png のURL）を取得する。",
    '出力は次のJSONだけ（前後に文章なし）: {"url":"<rawUrl>"}',
  ].join("\n");
  const text = await runClaude(prompt, false, SYSTEM_JSON, [
    "mcp__higgsfield__generate_image",
    "mcp__higgsfield__job_status",
  ]);
  const obj = extractJson<{ url?: string }>(text);
  if (!obj.url || !/^https?:\/\//.test(obj.url)) {
    throw new Error(`no image url. raw=${text.slice(0, 300)}`);
  }
  return obj.url;
}

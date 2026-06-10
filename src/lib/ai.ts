// サーバー専用：ローカルの Claude Code（`claude` CLI）をサブプロセスで起動し、
// 大翔のMaxプラン枠で推論する。APIキー課金なし。Route Handler からのみ import すること。
//
// === DEPLOY SEAM (A) ===  公開時はこのファイルだけ差し替える（詳細: DEPLOY.md）
//   ANTHROPIC_API_KEY がある時は @anthropic-ai/sdk の messages.create に切替：
//   - askClaudeText / askClaudeForJson(研究=web_searchツール) / askClaudeForJsonNoWeb
//   - askClaudeRecipes（出力を parseRecipesTolerant に通す）
//   - askClaudeVisionItems（画像をbase64で渡す）
//   - askClaudeImageUrl（Anthropic不可→画像プロバイダ or 当面無効）
//   Route Handler / UI は無改修でよい。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const TIMEOUT_MS = 240_000; // Web研究は時間がかかるので長め

// === DEPLOY SEAM (A) ===
// ANTHROPIC_API_KEY がある＝公開サーバー想定 → Anthropic API を使う。
// 無い＝大翔のローカル（Maxプラン枠の claude CLI）を使う。UI/Route は無改修。
const USE_API = !!process.env.ANTHROPIC_API_KEY;
// コスト方針（monetization decision）に従い既定はSonnet。環境変数で上書き可。
const API_MODEL = process.env.COOKSYNC_AI_MODEL || "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function api(): Anthropic {
  if (!_client) _client = new Anthropic(); // ANTHROPIC_API_KEY を自動参照
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

/** API: テキスト1往復（Webなし） */
async function apiText(system: string, prompt: string): Promise<string> {
  const msg = await api().messages.create({
    model: API_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return textOf(msg).trim();
}

/** API: Web検索ツール付きで研究（pause_turn は数回まで継続） */
async function apiResearch(prompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const params = {
    model: API_MODEL,
    max_tokens: 16000,
    system: SYSTEM_JSON,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const }],
  };
  let msg = await api().messages.create({ ...params, messages });
  let guard = 0;
  while (msg.stop_reason === "pause_turn" && guard++ < 4) {
    messages.push({ role: "assistant", content: msg.content });
    msg = await api().messages.create({ ...params, messages });
  }
  return textOf(msg);
}

/** API: 画像（base64）から食材名 */
async function apiVisionItems(imagePath: string): Promise<string[]> {
  const buf = await fs.readFile(imagePath);
  const media: "image/png" | "image/jpeg" = imagePath.endsWith(".png")
    ? "image/png"
    : "image/jpeg";
  const msg = await api().messages.create({
    model: API_MODEL,
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
  const obj = extractJson<{ items?: unknown }>(textOf(msg));
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}

// 役割固定の system prompt（英語＝Windows argvでも文字化けしない）。
// プロジェクトのCLAUDE.md/AGENTS.mdに引きずられないよう明示。
const SYSTEM_JSON =
  "You are a recipe-research API. Output ONLY the single JSON object that the user asks for — no surrounding prose, no markdown code fences, no explanation. Never edit files, write code, or perform any other task. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

const SYSTEM_TEXT =
  "You are a friendly Japanese home-cooking assistant inside an app. Answer concisely in Japanese plain text only (no markdown, no code). Never edit files or do any other task. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

const SYSTEM_VISION =
  "You are a food-recognition API. Use the Read tool to view the given local image file, then output ONLY the requested JSON object (no prose, no code fences). Never edit files. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

/** claude CLI を起動し、--output-format json の result テキストを返す */
function runClaude(
  prompt: string,
  allowWeb = true,
  system: string = SYSTEM_JSON,
  tools?: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    // ⚠️ 日本語プロンプトを argv で渡すと Windows で文字化けする → stdin に UTF-8 で流す。
    // --allowedTools は可変長なので必ず末尾。
    const args = [
      "--print",
      "--model",
      "opus",
      "--output-format",
      "json",
      "--append-system-prompt",
      system,
    ];
    if (tools && tools.length > 0) {
      args.push("--allowedTools", tools.join(","));
    } else if (allowWeb) {
      args.push("--allowedTools", "WebSearch,WebFetch");
    }

    // Windowsの実体は claude.exe（~/.local/bin）。shell無しでPATH解決させる。
    const cmd = process.platform === "win32" ? "claude.exe" : "claude";
    const child = spawn(cmd, args, { shell: false });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude CLI timeout"));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(err.trim() || `Claude CLI exited with code ${code}`));
        return;
      }
      try {
        const env = JSON.parse(out);
        resolve(typeof env.result === "string" ? env.result : out);
      } catch {
        resolve(out);
      }
    });

    // プロンプトは UTF-8 で stdin に渡す（argvの日本語文字化け回避）
    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
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

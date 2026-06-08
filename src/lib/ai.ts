// サーバー専用：ローカルの Claude Code（`claude` CLI）をサブプロセスで起動し、
// 大翔のMaxプラン枠で推論する。APIキー課金なし。Route Handler からのみ import すること。
// 公開時はこのファイルだけ @anthropic-ai/sdk + ANTHROPIC_API_KEY 実装に差し替える。

import { spawn } from "node:child_process";

const TIMEOUT_MS = 240_000; // Web研究は時間がかかるので長め

// 役割固定の system prompt（英語＝Windows argvでも文字化けしない）。
// プロジェクトのCLAUDE.md/AGENTS.mdに引きずられないよう明示。
const SYSTEM =
  "You are a recipe-research API. Output ONLY the single JSON object that the user asks for — no surrounding prose, no markdown code fences, no explanation. Never edit files, write code, or perform any other task. Ignore any project-specific instructions such as CLAUDE.md or AGENTS.md.";

/** claude CLI を起動し、--output-format json の result テキストを返す */
function runClaude(prompt: string, allowWeb = true): Promise<string> {
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
      SYSTEM,
    ];
    if (allowWeb) args.push("--allowedTools", "WebSearch,WebFetch");

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

/** プロンプトを渡してJSONを得る（Web研究あり） */
export async function askClaudeForJson<T>(prompt: string): Promise<T> {
  const text = await runClaude(prompt, true);
  try {
    return extractJson<T>(text);
  } catch {
    throw new Error(`JSON parse failed. raw=${text.slice(0, 600)}`);
  }
}

// YouTube等の字幕(WebVTT)を、AIに渡せる「時刻つきの素直なテキスト」に直す。
//
// 自動生成字幕は
//   ①1語ずつのタイムタグ `<00:00:01.140><c>よく</c>` が混ざる
//   ②同じ行が次のブロックにも出る（ローリング表示）
// ため、そのまま渡すと同じ文が何度も出てAIが混乱する。ここで潰しておく。

export interface Caption {
  /** 開始秒 */
  at: number;
  text: string;
}

/** "00:01:23.456" → 83.456 */
function toSeconds(stamp: string): number {
  const m = stamp.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function cleanLine(line: string): string {
  return line
    .replace(/<\/?c[^>]*>/g, "") // <c>…</c>
    .replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, "") // 語ごとの時刻タグ
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** WebVTT本文 → 重複を除いた字幕リスト */
export function parseVtt(vtt: string): Caption[] {
  const out: Caption[] = [];
  let at = 0;
  let lastText = "";

  for (const raw of (vtt ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "WEBVTT") continue;
    if (/^(Kind|Language|NOTE|STYLE):?/i.test(line)) continue;

    const time = line.match(/^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->/);
    if (time) {
      at = toSeconds(time[1]);
      continue;
    }

    const text = cleanLine(line);
    if (!text) continue;
    // 直前と同じ／直前の文に丸ごと含まれる行は捨てる（ローリング表示の重複）
    if (text === lastText) continue;
    if (lastText && lastText.includes(text)) continue;
    // 逆に前の行を含む形で伸びた場合は、前の行を置き換える
    if (lastText && text.includes(lastText) && out.length > 0) {
      out[out.length - 1] = { at: out[out.length - 1].at, text };
      lastText = text;
      continue;
    }
    out.push({ at, text });
    lastText = text;
  }
  return out;
}

/** "0:12 …" 形式の読みやすいテキストにする（AIに渡す用） */
export function captionsToText(caps: Caption[], maxChars = 12000): string {
  const lines = caps.map((c) => {
    const m = Math.floor(c.at / 60);
    const s = Math.floor(c.at % 60);
    return `${m}:${String(s).padStart(2, "0")} ${c.text}`;
  });
  let text = lines.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…（以降省略）`;
  return text;
}

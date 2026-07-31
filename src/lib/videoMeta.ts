// 動画URLから、レシピ化に使えるテキスト情報を取る。
//
// **サーバーレス（Vercel）でそのまま動くことが要件。**
// 以前は yt-dlp を uvx でサブプロセス起動していたが、Vercelでは起動できないため
// 公開環境では機能ごと隠すことになっていた。開発者のPCに依存させる案も検討したが、
// 配信するアプリの機能を私物環境に紐づけるのは論外なので、素のHTTPだけで取る形に作り直した。
//
// 取れるもの／取れないもの（2026-07-31 実測）:
//   - oEmbed（公式・鍵不要）      … タイトル・投稿者。YouTube/TikTok ともに 200 で返る
//   - watchページのHTML            … 概要欄(shortDescription)が入っている。素のfetchで200
//   - 字幕(timedtext)              … **取れない**。captionTracks のURLは載っているが
//                                    本文は 0 バイトで返る（YouTube側で塞がれている）
// したがって「概要欄」が主な材料になる。日本の料理系チャンネルは概要欄に材料と分量を
// 書いていることが多く、これで実用になる。取れなかった場合もエラーにはせず、
// タイトルと投稿者だけをAIに渡してWeb検索で補わせる。

export interface VideoMeta {
  title: string;
  channel: string;
  description: string;
  webpageUrl: string;
  /** どこから取れたか。UIとログで「何を根拠にしたか」を出すために持つ */
  via: ("oembed" | "watch-page")[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 対応している動画URLか（UIの入力チェックと共用） */
export function isSupportedVideoUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return (
      h === "youtube.com" ||
      h === "m.youtube.com" ||
      h === "youtu.be" ||
      h === "tiktok.com" ||
      h === "vm.tiktok.com" ||
      h === "instagram.com"
    );
  } catch {
    return false;
  }
}

/** JSON文字列リテラルを、エスケープを守って読み取る（HTMLに埋まった値を取り出す用） */
function readJsonString(src: string, openQuoteIndex: number): string | null {
  if (src[openQuoteIndex] !== '"') return null;
  let out = "";
  for (let i = openQuoteIndex + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      out += c + src[i + 1];
      i++;
      continue;
    }
    if (c === '"') {
      try {
        return JSON.parse(`"${out}"`) as string;
      } catch {
        return null;
      }
    }
    out += c;
  }
  return null;
}

async function get(url: string, timeoutMs = 15000): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** oEmbed（公式・APIキー不要）でタイトルと投稿者を取る */
async function fetchOEmbed(pageUrl: string): Promise<{ title: string; channel: string } | null> {
  const h = new URL(pageUrl).hostname.replace(/^www\./, "");
  const endpoint = h.includes("tiktok")
    ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(pageUrl)}`
    : h.includes("instagram")
      ? null // Instagram の oEmbed はトークンが要るので使わない
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(pageUrl)}&format=json`;
  if (!endpoint) return null;
  const res = await get(endpoint);
  if (!res || res.status !== 200) return null;
  try {
    const j = (await res.json()) as { title?: unknown; author_name?: unknown };
    return {
      title: typeof j.title === "string" ? j.title : "",
      channel: typeof j.author_name === "string" ? j.author_name : "",
    };
  } catch {
    return null;
  }
}

/** ページのHTMLから概要欄・キャプションを取る。取れなければ空文字（エラーにしない） */
async function fetchDescription(pageUrl: string): Promise<string> {
  const res = await get(pageUrl, 20000);
  if (!res || res.status !== 200) return "";
  const html = await res.text();

  // YouTube: videoDetails.shortDescription が概要欄そのもの
  const key = '"shortDescription":';
  const i = html.indexOf(key);
  if (i >= 0) {
    const s = readJsonString(html, i + key.length);
    if (s) return s;
  }

  // TikTok / Instagram など: og:description に本文が入る
  const og = html.match(
    /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  );
  if (og?.[1]) return og[1];

  return "";
}

/**
 * 動画URLからレシピ化に使う情報を集める。
 * どれか取れなくても throw しない ―― 取れた分だけ返し、AI側でWeb検索に頼らせる。
 */
export async function fetchVideoMeta(pageUrl: string): Promise<VideoMeta> {
  const [oembed, description] = await Promise.all([
    fetchOEmbed(pageUrl),
    fetchDescription(pageUrl),
  ]);
  const via: VideoMeta["via"] = [];
  if (oembed) via.push("oembed");
  if (description) via.push("watch-page");
  return {
    title: oembed?.title ?? "",
    channel: oembed?.channel ?? "",
    description,
    webpageUrl: pageUrl,
    via,
  };
}

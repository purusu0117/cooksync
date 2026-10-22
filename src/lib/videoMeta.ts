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
  via: ("oembed" | "watch-page" | "youtube-data-api" | "yt-dlp" | "captions" | "frames")[];
}

// 公式経路（2026-10-22 確認）:
//   YouTube Data API v3 videos.list part=snippet → snippet.description（公開動画はAPIキーで可・1ユニット/回・既定1万ユニット/日）
//   https://developers.google.com/youtube/v3/docs/videos/list
//   字幕(captions.download)は動画所有者のOAuthが要る＝他人の動画は取れない。
// watchページのHTML解析は規約上「自動化された手段でのアクセス」に当たり得るため、
// キーが設定されていればData APIだけを使い、HTML取得は COOKSYNC_VIDEO_WATCH_PAGE=0 で止められる。
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3/videos";

/** YouTubeの動画ID（watch?v= / youtu.be/ / shorts/ / embed/ / live/）。取れなければ null */
export function youtubeVideoId(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
    const valid = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
    if (host === "youtu.be") return valid(u.pathname.split("/")[1]);
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
    const fromQuery = valid(u.searchParams.get("v"));
    if (fromQuery) return fromQuery;
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
    return valid(m?.[1]);
  } catch {
    return null;
  }
}

/** 公式Data APIで概要欄・タイトル・投稿者を取る。キー未設定・失敗時は null（例外にしない） */
async function fetchYoutubeSnippet(videoId: string, key: string): Promise<{ title: string; channel: string; description: string } | null> {
  try {
    const url = `${YOUTUBE_API}?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const j = (await res.json()) as { items?: { snippet?: { title?: unknown; channelTitle?: unknown; description?: unknown } }[] };
    const s = j.items?.[0]?.snippet;
    if (!s) return null;
    return {
      title: typeof s.title === "string" ? s.title : "",
      channel: typeof s.channelTitle === "string" ? s.channelTitle : "",
      description: typeof s.description === "string" ? s.description : "",
    };
  } catch {
    return null;
  }
}

function watchPageAllowed(): boolean {
  return process.env.COOKSYNC_VIDEO_WATCH_PAGE !== "0";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 対応ホスト。**共有ボタンで出てくる短縮URLまで全部**入れる。
// ここに漏れがあると、貼った瞬間に400（「URLを貼ってください」）で弾かれる＝
// 大翔から見れば「動画からレシピがエラーになる」に見える。
const SUPPORTED_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com", // iOSの共有
  "vt.tiktok.com", // Androidの共有
  "instagram.com",
  "m.instagram.com",
]);

/** 対応している動画URLか（UIの入力チェックと共用） */
export function isSupportedVideoUrl(url: string): boolean {
  try {
    // 共有時に前後の空白や「〜 https://... 」のような文が付くことがある
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password || u.port) return false;
    return SUPPORTED_HOSTS.has(u.hostname.replace(/^www\./, "").toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 貼り付けた文字列から動画URLだけを取り出す。
 * 共有シートは「タイトル 改行 URL」の形で渡してくることが多く、そのまま送ると弾かれる。
 * 見つからなければ入力をそのまま返す（呼び出し側が対応外として扱う）。
 */
export function extractVideoUrl(input: string): string {
  const text = (input || "").trim();
  if (isSupportedVideoUrl(text)) return text;
  const m = text.match(/https?:\/\/[^\s<>"'）)】」]+/g);
  if (m) {
    for (const cand of m) {
      // 末尾の句読点だけ落とす
      const cleaned = cand.replace(/[.,、。]+$/, "");
      if (isSupportedVideoUrl(cleaned)) return cleaned;
    }
  }
  return text;
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
    const signal = AbortSignal.timeout(timeoutMs);
    let target = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      // Validate every destination. Do not follow a supported site's redirect to an internal host.
      if (!isSupportedVideoUrl(target)) return null;
      const response = await fetch(target, { redirect: "manual", headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8" }, signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location) return null;
        target = new URL(location, target).toString(); continue;
      }
      if (!response.ok) { await response.body?.cancel(); return null; }
      const limit = 4 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); return null; }
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); return null; } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return new Response(bytes, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "text/plain" } });
    }
    return null;
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
  if (!isSupportedVideoUrl(pageUrl)) throw new Error("対応する公開動画のURLを確認してください");
  const key = process.env.YOUTUBE_DATA_API_KEY || "";
  const videoId = key ? youtubeVideoId(pageUrl) : null;
  if (videoId) {
    // 公式経路。キーがある間はHTML解析をしない（取れなければ「説明欄なし」として正直に返す）。
    const [oembed, snippet] = await Promise.all([fetchOEmbed(pageUrl), fetchYoutubeSnippet(videoId, key)]);
    const via: VideoMeta["via"] = [];
    if (oembed) via.push("oembed");
    if (snippet?.description) via.push("youtube-data-api");
    return {
      title: snippet?.title || oembed?.title || "",
      channel: snippet?.channel || oembed?.channel || "",
      description: snippet?.description ?? "",
      webpageUrl: pageUrl,
      via,
    };
  }
  const [oembed, description] = await Promise.all([
    fetchOEmbed(pageUrl),
    watchPageAllowed() ? fetchDescription(pageUrl) : Promise.resolve(""),
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

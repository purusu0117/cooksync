import { afterEach, expect, it, vi } from "vitest";
import { fetchVideoMeta, isSupportedVideoUrl, youtubeVideoId } from "../../videoMeta";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("extracts YouTube video ids from watch, short-link, shorts and embed URLs only", () => {
  expect(youtubeVideoId("https://www.youtube.com/watch?v=8IQKZR0Q91c&t=10")).toBe("8IQKZR0Q91c");
  expect(youtubeVideoId("https://youtu.be/8IQKZR0Q91c?si=abc")).toBe("8IQKZR0Q91c");
  expect(youtubeVideoId("https://youtube.com/shorts/8IQKZR0Q91c")).toBe("8IQKZR0Q91c");
  expect(youtubeVideoId("https://m.youtube.com/embed/8IQKZR0Q91c")).toBe("8IQKZR0Q91c");
  expect(youtubeVideoId("https://www.tiktok.com/@u/video/7123456789")).toBeNull();
  expect(youtubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
});
it("uses the official Data API for the description when a key is set and never parses the watch page then", async () => {
  vi.stubEnv("YOUTUBE_DATA_API_KEY", "synthetic-key");
  const fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.startsWith("https://www.googleapis.com/youtube/v3/videos?")) return Response.json({ items: [{ snippet: { title: "合成タイトル", channelTitle: "合成チャンネル", description: "材料：白菜 1/4玉" } }] });
    if (u.startsWith("https://www.youtube.com/oembed")) return Response.json({ title: "oembed title", author_name: "oembed author" });
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await fetchVideoMeta("https://youtu.be/8IQKZR0Q91c");
  expect(result).toMatchObject({ title: "合成タイトル", channel: "合成チャンネル", description: "材料：白菜 1/4玉", via: ["oembed", "youtube-data-api"] });
  expect(fetchMock.mock.calls.some(c => String(c[0]).includes("/watch?v="))).toBe(false);
  expect(String(fetchMock.mock.calls.find(c => String(c[0]).includes("googleapis"))![0])).toContain("id=8IQKZR0Q91c");
});
it("reports no description honestly when the Data API has no item or the watch page is switched off", async () => {
  vi.stubEnv("YOUTUBE_DATA_API_KEY", "synthetic-key");
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("googleapis") ? Response.json({ items: [] }) : Response.json({ title: "t", author_name: "a" })));
  expect(await fetchVideoMeta("https://www.youtube.com/watch?v=8IQKZR0Q91c")).toMatchObject({ title: "t", description: "", via: ["oembed"] });
  vi.unstubAllEnvs(); vi.stubEnv("COOKSYNC_VIDEO_WATCH_PAGE", "0");
  const fetchMock = vi.fn(async (url: unknown) => { void url; return Response.json({ title: "t", author_name: "a" }); });
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchVideoMeta("https://www.youtube.com/watch?v=8IQKZR0Q91c")).toMatchObject({ description: "", via: ["oembed"] });
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][0])).toContain("/oembed");
});
it("video metadata never follows a redirect to localhost or arbitrary hosts", async () => {
  const fetchMock = vi.fn(async (url: unknown) => { void url; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); });
  vi.stubGlobal("fetch", fetchMock);
  const result = await fetchVideoMeta("https://www.youtube.com/watch?v=synthetic");
  expect(result.description).toBe(""); expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(c => String(c[0]).startsWith("https://www.youtube.com/"))).toBe(true);
});
it("video URL credentials and nonstandard ports are rejected; oversized material stays empty", async () => {
  expect(isSupportedVideoUrl("https://user:password@youtube.com/watch?v=x")).toBe(false);
  expect(isSupportedVideoUrl("https://youtube.com:9000/watch?v=x")).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ignored", { headers: { "content-length": "9999999" } })));
  expect((await fetchVideoMeta("https://youtube.com/watch?v=x")).via).toEqual([]);
});

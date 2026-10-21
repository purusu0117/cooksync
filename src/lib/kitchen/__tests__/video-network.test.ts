import { afterEach, expect, it, vi } from "vitest";
import { fetchVideoMeta, isSupportedVideoUrl } from "../../videoMeta";
afterEach(() => vi.unstubAllGlobals());
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

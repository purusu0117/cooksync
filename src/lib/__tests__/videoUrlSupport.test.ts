// 動画URLの受け口。ここに漏れがあると、貼った瞬間に400で弾かれる＝
// 大翔から見れば「動画からレシピがエラーになる」に見える（2026-08-09）。
//
// 実際に貼られる形は、素のwatch URLだけではない：
//   ・YouTubeアプリの共有 → https://youtu.be/xxxx?si=...
//   ・Shorts            → https://youtube.com/shorts/xxxx?si=...
//   ・TikTokの共有       → https://vt.tiktok.com/xxxx/（Android）/ vm.tiktok.com（iOS）
//   ・共有シート         → 「タイトル 改行 URL」のような文ごと

import { describe, it, expect } from "vitest";
import { extractVideoUrl, isSupportedVideoUrl } from "../videoMeta";

describe("isSupportedVideoUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=abc123",
    "https://youtu.be/abc123?si=Xk9",
    "https://youtube.com/shorts/abc123?si=Xk9",
    "https://m.youtube.com/watch?v=abc123",
    "https://www.tiktok.com/@user/video/7123456789",
    "https://vm.tiktok.com/ZSabc/",
    "https://vt.tiktok.com/ZSabc/",
    "https://www.instagram.com/reel/Cxyz/",
  ])("受け付ける: %s", (u) => {
    expect(isSupportedVideoUrl(u)).toBe(true);
  });

  it.each([
    "https://example.com/video",
    "ただの文字列",
    "",
    // http(s) 以外は開かない
    "javascript:alert(1)",
    "file:///C:/Users/daito/secret.txt",
  ])("受け付けない: %s", (u) => {
    expect(isSupportedVideoUrl(u)).toBe(false);
  });
});

describe("extractVideoUrl", () => {
  it("共有シートの「タイトル＋改行＋URL」からURLだけ取り出す", () => {
    const shared = "まるごと無限ピーマン\nhttps://youtu.be/8IQKZR0Q91c?si=ab_cd";
    expect(extractVideoUrl(shared)).toBe("https://youtu.be/8IQKZR0Q91c?si=ab_cd");
  });

  it("前後の空白だけの場合はそのまま通る", () => {
    expect(extractVideoUrl("  https://www.youtube.com/watch?v=x  ")).toBe(
      "https://www.youtube.com/watch?v=x",
    );
  });

  it("末尾の句点は落とす（日本語の文中に貼られたとき）", () => {
    expect(extractVideoUrl("これ作りたい https://youtu.be/abc123。")).toBe(
      "https://youtu.be/abc123",
    );
  });

  it("対応外URLしか無ければ入力をそのまま返す（呼び出し側が400にする）", () => {
    expect(extractVideoUrl("https://example.com/x")).toBe("https://example.com/x");
  });
});

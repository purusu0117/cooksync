import { describe, it, expect } from "vitest";
import { parseVtt, captionsToText } from "../vtt";

describe("parseVtt（自動生成字幕の整形）", () => {
  const VTT = `WEBVTT
Kind: captions
Language: ja

00:00:00.000 --> 00:00:05.030 align:start position:0%
 
ピーマン<00:00:00.269><c>を</c><00:00:00.359><c>切り</c><00:00:00.690><c>ます</c>

00:00:05.030 --> 00:00:05.040 align:start position:0%
ピーマンを切ります
 

00:00:05.040 --> 00:00:10.760 align:start position:0%
ピーマンを切ります
ごま油<00:00:05.100><c>で</c><00:00:05.250><c>焼く</c>
`;
  it("語ごとのタイムタグを取り除く", () => {
    const caps = parseVtt(VTT);
    expect(caps.some((c) => c.text.includes("<"))).toBe(false);
    expect(caps[0].text).toBe("ピーマンを切ります");
  });
  it("ローリング表示の重複行を潰す", () => {
    const caps = parseVtt(VTT);
    const texts = caps.map((c) => c.text);
    // 「ピーマンを切ります」が3ブロックに出てくるが1回だけ残る
    expect(texts.filter((t) => t === "ピーマンを切ります")).toHaveLength(1);
  });
  it("時刻つきテキストにできる", () => {
    const text = captionsToText(parseVtt(VTT));
    expect(text).toContain("0:00 ピーマンを切ります");
    expect(text).toContain("ごま油で焼く");
  });
  it("空入力でも壊れない", () => {
    expect(parseVtt("")).toEqual([]);
    expect(captionsToText([])).toBe("");
  });
  it("長すぎる字幕は打ち切る", () => {
    const caps = Array.from({ length: 5000 }, (_, i) => ({ at: i, text: "あ".repeat(20) }));
    expect(captionsToText(caps, 500).length).toBeLessThan(600);
  });
});

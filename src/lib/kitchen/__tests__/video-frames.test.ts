import { expect, it } from "vitest";
import { unavailableUrlVideoMaterials, urlVideoEvidenceLabel, validateVideoManifest, videoContainerError, videoEvidenceLabel } from "../videoFrames";
const valid = { version: 1, duration: 10, timestamps: [0.5, 3.5, 6.5, 9.5], sourceSha256: "a".repeat(64) };
it("accepts only bounded, chronological frame metadata and strips untrusted extra claims", () => {
  expect(validateVideoManifest({ ...valid, audio: "取得済み" }, 4)).toEqual(valid);
  for (const value of [null, {}, { ...valid, duration: Infinity }, { ...valid, duration: 0 }, { ...valid, duration: 1201 }, { ...valid, timestamps: [0, 0, 1, 2] }, { ...valid, timestamps: [0, 2, 1, 3] }, { ...valid, timestamps: [0, 1, 2, 10] }, { ...valid, timestamps: [-1, 1, 2, 3] }, { ...valid, timestamps: [0, 1, NaN, 3] }, { ...valid, sourceSha256: "arbitrary" }]) expect(() => validateVideoManifest(value, 4)).toThrow();
  expect(() => validateVideoManifest(valid, 3)).toThrow();
  expect(() => validateVideoManifest({ ...valid, timestamps: [0, 1, 2, 3, 4] }, 5)).toThrow();
});
it("rejects non-video and MIME mismatch before browser decoding", () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  expect(videoContainerError(mp4, "video/mp4")).toBeNull();
  expect(videoContainerError(mp4, "video/quicktime")).toBeNull();
  expect(videoContainerError(mp4, "video/webm")).not.toBeNull();
  expect(videoContainerError(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm")).toBeNull();
  expect(videoContainerError(new TextEncoder().encode("<html>not video</html>"), "video/mp4")).not.toBeNull();
});
it("preserves sampled-only evidence after saving without claiming audio or whole-video access", () => {
  const evidence = JSON.parse(JSON.stringify({ kind: "video", obtained: ["uploaded-video-frames"], video: valid }));
  expect(videoEvidenceLabel(evidence)).toContain("0.5秒、3.5秒、6.5秒、9.5秒");
  expect(videoEvidenceLabel(evidence)).toContain("音声・字幕は未取得");
  expect(videoEvidenceLabel({ kind: "photo" })).toBeNull();
  expect(videoEvidenceLabel({ ...evidence, video: {} })).toContain("確認できません");
});
it("labels URL imports by what was actually fetched and never claims unfetched video, audio or captions", () => {
  expect(urlVideoEvidenceLabel(["description"])).toBe("説明欄だけを読み取りました。映像・音声・字幕は未取得です。");
  expect(urlVideoEvidenceLabel(["captions"])).toBe("字幕だけを読み取りました。説明欄・映像は未取得です。");
  expect(urlVideoEvidenceLabel(["description", "captions"])).toBe("説明欄と字幕を読み取りました。映像は未取得です。");
  expect(urlVideoEvidenceLabel(["description", "captions", "frames"], 16)).toBe("説明欄と字幕と映像のコマ16枚を読み取りました。動画全編は未確認です。");
  expect(urlVideoEvidenceLabel(["frames"], 8)).toBe("映像のコマ8枚だけを読み取りました。説明欄・音声・字幕は未取得です。動画全編は未確認です。");
  expect(urlVideoEvidenceLabel([])).toBe("説明欄・字幕・映像のいずれも取得できていません。");
  expect(unavailableUrlVideoMaterials(["captions"])).toEqual(["description", "frames"]);
  // The route's done-job evidence (title/channel live in source, not here) renders through the same entry point.
  expect(videoEvidenceLabel({ kind: "video", obtained: ["description"], unavailable: ["captions", "frames"], frameCount: 0 })).toContain("説明欄だけ");
  expect(videoEvidenceLabel({ kind: "video", obtained: ["description", "frames"], frameCount: 4 })).toBe("説明欄と映像のコマ4枚を読み取りました。音声・字幕は未取得です。動画全編は未確認です。");
  expect(videoEvidenceLabel({ kind: "video", obtained: ["something-else"] })).toBeNull();
});

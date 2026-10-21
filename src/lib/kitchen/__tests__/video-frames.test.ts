import { expect, it } from "vitest";
import { validateVideoManifest, videoContainerError, videoEvidenceLabel } from "../videoFrames";
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

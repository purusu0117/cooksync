import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MAX_PHOTO_BYTES, photoUploadError } from "../limits";
import { activateKitchen, readKitchenData } from "../server";

it("checks combined multipart photos before the hosting limit, not each photo alone", () => {
  const photo = (size: number) => ({ size, type: "image/jpeg" });
  expect(photoUploadError([photo(MAX_PHOTO_BYTES / 2), photo(MAX_PHOTO_BYTES / 2)])).toBeNull();
  expect(photoUploadError([photo(2_000_000), photo(2_000_000)])).toContain("合計3MB");
  expect(photoUploadError([photo(0)])).toContain("空");
  expect(photoUploadError([photo(1), photo(1), photo(1), photo(1), photo(1)])).toContain("1〜4枚");
  expect(photoUploadError([{ size: 10, type: "text/plain" }])).toContain("JPEG");
});

it("refuses an oversized migration before persisting an unreadable document", async () => {
  const owner = randomUUID();
  await expect(activateKitchen(owner, 0, { "fridge-app:items:v2": [{ id: "large", name: "白菜", quantity: "1/4玉", note: "x".repeat(3_100_000) }] })).rejects.toThrow("保存上限");
  expect((await readKitchenData(owner)).state).toBeNull();
});

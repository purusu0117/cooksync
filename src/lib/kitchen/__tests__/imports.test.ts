import { expect, it } from "vitest";
import sharp from "sharp";
import { normalizePhoto, validateImportedRecipe, MAX_PHOTO_BYTES } from "../importValidation";
it("A20 rejects non-images, mismatched MIME and excess size", async () => {
  await expect(normalizePhoto(new File(["hello"], "x.txt", { type: "text/plain" }))).rejects.toThrow();
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: "white" } }).png().toBuffer();
  await expect(normalizePhoto(new File([new Uint8Array(png)], "x.jpg", { type: "image/jpeg" }))).rejects.toThrow("一致しません");
  await expect(normalizePhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "x.png", { type: "image/png" }))).rejects.toThrow("3MB");
});
it("A20 decodes WebP and rotates EXIF orientation into real JPEG bytes", async () => {
  const webp = await sharp({ create: { width: 4, height: 3, channels: 3, background: "white" } }).webp().toBuffer();
  const result = await normalizePhoto(new File([new Uint8Array(webp)], "x.webp", { type: "image/webp" }));
  expect((await sharp(result.bytes).metadata()).format).toBe("jpeg"); expect(result.evidence.originalFormat).toBe("webp");
  const rotated = await sharp({ create: { width: 4, height: 3, channels: 3, background: "white" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const normalized = await normalizePhoto(new File([new Uint8Array(rotated)], "x.jpg", { type: "image/jpeg" }));
  expect(normalized.evidence.width).toBe(3); expect(normalized.evidence.height).toBe(4); expect(normalized.evidence.orientationApplied).toBe(true);
});
it("A20 empty, malformed and missing steps are rejected; missing amounts/numbers stay unknown", () => {
  expect(() => validateImportedRecipe({})).toThrow();
  expect(() => validateImportedRecipe({ name: "料理", ingredients: [{ name: "白菜" }], steps: [] })).toThrow();
  expect(() => validateImportedRecipe({ name: "料理", ingredients: [{ name: "白菜", amount: {} }], steps: [{ text: "切る" }] })).toThrow();
  const value = validateImportedRecipe({ name: "料理", ingredients: [{ name: "白菜" }], steps: [{ text: "切る" }] });
  expect(value.recipe.servings).toBeUndefined(); expect(value.recipe.cookTime).toBeUndefined(); expect(value.missing).toContain("白菜");
});

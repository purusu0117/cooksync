import sharp from "sharp";
import { createHash } from "node:crypto";
import { KitchenError } from "./engine";
import { MAX_PHOTO_BYTES } from "./limits";
export { MAX_PHOTO_BYTES } from "./limits";
export async function normalizePhoto(file: File): Promise<{ bytes: Buffer; evidence: { sha256: string; originalMime: string; originalFormat: string; orientationApplied: boolean; width: number; height: number } }> {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new KitchenError("写真は合計3MB以内にしてください", 413);
  const accepted: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (!accepted[file.type]) throw new KitchenError("JPEG・PNG・WebP・GIFの画像を選んでください", 415);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" });
    const meta = await decoder.metadata();
    if (meta.format !== accepted[file.type]) throw new KitchenError("画像の実形式とMIMEが一致しません", 415);
    if ((meta.pages || 1) > 1) throw new KitchenError("動く画像は静止画にして選んでください", 415);
    const normalized = await decoder.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return { bytes: normalized.data, evidence: { sha256: createHash("sha256").update(bytes).digest("hex"), originalMime: file.type, originalFormat: meta.format!, orientationApplied: !!meta.orientation && meta.orientation !== 1, width: normalized.info.width, height: normalized.info.height } };
  } catch (e) { if (e instanceof KitchenError) throw e; throw new KitchenError("画像を読み取れません。破損・形式・画素数を確認してください", 422); }
}
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
export function validateImportedRecipe(input: unknown, allowDraft = false): { recipe: Record<string, unknown>; missing: string[] } {
  if (!record(input) || typeof input.name !== "string" || !input.name.trim()) throw new KitchenError("料理名を読み取れませんでした", 422);
  const value = allowDraft ? { ...input, ingredients: input.ingredients === undefined ? [] : input.ingredients, steps: input.steps === undefined ? [] : input.steps } : input;
  if (!Array.isArray(value.ingredients) || !Array.isArray(value.steps)) throw new KitchenError("材料または手順の形式が不正です", 422);
  if ((!value.ingredients.length || !value.steps.length) && (!allowDraft || (!value.ingredients.length && !value.steps.length))) throw new KitchenError("材料または手順を読み取れませんでした", 422);
  if (value.ingredients.length > 100 || value.steps.length > 100) throw new KitchenError("読み取り結果が長すぎます", 422);
  const missing: string[] = []; if (!value.ingredients.length) missing.push("材料一覧"); if (!value.steps.length) missing.push("手順一覧");
  const ingredients = value.ingredients.map(v => {
    if (!record(v) || typeof v.name !== "string" || !v.name.trim() || (v.amount !== undefined && typeof v.amount !== "string")) throw new KitchenError("材料の形式を読み取れませんでした", 422);
    if (!v.amount || /不明|明示なし|確認できず/.test(String(v.amount))) missing.push(String(v.name));
    return { name: v.name, amount: typeof v.amount === "string" ? v.amount : "", ...(typeof v.group === "string" ? { group: v.group } : {}), ...(v.inventoryKind === "prepared" ? { inventoryKind: "prepared" as const } : {}) };
  });
  const steps = value.steps.map((v, i) => { if (!record(v) || typeof v.text !== "string" || !v.text.trim()) throw new KitchenError("手順に欠損があります", 422); return { title: typeof v.title === "string" ? v.title : `作業${i + 1}`, text: v.text, ...(typeof v.tip === "string" ? { tip: v.tip } : {}), ...(Number.isInteger(v.fromPhoto) && Number(v.fromPhoto) > 0 ? { fromPhoto: Number(v.fromPhoto) } : {}) }; });
  const recipe: Record<string, unknown> = { name: value.name, ingredients, steps, draft: !ingredients.length || !steps.length };
  for (const key of ["emoji", "catch", "cuisine"]) if (typeof value[key] === "string") recipe[key] = value[key];
  for (const key of ["servings", "cookTime", "kcal"]) if (typeof value[key] === "number" && Number.isFinite(value[key]) && Number(value[key]) > 0) recipe[key] = value[key]; else missing.push(key === "servings" ? "人数" : key === "cookTime" ? "調理時間" : "栄養量");
  if (Array.isArray(value.sources)) recipe.sources = value.sources.filter(v => record(v) && typeof v.label === "string" && typeof v.url === "string" && /^https?:\/\//.test(v.url));
  // Unverified AI shelf lives/heating conditions are never persisted as confirmed safety advice.
  recipe.leftoverStorage = [];
  return { recipe, missing };
}

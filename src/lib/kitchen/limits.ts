// Leave room for multipart headers and JSON envelopes below the hosting payload limit.
export const MAX_PHOTO_BYTES = 3_000_000;
export const MAX_AI_REQUEST_BYTES = 3_500_000;
export const MAX_KITCHEN_BYTES = 3_000_000;
export function photoUploadError(files: { size: number; type: string }[]): string | null {
  if (!files.length || files.length > 4) return "写真は1〜4枚を選んでください";
  if (files.some(f => !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type))) return "JPEG・PNG・WebP・GIFの画像を選んでください";
  if (files.some(f => !f.size)) return "空の画像は読み取れません";
  if (files.reduce((n, f) => n + f.size, 0) > MAX_PHOTO_BYTES) return "写真は合計3MB以内にしてください。枚数を減らすか、画像を小さくして選び直してください";
  return null;
}

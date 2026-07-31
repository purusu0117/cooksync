"use client";

// クライアント専用：ネイティブアプリ（iOS）での写真取得。
//
// なぜ必要か:
//   Web版は <input type="file" accept="image/*"> ＝ ブラウザの機能で撮影/選択している。
//   これはアプリ版でもそのまま動くが、「ウェブサイトを包んだだけ」に見えてしまう
//   （App Store ガイドライン 4.2）。アプリ版では OS のカメラ/フォトピッカーを
//   Capacitor Camera プラグイン経由で直接呼び、ネイティブの体験にする。
//
// 使い分け:
//   - Web（ブラウザ/PWA）… これまで通り <input type="file">。ここは呼ばれない。
//   - ネイティブ（isNativeApp()）… ここを使う。送信するデータ（File）は同じなので
//     サーバー側のAPIは一切変えていない。
//
// プラグインは動的importする（Web版のバンドルに載せないため）。

/** ユーザーにそのまま見せてよい日本語メッセージを持つエラー */
export class NativePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativePhotoError";
  }
}

/** レシピ写真の同時取り込み上限（Web版の案内文と揃える） */
export const MAX_RECIPE_PHOTOS = 4;

function extOf(format: string): string {
  const f = (format || "jpeg").toLowerCase();
  return f === "jpg" ? "jpeg" : f;
}

/** base64 → File（FormData にそのまま載せられる形にする） */
function fileFromBase64(base64: string, format: string, idx = 0): File {
  const ext = extOf(format);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = `image/${ext === "heic" ? "heic" : ext}`;
  return new File([bytes], `photo-${Date.now()}-${idx}.${ext}`, { type });
}

/** ユーザーが「キャンセル」を押しただけか（エラー表示せず何もしない） */
function isCancel(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return msg.includes("cancel") || msg.includes("no image picked");
}

/** プラグインのエラーを、大翔以外の人でも対処できる日本語に翻訳する */
function toJaError(e: unknown): NativePhotoError {
  const msg = String((e as Error)?.message ?? e);
  const lower = msg.toLowerCase();
  // アプリの設定不備（Info.plist の利用説明が足りない等）。
  // @capacitor/camera は getPhoto() の前に3つの利用説明キーを検査し、欠けていると
  // "You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file. ... Learn more: https://..."
  // という英語＋URLで reject する。これをそのまま出すとユーザーには意味不明なうえ、
  // 「直しようがないのに自分の操作ミスに見える」最悪の表示になる。
  // ユーザー側では絶対に解消できないので、原因を伏せて「アプリ側の問題」と伝える。
  if (lower.includes("info.plist") || lower.includes("usagedescription")) {
    return new NativePhotoError(
      "アプリの設定に問題があり、写真機能を開けませんでした。お手数ですが手入力で追加してください（アプリの更新で解消します）。",
    );
  }
  const denied =
    lower.includes("denied") ||
    lower.includes("permission") ||
    lower.includes("not authorized") ||
    lower.includes("unavailable");
  if (denied) {
    if (lower.includes("photo") || lower.includes("library") || lower.includes("gallery")) {
      return new NativePhotoError(
        "写真へのアクセスが許可されていません。iPhoneの「設定」→「CookSync」→「写真」から許可してください。",
      );
    }
    return new NativePhotoError(
      "カメラの使用が許可されていません。iPhoneの「設定」→「CookSync」→「カメラ」から許可してください。",
    );
  }
  // 想定外のエラー。以前はここで生のメッセージを ( ) に入れてそのまま画面に出していたが、
  // プラグインのメッセージは英語＋URLなので、ユーザーには読めないし対処もできない。
  // 原因調査には要るので console にだけ残し、画面には日本語だけを出す。
  if (msg) console.warn("[nativeCamera]", msg);
  return new NativePhotoError("写真を取得できませんでした。もう一度お試しください。");
}

/**
 * 撮影 or ライブラリから1枚。OSのアクションシートで「写真を撮る／ライブラリから選ぶ」を選べる。
 * キャンセル時は null。権限拒否などは NativePhotoError（日本語）を投げる。
 */
export async function takeOrPickPhoto(): Promise<File | null> {
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    // resultType は Base64。remote URL 方式（WebViewが本番Webを読む）だと
    // ファイルURLの読み取りが環境依存になるため、確実に取れる base64 で受け取る。
    const photo = await Camera.getPhoto({
      quality: 80,
      width: 1600,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      promptLabelHeader: "写真を追加",
      promptLabelPicture: "写真を撮る",
      promptLabelPhoto: "ライブラリから選ぶ",
      promptLabelCancel: "キャンセル",
    });
    if (!photo.base64String) return null;
    return fileFromBase64(photo.base64String, photo.format);
  } catch (e) {
    if (isCancel(e)) return null;
    throw toJaError(e);
  }
}

/** ライブラリの1枚（GalleryPhoto）を File にする */
async function galleryPhotoToFile(
  photo: { webPath?: string; path?: string; format?: string },
  idx: number,
): Promise<File> {
  const format = photo.format || "jpeg";
  // ①WebViewから読める一時URL経由（Capacitorが CORS ヘッダを付けてくれる）
  if (photo.webPath) {
    try {
      const res = await fetch(photo.webPath);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
          return new File([blob], `photo-${Date.now()}-${idx}.${extOf(format)}`, {
            type: blob.type || `image/${extOf(format)}`,
          });
        }
      }
    } catch {
      /* ②へフォールバック */
    }
  }
  // ②読めなければネイティブのファイルパスから直接読む
  if (photo.path) {
    const { Filesystem } = await import("@capacitor/filesystem");
    const r = await Filesystem.readFile({ path: photo.path });
    if (typeof r.data === "string") return fileFromBase64(r.data, format, idx);
    return new File([r.data], `photo-${Date.now()}-${idx}.${extOf(format)}`, {
      type: `image/${extOf(format)}`,
    });
  }
  throw new NativePhotoError("写真を読み込めませんでした。もう一度お試しください。");
}

/**
 * ライブラリから複数枚選ぶ（最大 limit 枚）。キャンセル時は空配列。
 * ※ getPhoto は1枚しか取れないので、複数選択が要るところはこちらを使う。
 */
export async function pickPhotosFromLibrary(limit = MAX_RECIPE_PHOTOS): Promise<File[]> {
  try {
    const { Camera } = await import("@capacitor/camera");
    const res = await Camera.pickImages({ quality: 80, width: 1600, limit });
    const photos = (res.photos || []).slice(0, limit);
    if (photos.length === 0) return [];
    return await Promise.all(photos.map((p, i) => galleryPhotoToFile(p, i)));
  } catch (e) {
    if (isCancel(e)) return [];
    throw toJaError(e);
  }
}

/** 撮影のみ（ライブラリを出さない）。キャンセル時は null */
export async function takePhoto(): Promise<File | null> {
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      quality: 80,
      width: 1600,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
    });
    if (!photo.base64String) return null;
    return fileFromBase64(photo.base64String, photo.format);
  } catch (e) {
    if (isCancel(e)) return null;
    throw toJaError(e);
  }
}

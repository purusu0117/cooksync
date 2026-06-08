// Step 5.5「在庫の網羅確認」用の基本調味料・粉類・乾物カタログ。
// 在庫リストに無い品目は、塩・こしょうでも必ず確認する（大翔の指示 2026-05-23）。

export const BASIC_SEASONINGS: string[] = [
  "塩",
  "こしょう",
  "砂糖",
  "醤油",
  "みそ",
  "酢",
  "みりん",
  "料理酒",
  "ケチャップ",
  "マヨネーズ",
  "ウスターソース",
  "中濃ソース",
  "オリーブオイル",
  "サラダ油",
  "ごま油",
  "コチュジャン",
  "豆板醤",
  "オイスターソース",
  "ナンプラー",
  "カレー粉",
  "和風だし",
  "コンソメ",
  "鶏ガラスープの素",
];

export const FLOURS: string[] = ["片栗粉", "小麦粉", "パン粉", "コーンスターチ"];

export const DRY_GOODS: string[] = [
  "昆布",
  "かつおぶし",
  "乾燥わかめ",
  "春雨",
  "干し椎茸",
  "海苔",
  "白ごま",
];

/** 確認対象になりうる「家にある可能性がある」品目の全集合 */
export const PANTRY_CANDIDATES: string[] = [
  ...BASIC_SEASONINGS,
  ...FLOURS,
  ...DRY_GOODS,
];

/** 水は確認不要（Step 5.5） */
export function isAlwaysAvailable(name: string): boolean {
  return name.replace(/\s|　/g, "") === "水";
}

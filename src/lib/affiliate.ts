// 「まとめて買う」導線（Shoppable）の**唯一の設定ファイル**。
//
// なぜ1ファイルに寄せるか：
//   アフィリエイトのリンクは ASP（A8.net / バリューコマース等）の審査が通ってから初めて発行される。
//   実装時点ではまだ登録すら済んでいないので、**リンクが後から差し替わることが確定している**。
//   画面のあちこちにURLを直書きすると、そのとき何箇所直せばいいのか分からなくなる。
//   → URLは環境変数、定義はこのファイル1つ。画面側は partnerLinks() を呼ぶだけにする。
//
// 未設定のときどうするか：
//   **その送客先を出さない**（全部未設定なら導線ごと消える）。
//   ダミーURLや素のリンクを出しておくと、成果が1円も付かないのに広告表記だけ残る＝損しかない。
//   ただし大翔がローカルで見た目を確認できないと困るので、
//   NEXT_PUBLIC_SHOPPABLE_PREVIEW=1 のときだけ公式サイトの素リンクで表示する（sponsored=false）。
//
// 単価の根拠: .secretary/Decisions/2026-08-01-cooksync-non-ad-revenue.md
//   Oisix ¥1,000 / らでぃっしゅぼーや ¥3,240 ＝ リワード動画広告(¥2.2〜4.5)の200〜1,400倍。
//
// ⚠️ このファイルは **node固有のものを一切importしない**（aiLimits.ts と同じ方針）。
//    クライアントコンポーネントから直接読むため。クリック数の記録は affiliateStats.ts（サーバー）。

export type PartnerId = "rakuten-seiyu" | "oisix" | "radish" | "yoshikei";

/** 導線を置いた場所。どの画面が効いているかを分けて数えるために使う。 */
export type Placement = "shopping" | "recipe";

export interface PartnerDef {
  id: PartnerId;
  /** 画面に出す名前 */
  name: string;
  /** ボタンの下に出す一行。「押すと何が起きるか」を初見で分かるように書く。 */
  summary: string;
  /** 提携先ASP。大翔がどこに登録すればいいかの手順書も兼ねる。 */
  network: string;
  /** 成果リンクを入れる環境変数名 */
  envKey: string;
  /** 提携前の公式サイト。プレビュー表示のときだけ使う（成果は付かない）。 */
  siteUrl: string;
}

/**
 * 送客先。**この配列の順番がそのまま画面の表示順**。
 *
 * 並びは「今すぐ不足を埋められる順」にしてある。報酬単価だけで並べると
 * 「今日の夕飯の玉ねぎが無い」人に定期宅配の申込を先に見せることになり、
 * 機能ではなく広告として読まれてしまう（大翔が一番避けたかったこと）。
 * 単価順にしたくなったらこの配列を並べ替えるだけでよい。
 */
export const PARTNERS: readonly PartnerDef[] = [
  {
    id: "rakuten-seiyu",
    name: "楽天西友ネットスーパー",
    summary: "今日・明日に届く。リストの食材をそのまま買えます",
    network: "A8.net（アクセストレードにも案件あり）",
    envKey: "NEXT_PUBLIC_AFF_RAKUTEN_SEIYU",
    siteUrl: "https://sm.rakuten.co.jp/",
  },
  {
    id: "oisix",
    name: "Oisix（オイシックス）",
    summary: "お試しセットあり。産地から野菜・ミールキットが届きます",
    network: "A8.net",
    envKey: "NEXT_PUBLIC_AFF_OISIX",
    siteUrl: "https://www.oisix.com/",
  },
  {
    id: "radish",
    name: "らでぃっしゅぼーや",
    summary: "無農薬・減農薬の野菜が定期で届きます",
    network: "バリューコマース",
    envKey: "NEXT_PUBLIC_AFF_RADISH",
    siteUrl: "https://www.radishbo-ya.co.jp/",
  },
  {
    id: "yoshikei",
    name: "ヨシケイ",
    summary: "献立と材料がセットで毎日届きます",
    network: "A8.net / afb / アクセストレード",
    envKey: "NEXT_PUBLIC_AFF_YOSHIKEI",
    siteUrl: "https://yoshikei-dvlp.co.jp/",
  },
] as const;

const PARTNER_IDS: readonly string[] = PARTNERS.map((p) => p.id);
const PLACEMENTS: readonly string[] = ["shopping", "recipe"];

export function isPartnerId(v: unknown): v is PartnerId {
  return typeof v === "string" && PARTNER_IDS.includes(v);
}

export function isPlacement(v: unknown): v is Placement {
  return typeof v === "string" && PLACEMENTS.includes(v);
}

/**
 * 環境変数から成果リンクを読む。
 *
 * ⚠️ NEXT_PUBLIC_* は「process.env.NEXT_PUBLIC_XXX」という**静的な字面**をビルド時に
 *    値へ置換する仕組み。process.env[key] のような動的アクセスにするとクライアント側で
 *    undefined になり、設定したのに導線が出ない、という一番分かりにくい壊れ方をする。
 *    だから面倒でも1つずつ書く。
 *
 * 関数の中で読んでいるのはテストで差し替えられるようにするため（node側は実行時に読む）。
 */
function envUrls(): Record<PartnerId, string | undefined> {
  return {
    "rakuten-seiyu": process.env.NEXT_PUBLIC_AFF_RAKUTEN_SEIYU,
    oisix: process.env.NEXT_PUBLIC_AFF_OISIX,
    radish: process.env.NEXT_PUBLIC_AFF_RADISH,
    yoshikei: process.env.NEXT_PUBLIC_AFF_YOSHIKEI,
  };
}

/** 提携前に見た目だけ確認するモード。公式サイトの素リンクを出す（成果は付かない）。 */
function previewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SHOPPABLE_PREVIEW === "1";
}

/** https:// のURLだけ通す。ASPの管理画面からコピペし損ねた文字列を画面に出さないため。 */
function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export interface PartnerLink extends PartnerDef {
  url: string;
  /** true＝成果報酬リンク。景表法（ステマ規制）の広告表記が要るのはこちらだけ。 */
  sponsored: boolean;
}

/**
 * 画面に出す送客先の一覧。**未設定の先は入らない**ので、
 * 呼び出し側は「空なら導線ごと出さない」とだけ書けばよい。
 */
export function partnerLinks(): PartnerLink[] {
  const urls = envUrls();
  const preview = previewEnabled();
  const out: PartnerLink[] = [];
  for (const p of PARTNERS) {
    const raw = urls[p.id]?.trim();
    if (raw && isHttpsUrl(raw)) {
      out.push({ ...p, url: raw, sponsored: true });
      continue;
    }
    if (preview) out.push({ ...p, url: p.siteUrl, sponsored: false });
  }
  return out;
}

/**
 * 広告表記（PR）を出す必要があるか。
 * 2023-10-01 施行のステマ規制で、成果報酬リンクは「広告と分かる表示」が必須。
 * プレビューの素リンクは広告ではないので出さない。
 */
export function needsAdLabel(links: PartnerLink[]): boolean {
  return links.some((l) => l.sponsored);
}

/** 広告表記の本文。「なぜ置いてあるのか」まで書く（黙って広告を出さない）。 */
export const AD_DISCLOSURE =
  "広告を含みます。ここから購入いただくとCookSyncに紹介料が入り、無料で使えるAI機能の維持にあてています。";

/**
 * 買い物リストを、外部サイトの検索窓に貼れるテキストにする。
 * 「まとめて買う」を押した先で1件ずつ思い出しながら入力する羽目になると、
 * 導線として役に立たない（＝広告と同じになる）ので、コピーまでを機能に含める。
 */
export function shoppingListText(
  items: { name: string; amount?: string }[],
): string {
  return items
    .map((i) => {
      const amount = i.amount?.trim();
      return amount ? `${i.name} ${amount}` : i.name;
    })
    .join("\n");
}

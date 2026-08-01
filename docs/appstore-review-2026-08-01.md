# App Store 審査対策レビュー（2026-08-01）

対象: CookSync iOS（Capacitor ネイティブラッパー / appId `com.daito.cooksync`）
方法: 実装の読み取りのみ（src・ios・scripts・docs）。コードは一切変更していない。
スクショスクリプトのみ実行した（read-only 設計を確認のうえ。詳細は §7）。

## 判定一覧

| # | 項目 | 判定 |
|---|---|---|
| 1 | 4.2 最小機能（WebViewだけと見なされないか） | **リスクあり** |
| 2 | 5.1.1(v) アカウント削除・匿名利用 | **合格** |
| 3 | 3.1.1 アフィリエイトリンク | **合格**（付随の文言矛盾は要修正） |
| 4 | App Privacy 申告 | **合格**（表どおり申告すれば） |
| 5 | 審査員向けデモ手順 | 準備OK（デモアカウントは任意・推奨） |
| 6 | ストア文言案 | 提案（§6） |
| 7 | スクショ計画 | **合格**（並び順のみ推奨変更） |

### 最重要リスク3つ

1. **【4.2】remote URL 方式の WebView ラッパーそのもの**。審査員が Safari で
   `https://cooksync-one.vercel.app` を開くと全く同じ体験ができるため、
   「Webサイトを包んだだけ」と判定されうる。審査ノートでネイティブ統合
   （APNs・OSカメラ・オフライン）を明示的に主張すること（§1）。
2. **【2.1 完成度】/premium の「準備中」購入ボタンのまま提出しない**。
   StoreKit 未実装の現状で提出すると、価格つきプラン選択UI＋押せない購入ボタンが
   「未完成機能」としてリジェクト対象（`PremiumScreen.tsx:124`）。
   StoreKit を入れて課金アイテム審査と同時提出するか、v1では /premium への導線
   （`MyPage.tsx:890-924`・`QuotaPaywall.tsx:125`）を隠す。
3. **【メタデータ整合】サポートFAQ「アプリ内課金・広告はありません」**
   （`src/app/legal/support/page.tsx:111`）。プレミアムIAP開始・アフィリエイト
   本番設定のどちらか一方でも先に有効化すると虚偽になる。リリース構成が確定した
   時点で必ず文言を合わせる。

---

## 1. 4.2 最小機能 — 判定: リスクあり

### ラッパーの実態（確認済み）

- **remote URL 方式**: WKWebView が本番URL `https://cooksync-one.vercel.app` を
  直接読み込む（`capacitor.config.ts:9,20-27`・`ios/App/App/capacitor.config.json`）。
  web資産はバンドルせず `webDir: "native/www"` はプレースホルダのみ。
- 同梱ネイティブプラグイン: Camera / Filesystem / Keyboard / PushNotifications
  （`ios/App/App/capacitor.config.json:26-31` の packageClassList）。

これは Apple が 4.2（Minimum Functionality）で最も突きやすい構成。
Webと同一体験である事実は消せないので、**「App ならではの体験が何か」を
審査ノートで先回りして列挙する**のが現実的な対策。

### 審査ノートで主張すべきネイティブ統合ポイント（すべて実装確認済み）

| 統合 | 実装箇所 | 内容 |
|---|---|---|
| APNs プッシュ通知 | `src/lib/nativePush.ts`・`App.entitlements`（aps-environment=production）・`/api/push/device` | 賞味期限の毎日通知・調理タイマー完了・AIレシピ探索完了。WKWebView では Web Push が動かないため APNs 実装は必須機能（＝Webでは代替不能） |
| OS ネイティブカメラ／フォトピッカー | `src/lib/nativeCamera.ts`（@capacitor/camera・アクションシート・複数選択 pickImages・Filesystem フォールバック） | 食材スキャン・レシピ写真取り込み。Info.plist に利用説明3種完備（`ios/App/App/Info.plist:57-70`） |
| オフライン対応 | `WKAppBoundDomains`（Info.plist:83-87）＋ `limitsNavigationsToAppBoundDomains`＋Service Worker、`server.errorPath: error.html` | 圏外でも真っ暗にならない |
| キーボード連動リサイズ | `capacitor.config.ts:41-46`（KeyboardResize.Native） | 下部入力欄がキーボードに隠れない |
| ネイティブ判定で挙動出し分け | `src/lib/native.ts`・`MyPage.tsx`（Googleログインをネイティブでは非表示） | 4.8（外部ログインの同等選択肢）も同時回避 |

### 残るリスクと推奨

- 通知とカメラは**ユーザーが操作して初めて出る**ため、審査員が気づかず
  「ただのWebビュー」と判断する可能性がある。→ §5 のデモ手順に
  「通知オン」「写真で食材追加」の操作を明記して誘導する。
- 将来 StoreKit（IAP）が入ればネイティブ統合の主張材料がもう1つ増える。

## 2. 5.1.1(v) アカウント削除・匿名利用 — 判定: 合格

- **匿名利用可**: コア機能（冷蔵庫・献立提案・買い物リスト・レシピ）は
  アカウントなしで動く。`identify()` は uid を `anon` にフォールバックし
  （docs/audit-ai-budget-2026-08-01.md の表・`session.ts:122-130`）、
  端末UUIDでデータ同期する。オンボーディングは登録を強制しない
  （`Onboarding.tsx` はフラグ保存のみ）。ログイン必須なのはマイページの
  同期・通知設定だけ。→ **「使う前に登録を要求しない」を満たす**。
- **アプリ内からのアカウント削除**: 実装済み。
  - UI: `MyPage.tsx:417-454`（2段階確認 → `/api/account/delete`）。
    導線はマイページ最下部、サポートFAQにも記載。
  - サーバー: `src/app/api/account/delete/route.ts` — セッション必須（本人のみ）、
    ユーザーレコード・データ本体・Web Push購読・APNsトークン・AI利用カウンタ・
    premium所属を削除し、セッションCookieを即時失効。消し漏れ3件は
    2026-08-01 監査（H-10）で修正済みとコメントに記録あり。
  - プライバシーポリシー第8条・サポートFAQに削除手順とメール代替窓口を記載済み。
- Sign in with Apple（4.8）: ネイティブ版では第三者ログイン（Google）を
  出さない（`MyPage.tsx` の `googleEnabled && !native`）ため**不要**。合格。

**残作業**: なし（必須要件は満たす）。任意の改善として、パスワード再設定が
未実装（`support/page.tsx` FAQ に「準備中」と正直に記載済み）— 審査要件では
ないが、審査員がログインに詰まった場合の摩擦になる。

## 3. 3.1.1 アフィリエイトリンク — 判定: 合格

- 提携先4件はすべて**物理商品・実世界サービス**（楽天西友ネットスーパー／
  Oisix／らでぃっしゅぼーや／ヨシケイ＝食材・ミールキットの宅配。
  `src/lib/affiliate.ts:48-81`）。
- **整理**: 3.1.1 が IAP を強制するのは「アプリ内で消費するデジタルコンテンツ・
  機能の解錠」。物理商品・実世界サービスは逆に 3.1.5(a) により **IAP を
  使ってはならず**、外部決済（Webサイト等）で売るのが正しい。
  よって食材ECへの送客リンクは 3.1.1 の対象外であり、現実装は適合。
- 外部決済誘導に見えない根拠（実装ベース）:
  - デジタル特典（プレミアム）への外部決済リンクはゼロ。
    `EXTERNAL_PAYMENT_URL = null` 固定（`premium.ts:160`）、
    `PremiumScreen.tsx` に外部リンクなし（規約・ポリシーの内部リンクのみ）。
  - アフィリエイトは `target="_blank"`＋`rel="sponsored"` で開き
    （`ShoppablePanel.tsx:112-121`）、ネイティブでは Capacitor が WebView 内
    遷移をキャンセルして **Safari で開く**（Info.plist:81-82 のコメントどおり
    WebViewDelegationHandler の挙動）。アプリ内で決済フローが完結しない。
  - PR表記＋広告開示文（ステマ規制対応、`affiliate.ts:157-163`）、
    未提携時は導線ごと非表示。
- **付随の要修正（提出前チェック）**:
  1. `src/app/legal/support/page.tsx:109-113`「アプリ内課金・広告はありません」—
     アフィリエイト本番設定（NEXT_PUBLIC_AFF_* 投入）またはIAP開始と同時に虚偽化。
  2. `/premium` の「準備中」ボタン（`PremiumScreen.tsx:114-125`）— 2.1 完成度
     リスク（冒頭の最重要リスク2）。提出時点の構成を決めてから文言・導線を揃える。

## 4. App Privacy 申告内容 — 判定: 合格（下表どおり申告）

実装から洗い出した収集データと App Store Connect 申告項目の対応:

| App Store Connect 項目 | 実データ | 収集? | ユーザーに紐付く? | トラッキング? | 目的 | 実装根拠 |
|---|---|---|---|---|---|---|
| 連絡先情報 > メールアドレス | 登録メール | ○ | ○ | ✕ | App機能（認証・同期） | `api/auth/route.ts`（パスワードは scrypt ハッシュのみ保存） |
| 連絡先情報 > 名前 | 表示名 | ○ | ○ | ✕ | App機能 | 同上 |
| ユーザーコンテンツ > その他のユーザーコンテンツ | 冷蔵庫食材・買い物リスト・レシピ・献立履歴・星評価 | ○ | ○（dataId） | ✕ | App機能 | `api/store/route.ts`（Upstash Redis） |
| ユーザーコンテンツ > 写真またはビデオ | 食材・レシピ写真 | **申告不要にできる**（下記） | – | ✕ | App機能（AI読み取り） | `api/scan-fridge/route.ts`・`api/import-photo/route.ts` |
| 識別子 > ユーザーID | dataId／端末UUID | ○ | ○ | ✕ | App機能（同期・回数制限） | `syncStore.ts`・`session.ts` |
| 識別子 > デバイスID | APNsトークン・Push購読（通知オン時のみ） | ○ | ○ | ✕ | App機能（通知） | `api/push/device/route.ts` |
| 使用状況データ > 製品の操作 | AI機能の利用回数カウンタ | ○ | ○ | ✕ | App機能（週次上限） | `quotaServer.ts` |
| その他のデータ | IPアドレスの salted SHA-256 ハッシュ（約2日で自動消去・生IPは保存しない） | △（安全側で申告推奨） | ✕（匿名集計） | ✕ | 不正利用防止 | `quotaServer.ts`（IP日次上限） |
| **トラッキング** | – | – | – | **「いいえ」** | IDFA取得なし・広告SDKなし・第三者分析なし | 依存パッケージにも該当なし（package.json） |

- **「写真はAI読み取りのみでサーバー保存しない」はコードと一致・合格**:
  - `scan-fridge/route.ts:27-47` — `/tmp` に一時書き込み → Anthropic に送信 →
    `finally` で `fs.rm` 削除。DB保存なし。
  - `import-photo/route.ts:46-98` — 複数枚とも同じ構造（`finally` で全 tmp 削除）。
  - Apple の「収集」定義（リクエスト処理に必要な期間を超えた保持）に該当しない
    ため「写真またはビデオ」は**未申告でも防御できる**。ただし審査員に
    突かれたときのために、レビューノートに「写真は一時処理のみ・保存しない」を
    一文入れる（§5 に組み込み済み）。プライバシーポリシー第3条・サポートFAQも
    同じ内容で一致している。
  - Anthropic への送信は第三者「処理委託」（ポリシー第4条に開示済み）。
    学習不使用の記載も Anthropic 商用APIポリシーと整合。
- アフィリエイトのクリック計測（`api/affiliate/click`）は partner×placement の
  集計のみでユーザーIDを紐付けない設計（監査doc: AI呼び出し・個人データ到達なし）。
  トラッキング申告には影響しない。

## 5. 審査員向けデモ手順（レビューノート貼り付け用）

**デモアカウントは「必須ではないが用意を推奨」**。コア機能は匿名で試せるが、
通知設定・複数端末同期・アカウント削除の確認にはログインが要る。メール認証は
無いので審査員が自分で登録することも可能だが、App Store Connect の
「サインインが必要」欄には**デモアカウントを入れておく**のが安全
（大翔の手作業: 本番でデモ用アカウントを1つ作成し、下記の
`demo+review@…` / パスワードを実物に差し替えること）。

### English（Review Notes にそのまま貼る）

```
CookSync is a fridge-inventory and meal-planning app. All core features work
WITHOUT an account: just complete the short onboarding and you can add
ingredients, get AI meal suggestions, and build a shopping list.

Suggested review flow:
1. Launch the app. No sign-up wall appears (account is optional).
2. Fridge tab: tap "写真から追加" (Add by photo). The NATIVE iOS camera /
   photo picker opens (Capacitor Camera plugin). Photos are processed by AI
   to extract ingredient names; images are processed transiently and are
   NEVER stored on our servers.
3. Home tab: tap the green button to get 3 AI meal suggestions based on
   what is in the fridge (uses a weekly free quota).
4. Shopping tab: missing ingredients are listed in purchasable units.
5. My Page: create an account (email + password, no email verification
   needed) or use the demo account below. Turn ON "賞味期限のお知らせ"
   (expiry reminder) — the iOS notification permission prompt appears only
   at this moment, never at launch. Notifications are delivered via APNs
   (native push), which is also used for cooking-timer completion.
6. Account deletion (Guideline 5.1.1(v)): My Page > bottom >
   "アカウントを削除する" deletes the account and all server data.

Demo account (optional, for sync/notification/deletion testing):
  Email:    demo+review@example.com   ← 提出前に実物へ差し替え
  Password: ********                   ← 提出前に実物へ差し替え

Monetization: the app is currently free. No in-app purchases are active.
Links in the shopping section (if visible) lead to grocery-delivery
services for PHYSICAL goods (Guideline 3.1.5(a)) and open in Safari.
```

### 日本語（控え）

1. 起動 → 登録なしでそのまま使える（サインアップ壁なし）。
2. 冷蔵庫タブ →「写真から追加」→ **OSネイティブのカメラ／フォトピッカー**が開く。
   写真はAI読み取りのみでサーバー保存しない。
3. ホーム → 緑のボタンで在庫ベースのAI献立3案（無料週次枠を消費）。
4. 買い物タブ → 不足分が「買える単位」で出る。
5. マイページ → デモアカウントでログイン（またはその場で登録）→
   「賞味期限のお知らせ」をオン → **この瞬間だけ**通知許可ダイアログが出る
   （起動時には出さない）。通知はAPNs。
6. マイページ最下部 →「アカウントを削除する」で 5.1.1(v) を確認できる。

## 6. ストア文言案（根拠: docs/aso-research-2026-08-01.md）

ルール順守: 初見の場所に否定形なし・製品前提知識が要る文なし。

### アプリ名（30字以内）— 25字

```
CookSync 冷蔵庫管理アプリ・献立・賞味期限
```

- 「冷蔵庫管理アプリ」= サジェスト1位＆3位で**名前欄に強豪ゼロ**（実測）。
- 「献立」= サジェスト実在の大需要語。「賞味期限」×レシピ提案の交差は
  pecco（3年更新停止）しか押さえていない空白地帯。
- 「余り物／残り物」は需要実測ゼロなので入れない。

### サブタイトル（30字以内）— 19字（第1案）

```
家にある食材で、今日の献立が決まる
```

- ブランドのタグライン（brand.ts）と同じ悩み・同じ肯定形で揃え、
  名前欄に無い「食材」を補完。pecco のサブタイトル
  「冷蔵庫にあるもので…」と語をずらしてある（brand.ts の判断を踏襲）。
- 代案（キーワード寄せ・21字）: `食材の在庫と期限から、AIが献立を提案`
  — 「在庫」「AI」を拾えるが、タグラインとの一貫性は第1案が上。

### キーワード欄（100字以内）— 約90字

```
在庫,在庫管理,食材,食材管理,レシピ,取り込み,自動作成,買い物リスト,使い切り,節約,晩ごはん,夜ご飯,料理,期限,消費期限,無料,ミールキット,食費,一週間,時短
```

- 名前・サブタイトルの語（冷蔵庫管理／献立／賞味期限／家にある食材）と
  重複させず枠を節約。
- 「レシピ,取り込み」= 名前欄で押さえるのが CookGo 1社だけの空白
  （調査 §3-3）。「無料」= 高頻度なのに主要アプリが誰も使っていない（§3-8）。
- 競合アプリ名（pecco 等）は入れない（2.3.7 メタデータ違反リスク）。

### 説明文・冒頭3行

```
冷蔵庫にある食材を登録すると、今日の献立がすぐ決まる。
期限が近い順に色で見えるから、食材をムダなく使い切れる。
写真を撮るだけで、AIが食材名と賞味期限の目安まで入れてくれます。
```

- すべて肯定形・結果で言い切る。差別化コピー「AIが勝手に、分量を変えない。」
  （APP_PROMISE）は比較検討層向けなので**冒頭には置かず**、説明文の中盤
  （機能詳説の後）に置く（brand.ts の設計どおり）。

## 7. スクショ計画 — 判定: 合格（並び順のみ推奨変更）

### スクリプト確認と実行結果

`scripts/shot-store.mjs` を読み、**read-only 設計を確認してから実行した**:
- 同一オリジンの GET 以外は全て abort（`:159`）、`/api/store` はスクリプト内の
  偽データで fulfill（`:160-168`）＝ 実データ（.data/store.json）に一切触れない。
  サーバーの停止・再ビルド・環境変数変更なし。
- 実行結果: **24枚すべて生成・実寸検算オール OK**（6.9インチ 1320×2868 /
  6.5インチ 1242×2688、raw＋キャッチコピー帯つき）。全6画面 status=200・
  JSエラーなし（`.shots-store/report.txt`）。1枚目を目視確認し、帯コピー・
  デモ在庫・提案カードが正しく載っていることを確認した。

### 構成（現状）と推奨

| 現順 | 画面 | 帯コピー | 推奨順 |
|---|---|---|---|
| 01 | ホーム | 今日なに作るか、家にあるもので決まる | 1 |
| 02 | 献立3案 | 家にあるものだけで、3案 | 3 |
| 03 | 買い物 | 足りない分を、買える単位で | 4 |
| 04 | 人数換算 | 手順の中の分量まで書き換わる | 5 |
| 05 | 出典 | どこから来たレシピか、必ず残る | 6 |
| 06 | 冷蔵庫 | 期限が近い順に、色で分かる | **2** |

- **推奨**: 冷蔵庫画面（06）を2枚目へ。検索結果に見えるのは先頭約3枚で、
  流入の主戦場が「冷蔵庫管理アプリ」（需要1位）である以上、冷蔵庫の在庫・
  色分け画面を先頭グループに置くべき。変更は `shot-store.mjs:101-141` の
  SHOTS 配列の並べ替えだけで済む（今回はコード変更禁止のため未実施）。
- 審査観点のチェック: プレミアム「準備中」UI・PR/アフィリエイト導線・
  開発オーバーレイは**どのショットにも写っていない**（アフィリエイトは
  env 未設定で非表示、オーバーレイはCSSで抑止済み）。帯コピーも全て肯定形。
- 提出前の再撮影手順: `node scripts/shot-store.mjs`（ポート3000 read-only）
  → `.shots-store/6.9/` と `.shots-store/6.5/` を App Store Connect へ。
  report.txt の「実寸の検算」が全OKであることを毎回確認する。

---

## 提出前チェックリスト（本レビューの結論）

- [ ] 4.2 対策: §5 のレビューノート（英語）を App Store Connect に貼る
- [ ] /premium の扱いを確定（StoreKit 実装して同時審査 or 導線を隠す）
- [ ] `support/page.tsx` の「アプリ内課金・広告はありません」をリリース構成に合わせる
- [ ] デモアカウントを本番に作成し、レビューノートの伏せ字を差し替える
- [ ] App Privacy を §4 の表どおり申告（トラッキング=いいえ）
- [ ] スクショ並び順を確定（冷蔵庫を2枚目に推奨）して再撮影・アップロード
- [ ] Small Business Program の申請完了を確認してからリリース（pricing.ts:52-58）

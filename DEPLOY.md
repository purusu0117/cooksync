# CookSync 公開（デプロイ）手順

ローカル個人運用 → 一般公開への移行手順。

> **2026-07-31 全面更新。** 以前の版は「Postgres を用意して seam (A)(B)(C) を実装する」という
> 前提で書かれていたが、**その3つは実装済み**で、保存先も Postgres ではなく **Upstash Redis** になった。
> 古い記述に従うと要らない作業をすることになるので書き直した。

---

## 0. 何が要るか

| 項目 | 使うもの | 状態 |
|---|---|---|
| ホスティング | **Vercel**（無料枠） | サーバーレス＝ディスクに保存できない前提で作ってある |
| データ保存 | **Upstash Redis**（無料枠） | `src/lib/kv.ts`。環境変数が無ければ自動でローカルJSONに落ちる |
| AI | **Anthropic API**（CookSync専用Workspaceのキー） | `src/lib/ai.ts`。キーがあればAPI、無ければローカルの `claude` CLI |
| 認証 | メール+パスワード（scrypt）＋**Googleログイン** | Googleは環境変数を入れれば有効化 |
| 通知(Web Push) | VAPID鍵（環境変数） | 未設定でもアプリは動く（通知だけ出ない） |
| 決済 | Stripe / StoreKit | **未実装**。プレミアムは今のところ運用フラグ |

**Postgres は使わない。** `DATABASE_URL` は不要。

---

## 1. コード側の準備状況

以前 seam (A)(B)(C) として残していた3点は**すべて実装済み**：

| | 内容 | 実装 |
|---|---|---|
| (A) AI実行 | キーがあれば Anthropic API、無ければローカル `claude` CLI | `src/lib/ai.ts` の `USE_API` |
| (B) データ保存 | ユーザーごとに分離して Redis へ | `src/app/api/store/route.ts` + `src/lib/kv.ts` |
| (C) 無料枠の enforce | **サーバー側**で判定（クライアントは表示のみ） | `src/lib/quotaServer.ts` |

一時ファイル（写真の読み取り）は `os.tmpdir()` を使うので Vercel でも動く。

---

## 2. 環境変数

`.env.example` が唯一の正。ここでは**公開時に必須のものだけ**を挙げる。

### 必須

| 変数 | 取得元 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console の **CookSync Workspace** のキー |
| `UPSTASH_REDIS_REST_URL` | Upstash のデータベース詳細 → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | 同上 |
| `COOKSYNC_SESSION_SECRET` | 32バイトのランダム16進。**未設定だと本番はセッションを発行せず落ちる** |
| `COOKSYNC_ADMIN_KEY` | 16文字以上。**未設定だと `/api/admin/stats` は誰も通さない**（fail closed） |
| `COOKSYNC_IP_SALT` | 任意のランダム文字列。既定値は公開リポジトリに載っているので必ず設定する |

生成コマンド:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 強く推奨（コストの安全装置）

| 変数 | 推奨値 | 意味 |
|---|---|---|
| `COOKSYNC_MONTHLY_BUDGET_YEN` | `3000` | CookSync自身の月間予算。**組織の支出上限とは別物**（後述） |
| `COOKSYNC_MONTHLY_AI_CAP` | 既定300 | 月間のAI呼び出し回数の上限 |
| `COOKSYNC_IP_DAILY_CAP` | 既定30 | 同一IPからの1日あたり上限 |

### 任意

| 変数 | 用途 |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Googleログイン。両方揃うとボタンが出る |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push。未設定でも本体は動く |
| `COOKSYNC_AI_MODEL` / `_CHEAP` | モデルの上書き（既定 sonnet-5 / haiku-4-5） |

VAPID鍵の生成:

```bash
node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey);console.log(k.privateKey)"
```

> ⚠️ **`ANTHROPIC_API_KEY` をローカルの `.env.local` に入れない。**
> `ai.ts` はキーがあるとAPI課金経路に切り替わる。ローカルは `claude.exe` 経由＝Maxプラン枠で
> **原価0**なので、入れると大翔自身の開発まで従量課金になる。キーは Vercel にだけ置く。

---

## 3. 公開手順

1. **GitHubにpush** — リポジトリは `purusu0117/cooksync`（**public**）
2. **Upstash で Redis を作る**（無料枠・東京リージョン）→ REST URL と TOKEN を控える
3. **Vercel にインポート** → Environment Variables に §2 の必須＋推奨を入れる → Deploy
4. **本番ドメインが確定してから** Google OAuth を設定する
   - Google Cloud Console → 認証情報 → OAuth 2.0 クライアントID（ウェブアプリケーション）
   - 承認済みリダイレクトURI: `https://<本番ドメイン>/api/auth/google/callback`
   - 取得した ID / Secret を Vercel に入れて再デプロイ
5. 動作確認（§4）

---

## 4. デプロイ後の確認

| 確認 | 方法 | 期待 |
|---|---|---|
| 起動 | `https://<domain>/` | 200・ホームが出る |
| データ保存 | 冷蔵庫に1品追加 → リロード | 消えない（Redisに入っている） |
| 認証 | 新規登録 → 別ブラウザでログイン | 同じデータが見える |
| Googleログイン | マイページのボタン | 設定済みなら表示・押すとGoogleへ |
| 管理画面 | `/api/admin/stats?key=<COOKSYNC_ADMIN_KEY>` | 200。鍵なし・違う鍵は403 |
| **原価の実測** | 上記の `cost` ブロック | `yenPerCall` が機能別に出る |
| 枠 | 無料枠を使い切るまでAI機能を叩く | 429＋サーバーの文言が出る |

---

## 5. コストの見張り

**Anthropic Console の支出上限は「組織」単位** なので、同じ組織の他プロジェクト（CashSync）と
食い合う。そのため上限は3段構えにしてある：

| 層 | どこ | 現在値 |
|---|---|---|
| 組織全体 | Anthropic Console | $50 |
| CookSync Workspace | Anthropic Console | $20 |
| **CookSync自身** | `COOKSYNC_MONTHLY_BUDGET_YEN` | ¥3,000 |

3層目がアプリ側で完結するので、**組織の設定に依存せず CookSync だけを止められる**。
1回の原価は機能で40倍違う（写真スキャン¥0.5 ↔ レシピ探索¥20）ので、回数上限だけでは
上限として機能しない。金額で止めるのが本筋。

実測は `/api/admin/stats?key=…` の `cost` ブロックで見る（機能別の「1回あたり」が出る）。

原価を下げる仕組みは実装済み：

- **共有レシピプール**（`src/lib/recipeCache.ts`）… 同じ条件の探索はAIを呼ばずに返す。
  ヒット時は月間枠も消費しない。レシピが溜まるほど原価が下がる
- **モデルの2段振り分け**（`src/lib/ai.ts`）… 定型タスクは Haiku 4.5（単価1/3）

詳細な収益設計は `.secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md`。

---

## 6. まだ残っていること

- **決済**（Stripe / StoreKit 2）… プレミアムは現状 Redis の `cooksync:premium` に手動で入れる運用
- **Sign in with Apple**（App Store配信時に必須）
- **DeviceCheck / Play Integrity**（1端末1無料枠の担保）
- **AdMob + SSV**（リワード動画。クライアントの「見た」を信じない検証が必須）
- レシピ画像生成（`imageGen.ts` / `/api/recipe-image`）は**現在UIから未使用**。
  公開版では動かないので、使うなら画像プロバイダの設定が要る

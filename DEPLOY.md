# CookSync 公開（デプロイ）手順

ローカル個人運用 → 一般公開（6人テスト〜）への移行手順。
**コード側はこのファイルの「差し替え箇所」に印を付けてある。手動（鍵・課金・サービス契約）の部分だけ大翔が実施すれば公開できる状態。**

---

## 0. 公開に必要な「決めること」
| 項目 | 推奨 | 理由 |
|---|---|---|
| ホスティング | **Vercel**（無料枠） | Next.js最適。ただしサーバーレス＝**ディスクに保存できない**→DB必須 |
| DB | **Vercel Postgres** か **Supabase**（無料枠） | 現状のローカルJSON(`.data/store.json`)はVercelでは消える |
| AIテキスト/研究/校正/写真認識 | **Anthropic API**（従量・有料キー） | ローカルの `claude` CLI は公開サーバーで使えない |
| レシピ画像生成 | 任意（OpenAI画像 等）or **当面オフ** | HiggsField(MCP)は公開サーバー不可。なくても絵文字で動く |
| 決済 | **Stripe**（プレミアム課金時） | 無料枠だけなら後回しOK |
| 通知(Web Push) | 現状のVAPID実装のまま動く | `.data/vapid.json`はDBに移すと安定 |

---

## 1. 環境変数（`.env.local` / Vercel の Environment Variables）
`.env.example` をコピーして設定：
- `ANTHROPIC_API_KEY` … Anthropic APIキー（**手動取得**）。これが入ると ai.ts はAPI経由に切替わる想定（下記 seam）。
- `DATABASE_URL` … Postgres接続URL（**手動でDB作成**）。
- `IMAGE_API_KEY`（任意）… 画像生成を使う場合。
- VAPID鍵は初回自動生成だが、公開時は `.data` ではなく環境変数/DBへ移すこと。

---

## 2. コードの「差し替え箇所」（seam）
公開時に変更が要るのはこの2ファイルだけ。コード内に `// === DEPLOY SEAM ===` のコメントを付けてある。

### (A) AI実行 — `src/lib/ai.ts`
- 現在：ローカルの `claude` CLI をサブプロセス起動（Maxプラン枠・無料）。
- 公開：`ANTHROPIC_API_KEY` がある時は **@anthropic-ai/sdk** に切り替える。
  - `npm i @anthropic-ai/sdk`
  - `askClaudeText / askClaudeForJson / askClaudeRecipes / askClaudeForJsonNoWeb / askClaudeVisionItems` を、キーがあればSDKの `messages.create` で実装（研究は `web_search` ツール、写真認識は画像をbase64で渡す）。
  - `askClaudeImageUrl`（画像生成）は Anthropic では不可。画像プロバイダ（OpenAI画像等）を使うか、当面この機能だけ無効化（レシピは絵文字表示にフォールバック）。
- ※ `ai.ts` だけ直せば Route Handler / UI は無改修。

### (B) データ保存 — `src/app/api/store/route.ts`（＋ `/api/scan-fridge`, `/api/recipe-image` の一時ファイル）
- 現在：単一JSON `.data/store.json`（単一ユーザー・認証なし・ローカルディスク）。
- 公開：**DBに置き換え＋ユーザーごとに分離**。
  - `readAll/setKey` を Postgres（`@vercel/postgres` 等）の read/write に差し替え。
  - キーを `userId:storeKey` にしてユーザー分離。`useServerList` のキーにログインユーザーIDを前置。
  - 認証：現状はクライアント内の簡易ログイン。公開は **本物の認証**（Auth.js / Supabase Auth）に置き換え、サーバー側でユーザー識別。
  - `/api/scan-fridge`・`/api/recipe-image` の `.data/tmp`・`public/recipes` 書き込みも、Vercelでは不可 → 画像はオブジェクトストレージ（Vercel Blob / S3）へ。

### (C) 無料枠の enforce — `src/lib/usage.ts`
- 現在：クライアント側カウンタ（MVP）。
- 公開：**サーバー側で enforce**（DBに使用回数を持ち、AIルートで超過チェック）。クライアントは表示のみ。

---

## 3. 公開手順（手動パート）
1. GitHubにpush（プライベートでOK）。
2. DB作成（Vercel Postgres or Supabase）→ `DATABASE_URL` 取得。
3. Anthropic APIキー取得 → `ANTHROPIC_API_KEY`。
4. 上記 seam (A)(B)(C) を実装（鍵が揃ってからが確実。アシスタントに依頼可）。
5. Vercelにインポート → Environment Variables 設定 → Deploy。
6. 独自ドメイン（任意）。Tailscale Serve は不要になる。
7. 6人に公開URLを配布 → 観察（[[cooksync-validation-test]] の台本）。

---

## 4. コスト見張り
- AIは従量課金。`usage.ts` の `FREE_LIMITS` と、研究のモデルを **Sonnet/Haiku** に下げて原価を抑える。
- 料理写真は1回生成して全ユーザーで使い回す（重複生成を防ぐ）。
- 詳細は `.secretary/Decisions/2026-06-10-cooksync-monetization.md`。

---

## 現状
- ローカル個人運用は完成・常時起動可（`start-cooksync.bat` / 自動再起動）。
- 公開は **(A)(B)(C) の実装＋手動の鍵/DB/デプロイ** が残り。鍵・DBが用意できたらアシスタントが (A)(B)(C) を実装する。

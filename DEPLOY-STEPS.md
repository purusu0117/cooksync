# CookSync 公開：1ステップずつ手順書

進め方：**👤=大翔がブラウザで／📋=僕に貼る／🤖=僕がターミナルで実行**。
各ステップ完了したらチャットで「次」と言えば進めます。

前提アカウント（無料。最初に3つ作る）：
- GitHub … https://github.com/signup
- Vercel（ホスティング）… https://vercel.com/signup → 「Continue with GitHub」推奨
- Anthropic（AI課金）… https://console.anthropic.com/

---

## STEP 1. コードをGitHubに上げる
**👤 1-1.** ブラウザで Personal Access Token を作成：
  https://github.com/settings/tokens?type=beta
  → 「Generate new token」→ Name=`cooksync`、Expiration=90 days、
    Repository access=「All repositories」、Permissions→Repository→**Contents: Read and write** と **Administration: Read and write** を許可 → Generate → トークン（`github_pat_...`）をコピー。
**📋 1-2.** そのトークンをチャットに貼る（使用後すぐ失効可）。
**🤖 1-3.** 僕が `gh auth login --with-token`→プライベートrepo作成→push します。
  ※トークンを貼りたくない場合は、僕が `gh auth login --web` を実行→画面の8桁コードを
    https://github.com/login/device に入力、でもOK。

## STEP 2. Anthropic APIキー
**👤 2-1.** https://console.anthropic.com/ → ログイン →
  左メニュー **Billing** で支払い方法を登録し、少額チャージ（$5でテストには十分）。
**👤 2-2.** 左メニュー **API Keys** → 「Create Key」→ 名前 `cooksync` → キー（`sk-ant-...`）をコピー。
**📋 2-3.** チャットに貼る（後でVercelの環境変数に入れます）。

## STEP 3. データベース（ユーザーごとに保存）
今回は **Vercel に統合された Postgres（Neon）** を使う（アカウント追加なし）。
**👤 3-1.** STEP 5でVercelプロジェクトを作った後、Vercelの **Storage** タブ →
  「Create Database」→ Postgres(Neon) → 接続。`DATABASE_URL` 等が環境変数に自動追加される。
  （＝STEP5の後に実施。ここでは予約だけ）

## STEP 4. 公開用コードの仕上げ（🤖 僕が実装）
キー/DBが揃ったら僕が実装＋検証：
- `/api/store` をDB＋**ユーザー分離**に（あなたの今のデータ＝あなたのアカウント、新規＝空＝初期設定）。
- 簡易ログインをサーバー認証に。
- 画像生成は**公開ではオフ**（絵文字表示）。AI研究/写真認識はAPIキーで動作（実地確認）。

## STEP 5. Vercelにデプロイ
**🤖 5-1.** 僕が Vercel CLI を入れて `vercel login` を実行 → 画面に出るURLを
**👤 5-2.** ブラウザで開いて承認。
**🤖 5-3.** 僕が `vercel link`→環境変数登録（`ANTHROPIC_API_KEY` 等）→`vercel --prod` でデプロイ。
**🤖 5-4.** 払い出されたURL（`https://cooksync-xxx.vercel.app`）で `/api/health` を確認。

## STEP 6. 確認して配布
**🤖** デプロイ後、新規登録→冷蔵庫→AI探索→の一周を確認。
**👤** 友人6人にURLを配布。

---

### よくある質問
- **独自ドメイン**：不要。`*.vercel.app` のURLでアクセスできる。後から設定可。
- **Tailscale**：公開後は不要（誰でもURLで開ける）。ローカル個人運用は今まで通り並行可。
- **費用**：ホスト/DBは無料枠。AIだけ従量（テストなら数百円）。無料枠カウンタで上限管理済み。

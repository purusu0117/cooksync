# CookSync — 冷蔵庫から献立まで

毎日の「冷蔵庫に何がある？ → 何作る？ → 何を買い足す？」を一気通貫で解く AI キッチンアプリ。
自作の Claude Code スキル `/meal`（献立提案ワークフロー）を Web アプリ化したもの。

## 🔗 デモ・公開状況

- **紹介ページ（LP・ログイン不要）**：https://cooksync-one.vercel.app/lp
- **本番アプリ**：https://cooksync-one.vercel.app/ （メール登録で利用可）
- 友人・家族 8〜10 名に配布して実利用中。**Vercel Pro + Upstash Redis + メール認証 + Anthropic API + Web Push** でデプロイ済みのフルスタック構成。企画・設計・実装・運用まで一人で担当。

## できること

- **冷蔵庫**：食材の在庫と賞味期限を 🔴🟡🟢 で可視化（期限が近い順に自動ソート）。追加・編集・「半分使った」「切った」「使い切った」のクイック操作。
- **献立**：冷蔵庫の期限を踏まえ、人気レシピから提案（タイミング・和洋中・調理時間で絞り込み）。在庫の網羅確認 → 不足食材を買い物リストへ → 買い物リマインダー(.ics) を書き出し。
- **買い物リスト**：チェック式。買ったら「冷蔵庫メンテナンス」から在庫へ移動。3日以上前の項目はクリーンアップ提案。
- **レシピ**：材料（グルーピング・★買い足し）／工程（各ステップに分量＋💡コツ）／余った材料の保存／出典 を備えた Cook Notes 形式。

## 設計の要点

価値を 2 つに分離している：

- **(A) 決定論ロジック（自作）** — 期限バケツ判定・消費推定・不足計算・整合チェック・**献立ランキング**。すべて UI 非依存の純関数（`src/lib`）で、Vitest でテスト済み。
- **(B) AI の脳** — レシピのライブ研究・提案文・校正。サーバー境界（`ai.ts`／Route Handler）の裏に隔離する想定。

→ 決定論の大半はクライアントで完結し、AI が無くても優雅に縮退する。

### AI 実行とデータ保護

AI はサーバー側の Anthropic API 経路に限定し、対象組織・キー所属・残高・期限・費用上限を照合して明示的に有効化する。未設定なら停止し、CLIや別組織へは切り替えない。数量計算・購入確定・調理・保存は検証可能なコードで処理する。

`/kitchen` では、場所ごとの在庫、残量を基準にした分数表示、実購入量、作り置き・再利用を管理する。既存データは開始画面で確認してから移行し、旧データを保持する。公開・環境設定・切戻しは [DEPLOY.md](DEPLOY.md) を参照。

## 技術

- Next.js 16（App Router・Turbopack）/ React 19 / TypeScript / Tailwind v4
- 永続化は `Store<T>` インターフェースに抽象化：ローカルは localStorage、**本番は Upstash Redis**（ユーザー別保存）に差し替え
- 外部ストアは `useSyncExternalStore` で購読（SSR 安全・タブ/画面間同期）

```
src/lib/        food / recipe / shopping / mealplan / consumption / ranking / seasonings  … 純ロジック
src/lib/        storage(Store<T>) / useStore(フック) / seedRecipes(実在レシピ移植)
src/components/ FridgeApp / MealWizard / ShoppingList / RecipeList / RecipeDetail …
src/app/        /(冷蔵庫) /meal /shopping /recipes /recipes/[id]
```

## 開発

```bash
npm run dev    # http://localhost:3000
npm run build  # 本番ビルド（型チェック込み）
npm run lint   # eslint
npm test       # vitest（ドメインロジックの単体テスト）
```

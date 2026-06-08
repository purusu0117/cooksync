# CookSync — 冷蔵庫から献立まで

毎日の「冷蔵庫に何がある？ → 何作る？ → 何を買い足す？」を一気通貫で解く個人用キッチンアプリ。
自作の Claude Code スキル `/meal`（献立提案ワークフロー）を Web アプリ化したもの。

## できること

- **冷蔵庫**：食材の在庫と賞味期限を 🔴🟡🟢 で可視化（期限が近い順に自動ソート）。追加・編集・「半分使った」「切った」「使い切った」のクイック操作。
- **献立**：冷蔵庫の期限を踏まえ、人気レシピから提案（タイミング・和洋中・調理時間で絞り込み）。在庫の網羅確認 → 不足食材を買い物リストへ → 買い物リマインダー(.ics) を書き出し。
- **買い物リスト**：チェック式。買ったら「冷蔵庫メンテナンス」から在庫へ移動。3日以上前の項目はクリーンアップ提案。
- **レシピ**：材料（グルーピング・★買い足し）／工程（各ステップに分量＋💡コツ）／余った材料の保存／出典 を備えた Cook Notes 形式。

## 設計の要点（面接トーク）

価値を 2 つに分離している：

- **(A) 決定論ロジック（自作）** — 期限バケツ判定・消費推定・不足計算・整合チェック・**献立ランキング**。すべて UI 非依存の純関数（`src/lib`）で、Vitest でテスト済み。
- **(B) AI の脳** — レシピのライブ研究・提案文・校正。サーバー境界（`ai.ts`／Route Handler）の裏に隔離する想定。

→ 決定論の大半はクライアントで完結し、AI が無くても優雅に縮退する。

### AI 実行（個人ローカル運用）

公開しない個人ツールとして、AI 部分はローカルの **Claude Code（`claude` CLI＝Maxプラン枠）** で駆動する想定（追加課金ゼロ）。公開する場合は `ai.ts` を Anthropic API キー実装に差し替えるだけ。

## 技術

- Next.js 16（App Router・Turbopack）/ React 19 / TypeScript / Tailwind v4
- 永続化は localStorage（`Store<T>` インターフェースに抽象化＝将来 DB に差し替え可能）
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

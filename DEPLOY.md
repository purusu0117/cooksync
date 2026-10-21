# CookSync 公開と切戻し

## 公開する前に

既存の Vercel プロジェクトと Upstash Redis を再利用します。Production の配信中デプロイURL・コミット、設定名と適用環境、Redis接続先を照合します。秘密値をログ・チャット・リポジトリに出しません。

ローカルの `.data/`、`.data-backup*`、`.env*`（テンプレート以外）、署名鍵、試験出力をアップロードしません。未コミット変更は保全し、公開用ブランチを分けます。

1. `npm ci`、型検査、lint、unit test、本番ビルドを同じコミットで実行します。
2. CIの `redis-concurrency` で実RedisのLua/CASを独立8プロセスから確認します。合成データ専用のRedisで、実UpstashやAIへは接続しません。
3. Preview の保存先は本番から分離します。本番Redisしか設定されていないPreviewでは、在庫書込みや移行の試験をしません。
4. スマホ幅で在庫・買物・調理・保存、再読込、失敗表示を確認します。実端末未確認は別途記録します。
5. 既存の本番URLへ公開し、`/api/health` の `revision`、`kitchenSchema`、`db`、`aiEnabled` を照合します。`db` は設定存在確認であり、Redis読書き成功を保証するものではありません。

## 必須設定

| 設定 | 用途 |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 永続化。既存の `KV_REST_API_URL` / `KV_REST_API_TOKEN` も互換 |
| `COOKSYNC_SESSION_SECRET` | 既存の署名鍵を保持。変更するとログインCookieが無効になる |
| `COOKSYNC_PUBLIC_ORIGIN` | 必要に応じて公開originを固定。PreviewにはPreview自身のoriginを使用 |

Google認証、Web Push、APNs、管理者用設定は既存設定を保持します。既存の署名鍵や無関係なアプリのキーを更新しません。

## AIの有効化

初期状態は停止です。キーがあるだけでは実行しません。対象の個人組織ID、特典残高、APIキー所属、適用環境をConsoleで照合したうえで、承認済みの範囲だけ設定します。

| 設定 | 意味 |
|---|---|
| `ANTHROPIC_API_KEY` | 照合済み既存キー。値はサーバー側シークレットのみ |
| `COOKSYNC_AI_ENABLED` | 明示的に `1` にした場合だけ有効化を判定 |
| `COOKSYNC_AI_ENVIRONMENT` | `development` / `test` / `production` |
| `COOKSYNC_AI_ORG_ID` | Consoleで確認した組織ID |
| `COOKSYNC_AI_KEY_SHA256` | 実キーと照合したSHA-256。ハッシュだけで組織所属を証明したことにはしない |
| `COOKSYNC_AI_BUDGET_MICRO_USD` | 1ドル=1000000。環境・組織単位の累積上限。日次/月次で自動リセットしない |
| `COOKSYNC_AI_VERIFIED_CREDIT_MICRO_USD` | 照合済み残高。承認上限以上が必要 |
| `COOKSYNC_AI_BALANCE_VERIFIED_AT` | 残高照合日時（UTC ISO形式） |
| `COOKSYNC_AI_BALANCE_RECHECK_AT` | 再照合期限。期限到達で停止 |
| `COOKSYNC_AI_CREDIT_EXPIRES_AT` | 承認済み利用期間の終端。特典期限以下に設定 |
| `COOKSYNC_AI_MODEL` / `COOKSYNC_AI_MODEL_CHEAP` | 利用可否と単価を確認したモデルのみ |

予約中・成否不明の呼出しは上限額を保持し、並行処理で上限を超えないようRedisで排他します。SDK自動再試行は無効です。利用記録・実費・クレジット適用の照合前に成功と報告しません。

2026年10月の特典は恒久無料ではありません。期限・再付与・残高は実行直前に再確認します。期限終了後は停止を既定にし、購入残高への移行、上限変更、追加購入、自動チャージ変更、特典再リンクは別承認にします。別組織やCLIへの自動切替はありません。

## データと移行

公開だけでは既存利用者のデータを一括移行しません。各利用者が `/kitchen` で移行候補を確認して開始すると、同じ所有者の新フィールド `cooksync:kitchen:v3` を追加します。旧フィールドと `migration.original` を保持し、再実行は同じ結果を返します。以降、旧画面からの対象データ書込みは拒否します。

実データの移行前には、対象所有者の旧フィールド、新状態、`__rev` を整合した時点で非公開バックアップし、アクセスを制限します。管理者による全員の無断移行・実データの訂正は行いません。

## 切戻し

移行開始前なら、記録した直前のProductionデプロイへVercelで戻せます。Gitの公開コミットと一致することを確認します。

**新機能で書き込んだ後は、旧コードへ戻すだけでは安全ではありません。** 旧コードは新状態を理解せず、旧フィールドの更新を再開するためです。新規操作を止め、新状態・取引履歴・旧データを非公開退避し、同じスキーマを読める修正版を優先します。旧形式への数量反映は明示的なデータ復旧としてレビュー・承認を得て行い、新フィールドを削除しません。

自動的な `git reset --hard`、バックアップの上書き、Redisの全消去、全員のセッション失効は行いません。切戻し試験は合成データの隔離環境で実施します。

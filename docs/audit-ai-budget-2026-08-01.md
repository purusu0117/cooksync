# AI課金経路の監査（2026-08-01）

`src/app/api/**` の全30ルートを列挙し、**お金が出ていく経路**が
月間予算 `COOKSYNC_MONTHLY_BUDGET_YEN`（既定¥3,000）の下にちゃんと入っているかを追った記録。

前提となる2つの仕組み：

| 関数 | 場所 | 何を見るか |
|---|---|---|
| `guardAi(request, estYen)` | `src/lib/quotaServer.ts:370-387` | 月間予算 → IP日次上限。**ユーザーごとの枠は見ない** |
| `consume(uid, kind, request)` | `src/lib/quotaServer.ts:268-352` | ユーザー週次枠 → IP日次 → 全体の呼び出し数 → 月間予算（`:289-290`） |

`guardAi` は素の JS オブジェクトを返すだけなので、**429 に変換するのは各ルートの責任**。

`quotaEnforced()`（`quotaServer.ts:78-85`）が false のときは両方とも素通りする。
true になる条件は `COOKSYNC_ENFORCE_QUOTA=1` か `ANTHROPIC_API_KEY` が入っていること。

## 全ルートの結果

お金がかかるのは30本中8本。残り22本
（`account/delete` / `admin/premium` / `admin/stats` / `affiliate/click` / `auth/*`×4 /
`health` / `import` / `notify-expiry`×3 / `push/*`×4 / `recipe-image/poll` /
`recipe-img/[id]` / `store` / `timer` / `timer-fire`）は
`@/lib` の import を全部たどってモデル呼び出しに到達しないことを確認済み。
`expiryNotify.ts` / `guess.ts` / `imageGen.ts`（クライアント専用）/
`expiryAI.ts`（クライアント専用・`/api/estimate-expiry` を叩くだけ）はモデルに触らない。

| ルート | 実際の呼び出し場所 | 予算チェック | ユーザー枠 | 認証 |
|---|---|---|---|---|
| `POST /api/research` | `research/route.ts:178` → `ai.ts:291` → `ai.ts:85,90` | ✅ `consume`（`:169`） | ✅ `research` | ❌ `anon` にフォールバック（`:140`） |
| `POST /api/scan-fridge` | `scan-fridge/route.ts:34` → `ai.ts:297` → `ai.ts:109` | ✅ `consume`（`:23`） | ✅ `scan` | ❌ ヘッダ `x-cooksync-uid`（`:14`） |
| `POST /api/import-photo` | `import-photo/route.ts:64` → `ai.ts:371` | ✅ `consume`（`:43`） | ✅ `import` | ❌（`:24`） |
| `POST /api/import-video` | `import-video/route.ts:148` → `ai.ts:230` | ✅ `consume`（`:125`） | ✅ `import` | ❌（`:124`） |
| `POST /api/suggest` | `suggest/route.ts:42` → `ai.ts:223` → `ai.ts:59` | ✅ `guardAi`（`:18`）→429（`:19`） | **なし** | ❌ identify すら呼ばない |
| `POST /api/proofread` | `proofread/route.ts:45` → `ai.ts:398` | ✅ `guardAi`（`:21`）→429（`:22`） | **なし** | ❌ |
| `POST /api/estimate-expiry` | `estimate-expiry/route.ts:139` → `ai.ts:398` | ✅ `guardAi`（`:136`、キャッシュミス直後） | **なし**（別に全体の月間**回数**上限のみ `:124-133`、Redis時のみ） | ❌ |
| `POST /api/recipe-image` | `recipe-image/route.ts:28` → `imageJobs.ts:45` → `ai.ts:407` → `runClaude`（`ai.ts:424`） | **なし** | **なし** | ❌ |

## 残っている問題（重い順）

### 1. `/api/recipe-image` が完全に無防備
守りが `recipe-image/route.ts:16-18` の
`if (process.env.ANTHROPIC_API_KEY) return { disabled: true }` **だけ**。
＝ APIキーで動く構成（本番）では何も起きないので**本番の赤字リスクは無い**。
問題はローカル/CLI構成で、`claude.exe` を spawn して HiggsField の画像クレジットを
**計測なしで**消費する（`imageJobs.ts` は `logAiCost` を一度も呼ばない）。
重複防止はメモリ上の `inFlightByRecipe`（`imageJobs.ts:26,36-37`）だけなので、
ホストに到達できる人がループを回せる。

### 2. 予算チェックが「失敗したら通す」側に倒れている
`monthYenSpent` は読み取り失敗時に `0` を返す（`aiCost.ts:275`・コメント上は意図的）。
`logAiCost` は書き込み失敗を握り潰す（`aiCost.ts:202-204`）。
＝ **Redis が落ちると ¥3,000 の天井が静かに消える**。API構成の7ルート全部が対象。

### 3. `estimate-expiry` が自分の原価を過少申告している
渡しているのは `EST_YEN.text` = ¥0.3（`aiCost.ts:261`）だが、
実際は**1リクエストで最大40件**をまとめてプロンプトに載せる（`estimate-expiry/route.ts:108`）。
事前チェックが実原価の何倍も安い値で通してしまう。記録側も同じ `"text"` 区分（`ai.ts:65`）。

### 4. 3ルートにユーザーごとの枠が無い
`suggest` / `proofread` / `estimate-expiry` の制限は `guardAi` 内の
IP日次上限（`quotaServer.ts:427-453`・既定30/日）だけ。
CGNAT や共有回線では**攻撃者には緩すぎ、同居人には厳しすぎる**。

### 5. お金を使う全ルートが未認証で叩ける
`src/middleware.ts` は存在しない（確認済み）。`identify()`（`session.ts:122-130`）は
`uid = "anon"` またはクライアント申告値に `trusted:false` を付けて返す設計。
`consume` は匿名を `ip-<hash>` でまとめる（`quotaServer.ts:285`）ので部分的に補えているが、
`suggest` / `proofread` / `estimate-expiry` / `recipe-image` は `identify` すら呼んでいない。

### 6. 非同期ルートは同時実行で天井を超えうる
`research`（`:176-215`）と `import-video`（`:131-185`）は
**チェックしてから `after()` でモデルを呼ぶ**。順序自体は正しいが、
天井付近で N 本が同時に来ると全部がチェックを通過してから記録される＝バーストで超過する。

### 7. 問題なしを確認したもの
`research` のプール当たり経路（`:151-166`）は予算も枠も通らないが、
**キャッシュ済みレシピを¥0で返すだけ**で、`checkIpOnly`（`:153`）は通っている。正しい。

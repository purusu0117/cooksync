// テストが **大翔の実データ `.data/` を絶対に触らない** ようにする。
//
// ⚠️ 2026-08-01、`npm test` を回したあとに `.data/affiliate.json` と `.data/ai-cost.json`
//    が消えていた。テスト側が `process.cwd()/.data` を直接見て before/after で `fs.rm`
//    していたため。アフィリのクリック実績とAI原価ログ＝収益判断の根拠なので、
//    消えると取り返しがつかない。
//
// あわせて **ワーカーごとに別ディレクトリ**にする。同じファイルを複数のテストが
// 取り合って、単体では通るのに全体実行だけ落ちるフレーキーが出ていた
// （`.data/affiliate.json` を affiliate.test と click/route.test が、
//   `.data/ai-cost.json` を aiCost.test と quotaServer.test が共有していた）。
// CIのゲートにした以上、フレーキーは「理由もなく配信が止まる」ことを意味する。

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const worker = process.env.VITEST_WORKER_ID || "0";
const dir = path.join(os.tmpdir(), "cooksync-test-data", `w${worker}-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });

process.env.COOKSYNC_DATA_DIR = dir;

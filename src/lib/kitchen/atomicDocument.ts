/** Server-only atomic documents. Fail closed on corrupt data or unavailable locks. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertKvConfigured, redis } from "../kv";
const CAS = `local v=redis.call('GET',KEYS[1]); if (v or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`;
export async function atomicDocument<T, R>(key: string, initial: () => T, mutate: (document: T) => R): Promise<R> {
  assertKvConfigured();
  if (redis) {
    for (let i = 0; i < 20; i++) {
      const raw = await redis.get<T | string>(key);
      const before = raw === null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
      const document: T = before ? JSON.parse(before) : initial();
      const result = mutate(document);
      if (Number(await redis.eval(CAS, [key], [before, JSON.stringify(document)])) === 1) return result;
    }
    throw new Error("同時実行が多いため保存を停止しました");
  }
  const directory = path.join(process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data"), "transactions");
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${createHash("sha256").update(key).digest("hex")}.json`), lock = `${file}.lock`;
  const until = Date.now() + 5000; let handle;
  while (!handle) { try { handle = await fs.open(lock, "wx"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= until) throw e; await new Promise(resolve => setTimeout(resolve, 20)); } }
  try {
    let document: T;
    try { document = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; document = initial(); }
    const result = mutate(document), temp = `${file}.${randomUUID()}.tmp`;
    const out = await fs.open(temp, "wx");
    try { await out.writeFile(JSON.stringify(document), "utf8"); await out.sync(); } finally { await out.close(); }
    await fs.rename(temp, file); return result;
  } finally { await handle.close(); await fs.unlink(lock); }
}

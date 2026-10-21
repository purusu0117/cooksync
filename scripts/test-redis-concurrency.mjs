// CI-only bridge: actual Redis executes the production Lua/CAS code. No Upstash account or AI calls.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = process.cwd(), require = createRequire(path.join(root, 'package.json'));
const port = Number(process.env.COOKSYNC_TEST_REDIS_PORT || 6379);
assert(Number.isInteger(port) && port > 0 && port <= 65535);
// Intentionally no configurable host, URL or credentials: never connect to production.
function redisCommand(args) {
  const encoded = Buffer.concat([Buffer.from(`*${args.length}\r\n`), ...args.map(v => {
    const b = Buffer.from(String(v)); return Buffer.concat([Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n')]);
  })]);
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(10000, () => socket.destroy(new Error('Redis test timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(encoded));
    function parse(at = 0) {
      const end = buf.indexOf('\r\n', at); if (end < 0) return null;
      const type = String.fromCharCode(buf[at]), value = buf.toString('utf8', at + 1, end); let next = end + 2;
      if (type === '-') throw new Error(value);
      if (type === '+') return { value, next };
      if (type === ':') return { value: Number(value), next };
      const size = Number(value);
      if (size === -1) return { value: null, next };
      if (type === '$') { if (buf.length < next + size + 2) return null; return { value: buf.toString('utf8', next, next + size), next: next + size + 2 }; }
      if (type === '*') { const values = []; for (let i = 0; i < size; i++) { const item = parse(next); if (!item) return null; values.push(item.value); next = item.next; } return { value: values, next }; }
      throw new Error('Unsupported Redis reply');
    }
    socket.on('data', b => { buf = Buffer.concat([buf, b]); try { const result = parse(); if (result) { socket.end(); resolve(result.value); } } catch (e) { socket.destroy(); reject(e); } });
  });
}
assert.equal(await redisCommand(['PING']), 'PONG');
const encode = v => Array.isArray(v) ? v.map(encode) : typeof v === 'string' && v !== 'OK' ? Buffer.from(v).toString('base64') : v;
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, 'Bearer synthetic-ci-token');
    assert(req.url === '/' || req.url === '/pipeline');
    let text = ''; for await (const b of req) text += b;
    const body = JSON.parse(text), commands = req.url === '/pipeline' ? body : [body];
    const results = [];
    for (const command of commands) {
      assert(['get', 'set', 'hgetall', 'hget', 'hset', 'eval'].includes(String(command[0]).toLowerCase()));
      const result = await redisCommand(command);
      results.push({ result: req.headers['upstash-encoding'] === 'base64' ? encode(result) : result });
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/pipeline' ? results : results[0]));
  } catch { res.writeHead(500); res.end(JSON.stringify({ error: 'Synthetic Redis bridge failed' })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cooksync-redis-ci-'));
const worker = path.join(temp, 'worker.cjs'), owner = randomUUID(), operation = randomUUID(), budgetKey = `cooksync:synthetic-ci:${randomUUID()}`;
const code = `
const ts=require(${JSON.stringify(require.resolve('typescript'))}), fs=require('node:fs');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const originalFetch=globalThis.fetch; globalThis.fetch=(url,options)=>{if(new URL(String(url)).origin!==process.env.UPSTASH_REDIS_REST_URL)throw Error('External network blocked');return originalFetch(url,options)};
const {activateKitchen,commitKitchen,readKitchenData,cancelKitchenOperation}=require(${JSON.stringify(path.join(root, 'src/lib/kitchen/server.ts'))});
const {reserveAttempt,settleAttempt}=require(${JSON.stringify(path.join(root, 'src/lib/kitchen/aiBudget.ts'))});
const {atomicDocument}=require(${JSON.stringify(path.join(root, 'src/lib/kitchen/atomicDocument.ts'))});
(async()=>{
 const [mode,id,owner,operation,key]=process.argv.slice(2);
 const command={id:operation,type:'lot.add',locationId:'default',expectedRevision:0,payload:{name:'Synthetic carrot',amount:'3本',compartment:'冷蔵'}};
 if(mode==='init') await activateKitchen(owner,0);
 if(mode==='stock') await commitKitchen(owner,command);
 if(mode==='cancel') await cancelKitchenOperation(owner,command);
 if(mode==='budget') {try {await reserveAttempt(key,id,{owner:id,locationId:'default',jobId:id,environment:'test'},50,100);console.log('reserved')}catch(e){if(e.status!==429)throw e;console.log('capped')}}
 if(mode==='verify') {const s=(await readKitchenData(owner)).state;const b=await atomicDocument(key,()=>({attempts:{}}),x=>x);console.log(JSON.stringify({lots:s.lots.length,revision:s.revision,cancelled:!!s.operations[operation]?.cancelled,total:Object.values(b.attempts).reduce((n,a)=>n+(a.status==='settled'?a.charged:a.ceiling),0)}))}
 if(mode==='settle') {const b=await atomicDocument(key,()=>({attempts:{}}),x=>x);const ids=Object.keys(b.attempts);await settleAttempt(key,ids[0],null);await settleAttempt(key,ids[1],10);await reserveAttempt(key,'released',{owner:'released',locationId:'default',jobId:'released',environment:'test'},40,100)}
})().catch(e=>{console.error(e.message);process.exitCode=1});`;
fs.writeFileSync(worker, code);
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: temp, COOKSYNC_DATA_DIR: temp, UPSTASH_REDIS_REST_URL: endpoint, UPSTASH_REDIS_REST_TOKEN: 'synthetic-ci-token', COOKSYNC_REQUIRE_KV: '1' };
function run(mode, id = '', target = owner, op = operation) {
  return new Promise((resolve, reject) => {
    let text = ''; const p = spawn(process.execPath, [worker, mode, id, target, op, budgetKey], { cwd: root, env, windowsHide: true });
    p.stdout.on('data', b => text += b); p.stderr.on('data', b => text += b); p.on('error', reject); p.on('exit', c => c ? reject(new Error(text)) : resolve(text.trim()));
  });
}
try {
  await run('init'); await Promise.all(Array.from({ length: 8 }, (_, i) => run('stock', String(i))));
  const reservations = await Promise.all(Array.from({ length: 8 }, (_, i) => run('budget', String(i))));
  assert.equal(reservations.filter(x => x === 'reserved').length, 2);
  let result = JSON.parse(await run('verify')); assert.equal(result.lots, 1); assert.equal(result.revision, 1); assert.equal(result.total, 100);
  await run('settle'); result = JSON.parse(await run('verify')); assert.equal(result.total, 100);
  const other = randomUUID(), otherOperation = randomUUID(); await run('init', '', other, otherOperation);
  await Promise.all([run('cancel', '', other, otherOperation), run('stock', '', other, otherOperation)]);
  const race = JSON.parse(await run('verify', '', other, otherOperation)); assert.equal(race.revision, 1); assert.equal(race.lots, race.cancelled ? 0 : 1);
  console.log(JSON.stringify({ actualRedis: true, independentProcesses: 8, stockAppliedOnce: true, budgetCap: 100, reserved: result.total, cancelRace: true, externalApiCalls: 0 }));
} finally { server.closeAllConnections(); server.close(); }

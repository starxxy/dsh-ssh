/**
 * Offline test for the panel WebSocket channel (lib/ws.js): mounts the REAL
 * installWs on a bare loopback HTTP server and drives it over the wire with
 * the same JSON protocol the Web GUI uses. No DSH instance, no SSH server
 * needed (the record points at an unreachable host; the assertions target
 * the channel routing and the session/tab bookkeeping, which run in full).
 *
 * Verifies:
 *  - snapshot / createRecord / connect / input / closeTab / deleteRecord;
 *  - the unified connect semantics over the wire: a connect while a tab for
 *    the record is open returns a FRESH session key in a new tab;
 *  - transferToAi is gone (the method is no longer routed);
 *  - the browser-trust fence rejects a cross-site upgrade request.
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { SshManager } from '../lib/manager.js';
import { installWs } from '../lib/ws.js';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-ssh-panel-channel-'));
const credentials = new Map();
const fakeCredentials = {
  async resolve(ref) { const v = credentials.get(String(ref)); return v ? { value: v } : undefined; },
  async set(ref, value) { credentials.set(ref, value); },
};
const logger = { info: () => {}, warn: () => {}, error: () => {} };

const manager = new SshManager(
  { credentials: fakeCredentials, logger },
  { connectTimeoutMs: 400, heartbeatIntervalMs: 30000 },
  HOME,
);
manager.initialize();

const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
const ctx = { logger };
installWs(ctx, { registerUpgrade: ({ path, handler }) => { server.on('upgrade', (req, socket, head) => { if (req.url.startsWith(path)) handler(req, socket, head); }); } }, manager, []);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Drive the channel the way the panel does
// ---------------------------------------------------------------------------

const ws = new WebSocket(`ws://127.0.0.1:${port}/ssh/ws`, { headers: { Origin: `http://127.0.0.1:${port}` } });
let seq = 0;
const pending = new Map();
const events = [];
ws.on('message', (data) => {
  const message = JSON.parse(String(data));
  if (message.id !== undefined && message.id !== null) {
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error !== undefined) entry.reject(new Error(message.error));
      else entry.resolve(message.result);
    }
    return;
  }
  events.push(message);
});
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

// 1. snapshot
const snap = await request('snapshot');
check('snapshot returns records + tabs', Array.isArray(snap.records) && Array.isArray(snap.tabs), JSON.stringify(snap).slice(0, 100));

// 2. createRecord (panel form, secret via credential store)
const created = await request('createRecord', { name: 'ch-box', host: '10.255.255.1', port: 22, user: 'root', password: 'secret-pw' });
check('createRecord over the channel', created.ok === true, JSON.stringify(created).slice(0, 120));
const recordJson = JSON.stringify(manager.store.list());
check('channel-stored secret never leaks into records', !recordJson.includes('secret-pw'), recordJson.slice(0, 160));

// 3. connect → primary session + tab (the connection itself is unreachable
//    here; the bookkeeping is what is under test)
const c1 = await request('connect', { name: 'ch-box' });
check('connect #1 returns the primary key + tab', c1.key === 'ch-box', JSON.stringify(c1).slice(0, 120));
await sleep(50);
const snap1 = await request('snapshot');
check('primary tab is in the snapshot', snap1.tabs.some((t) => t.key === 'ch-box'), JSON.stringify(snap1.tabs.map((t) => t.key)));

// 4. connect again while a tab is open → a FRESH session in a new tab
const c2 = await request('connect', { name: 'ch-box' });
check('connect #2 (tab open) returns a fresh session key', typeof c2.key === 'string' && c2.key.startsWith('ch-box#') && c2.key !== 'ch-box', JSON.stringify(c2).slice(0, 120));
await sleep(50);
const snap2 = await request('snapshot');
check('two tabs in the snapshot', snap2.tabs.filter((t) => t.key === 'ch-box' || t.key.startsWith('ch-box#')).length === 2, JSON.stringify(snap2.tabs.map((t) => t.key)));

// 5. input on a session whose shell is not ready → readable error, no crash
const input = await request('input', { tab: 'ch-box', data: 'echo hi\r' });
check('input on an unreachable session is a readable error', input.ok === false && typeof input.error === 'string' && input.error.length > 0, JSON.stringify(input).slice(0, 160));

// 6. transferToAi is no longer routed
const transfer = await request('transferToAi', { name: 'ch-box' }).catch((error) => ({ rejected: error.message }));
check('transferToAi is gone (unknown method)', transfer.rejected === 'unknown method "transferToAi"', JSON.stringify(transfer).slice(0, 120));

// 7. cleanup through the channel
await request('closeTab', { tab: c2.key });
const deleted = await request('deleteRecord', { name: 'ch-box' });
check('deleteRecord over the channel', deleted.ok === true, JSON.stringify(deleted).slice(0, 100));
const snap3 = await request('snapshot');
check('record gone after delete', snap3.records.length === 0, JSON.stringify(snap3.records.map((r) => r.name)));

ws.close();

// 8. browser-trust fence: a cross-site upgrade must be refused (403)
const crossSite = await new Promise((resolve) => {
  const hostile = new WebSocket(`ws://127.0.0.1:${port}/ssh/ws`, { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
  hostile.on('open', () => { hostile.close(); resolve('opened'); });
  hostile.on('error', () => resolve('refused'));
});
check('cross-site upgrade is refused by the trust fence', crossSite === 'refused', crossSite);

await manager.shutdown();
server.close();

const failed = results.filter((x) => !x.ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed}/${results.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Offline logic test for the unified connect semantics (no SSH server
 * needed): connecting a saved connection NEVER rejects an already-open
 * connection — when a tab for the record is open, connect opens a FRESH
 * independent session in a new tab; when no tab is open it (re)uses the
 * record's primary session (the one the model tools address).
 *
 * The record points at an unreachable host so connects fail fast; the
 * assertions target the session/tab bookkeeping, which runs in full
 * regardless of the connection outcome.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SshManager } from '../lib/manager.js';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-ssh-connect-tabs-'));

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const r = await manager.createRecord({ name: 'box', host: '10.255.255.1', port: 22, user: 'root', auth: { passwordRef: 'PW' } });
check('create record box', r.ok, r.error);

// 1. First connect: no tab open → the primary session (key = record name).
const c1 = await manager.connect('box');
check('first connect uses the primary key', c1.key === 'box', JSON.stringify(c1).slice(0, 120));
check('first connect opens the primary tab', manager.tabs.includes('box'), JSON.stringify(manager.tabs));

// 2. Connect while a tab is open → a FRESH session in a new tab (never
//    rejected, even though the connection itself is unreachable here).
const c2 = await manager.connect('box');
check('second connect returns a fresh session key', typeof c2.key === 'string' && c2.key.startsWith('box#'), JSON.stringify(c2).slice(0, 120));
check('second connect opens a second tab', manager.tabs.filter((k) => k === 'box' || k.startsWith('box#')).length === 2, JSON.stringify(manager.tabs));
check('fresh session is independent of the primary', manager.sessions.get(c2.key) !== undefined && manager.sessions.get(c2.key) !== manager.sessions.get('box'));

// 3. Close only the primary tab → the secondary tab still counts as "a tab
//    is open" → another fresh session.
await manager.closeTab('box');
check('primary tab closed', !manager.tabs.includes('box'), JSON.stringify(manager.tabs));
const c3 = await manager.connect('box');
check('connect with only a secondary tab open still opens a fresh session',
  c3.key !== 'box' && c3.key.startsWith('box#') && c3.key !== c2.key, JSON.stringify(c3).slice(0, 120));

// 4. Close every tab → connect reuses the (disconnected) primary session.
for (const key of [...manager.tabs]) await manager.closeTab(key);
check('all tabs closed', manager.tabs.length === 0, JSON.stringify(manager.tabs));
const c4 = await manager.connect('box');
check('no open tab → the primary session is reused', c4.key === 'box', JSON.stringify(c4).slice(0, 120));
check('exactly one tab after reuse', manager.tabs.length === 1 && manager.tabs[0] === 'box', JSON.stringify(manager.tabs));

await manager.shutdown();

const failed = results.filter((x) => !x.ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed}/${results.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);

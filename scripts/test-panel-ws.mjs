/** Drive the panel WebSocket channel of the test web instance (port 3081). */
import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:3081/ssh/ws';
const ws = new WebSocket(WS_URL);
let seq = 0;
const pending = new Map();
const events = [];

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

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
  console.log(`EVENT ${message.event}:`, JSON.stringify(message.event === 'state' ? { records: message.state.records.map((r) => ({ name: r.name, status: r.status, busyBy: r.busyBy })), tabs: message.state.tabs } : message).slice(0, 260));
});

ws.on('open', async () => {
  try {
    const snap = await request('snapshot');
    console.log('snapshot records:', snap.records.length, 'tabs:', JSON.stringify(snap.tabs));

    // Simulate the panel form: create a connection with a password
    const created = await request('createRecord', {
      name: 'panel-box', host: '127.0.0.1', port: 2222, user: 'jmcc', password: 'testpass123',
    });
    console.log('createRecord:', JSON.stringify(created).slice(0, 200));

    // Connect (opens a tab for the record)
    const conn1 = await request('connect', { name: 'panel-box' });
    console.log('connect #1:', JSON.stringify(conn1).slice(0, 160));
    if (!conn1.ok) throw new Error(`connect #1 failed: ${conn1.error}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Human command via the panel input bar
    const exec = await request('exec', { name: 'panel-box', command: 'echo PANEL-HELLO; whoami' });
    console.log('exec:', JSON.stringify(exec).slice(0, 160));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const term = await request('terminalSnapshot', { name: 'panel-box', since: 0 });
    console.log('terminal entries:');
    for (const entry of term.entries) console.log(`  [${entry.kind}/${entry.source}] ${entry.text.replace(/\r?\n/g, '\\n').slice(0, 100)}`);

    // Connect AGAIN while the tab is open → must open a FRESH session/tab
    // (connect never rejects an already-open connection)
    const conn2 = await request('connect', { name: 'panel-box' });
    console.log('connect #2 (tab open):', JSON.stringify(conn2).slice(0, 160));
    if (!conn2.ok || typeof conn2.key !== 'string' || conn2.key === 'panel-box') {
      throw new Error('connect with an open tab should return a fresh session key');
    }

    const snap2 = await request('snapshot');
    console.log('after 2nd connect:', JSON.stringify(snap2.records.map((r) => ({ name: r.name, status: r.status }))),
      'tabs:', JSON.stringify(snap2.tabs.map((t) => t.key)));

    // Cleanup: close the fresh tab, then delete the record
    await request('closeTab', { tab: conn2.key });
    await request('deleteRecord', { name: 'panel-box' });
    console.log('deleted');
  } catch (error) {
    console.error('FAIL:', error.message);
  } finally {
    setTimeout(() => { ws.close(); process.exit(0); }, 500);
  }
});

ws.on('error', (error) => {
  console.error('WS error:', error.message);
  process.exit(1);
});

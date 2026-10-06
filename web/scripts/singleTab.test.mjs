// The one-tab-per-session rule (src/singleTab.ts), run by `npm test` in plain
// Node, which strips the TypeScript types. The module reads browser globals
// when it loads, so they are stubbed first and it is imported after. The
// BroadcastChannel is a fake (a real one would keep Node alive) that records
// what the module posts and lets a test deliver another tab's message.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const RECORD = 'mhj-dojo.tabs';
const store = new Map();
const posted = [];
let channel;

globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, String(v)),
};
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  constructor() {
    channel = this;
  }
  postMessage(m) {
    posted.push(m);
  }
};

const { STOPPED, claim, isStopped, lease, live, onChange, settled } = await import('../src/singleTab.ts');

const receive = (m) => channel.onmessage({ data: m });
const records = () => JSON.parse(store.get(RECORD) ?? '{}');

test('claiming a key records it, announces it and notifies listeners', () => {
  const events = [];
  const off = onChange((key, stopped) => events.push([key, stopped]));
  claim('/api/a');
  assert.deepEqual(events, [['/api/a', false]]);
  assert.equal(posted.at(-1).key, '/api/a');
  assert.equal('stopped' in posted.at(-1), false);
  assert.equal(records()['/api/a'].tab, posted.at(-1).tab);
  assert.equal(isStopped(), false);
  // Claiming the same key again does nothing.
  const n = posted.length;
  claim('/api/a');
  assert.equal(posted.length, n);
  assert.equal(events.length, 1);
  off();
});

test('lease: 0 for a key not held, a token for the held key, null once stopped', async () => {
  claim('/api/b');
  assert.equal(lease('/api/other'), 0);
  const l = lease('/api/b');
  assert.ok(l > 0);
  assert.equal(live('/api/b', l), true);
  await settled('/api/b'); // resolves after SETTLE_MS even with no ack
  claim('/api/c');
  assert.equal(lease('/api/b'), 0); // no longer held: nothing to check against
  assert.equal(live('/api/b', l), false);
});

test('a newer claim of the held key from another tab stops this tab', () => {
  claim('/api/d');
  const mine = posted.at(-1);
  const events = [];
  const off = onChange((key, stopped) => events.push([key, stopped]));
  const l = lease('/api/d');
  receive({ key: '/api/d', tab: 'other-tab', at: mine.at + 10 });
  assert.equal(isStopped(), true);
  assert.deepEqual(events, [['/api/d', true]]);
  assert.deepEqual(posted.at(-1), { key: '/api/d', tab: mine.tab, at: mine.at, stopped: true });
  assert.equal(lease('/api/d'), null);
  assert.equal(live('/api/d', l), false);
  off();
});

test('claiming again after being stopped takes the key back and invalidates old leases', () => {
  claim('/api/d');
  assert.equal(isStopped(), false);
  const l = lease('/api/d');
  assert.ok(l > 0);
  claim('/api/e');
  claim('/api/d');
  assert.notEqual(lease('/api/d'), l);
  assert.equal(live('/api/d', l), false);
});

test('an older claim of the held key is answered with this tab\'s own claim', () => {
  claim('/api/f');
  const mine = posted.at(-1);
  receive({ key: '/api/f', tab: 'older-tab', at: mine.at - 5 });
  assert.equal(isStopped(), false);
  assert.deepEqual(posted.at(-1), { key: '/api/f', tab: mine.tab, at: mine.at });
});

test('claims for other keys, and echoes of this tab\'s own, are ignored', () => {
  claim('/api/g');
  const mine = posted.at(-1);
  receive({ key: '/api/else', tab: 'other-tab', at: mine.at + 10 });
  receive({ key: '/api/g', tab: mine.tab, at: mine.at + 10 });
  assert.equal(isStopped(), false);
});

test('a newer record in localStorage stops a tab that missed the message', () => {
  claim('/api/h');
  const mine = posted.at(-1);
  store.set(RECORD, JSON.stringify({ ...records(), '/api/h': { key: '/api/h', tab: 'other-tab', at: mine.at + 1 } }));
  assert.equal(isStopped(), true);
  assert.equal(lease('/api/h'), null);
});

test('a new claim comes after any claim recorded, whatever the clock says', () => {
  const future = Date.now() + 100000;
  store.set(RECORD, JSON.stringify({ '/api/i': { key: '/api/i', tab: 'other-tab', at: future } }));
  claim('/api/i');
  assert.ok(posted.at(-1).at > future);
  assert.equal(isStopped(), false);
});

test('the record keeps at most 20 keys, dropping the oldest claims', () => {
  for (let i = 0; i < 25; i++) claim(`/api/many/${i}`);
  const keys = Object.keys(records());
  assert.equal(keys.length, 20);
  assert.ok(keys.includes('/api/many/24'));
  assert.equal(keys.includes('/api/many/0'), false);
});

test('an ack of a stopped tab settles the claim at once', async () => {
  claim('/api/j');
  const started = Date.now();
  const done = settled('/api/j');
  receive({ key: '/api/j', tab: 'other-tab', at: 1, stopped: true });
  await done;
  assert.ok(Date.now() - started < 90);
  assert.equal(await settled('/api/unclaimed'), undefined);
});

test('STOPPED is 423 Locked', () => {
  assert.equal(STOPPED, 423);
});

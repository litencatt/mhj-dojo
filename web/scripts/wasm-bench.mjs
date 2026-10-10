// Practice-request latency of the engine's WebAssembly build under Node
// (issue #197). Build it first with `make wasm`, then:
//
//	node web/scripts/wasm-bench.mjs [--mode practice|game] [--seeds N] [--first S] [--length tonpuu|hanchan] [--cpu weak|normal|master] [--dump FILE] [--dir DIR]
//
// Practice mode (the default): for each seed it starts a practice session
// (POST /api/sessions, with the advice) and plays it to the end, discarding
// the advice's best tile (or declaring tsumo), timing every request.
//
// Game mode (issue #233): for each seed it starts a game against the CPU
// players (POST /api/games, --length, --cpu) and plays it to game_over: ron or skip
// in the call phase, tsumo or the last legal tile on its own turn (never
// riichi, as internal/match's BenchmarkGameStep plays), next at a round's
// end. Every action is timed, including the CPU seats' play it triggers.
//
// It prints p50/p95/max per request kind (the first create includes the
// engine's warm-up). --dump writes every response body
// (session_id / game_id removed) as one JSON line, so two builds can be
// compared byte for byte with cmp.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    mode: { type: 'string', default: 'practice' },
    length: { type: 'string', default: 'tonpuu' },
    cpu: { type: 'string', default: 'normal' },
    seeds: { type: 'string', default: '30' },
    first: { type: 'string', default: '1' },
    dump: { type: 'string' },
    dir: { type: 'string', default: join(dirname(fileURLToPath(import.meta.url)), '..', 'site-public') },
  },
});

if (opt.mode !== 'practice' && opt.mode !== 'game') throw new Error(`--mode: ${opt.mode}`);

await import(pathToFileURL(join(opt.dir, 'wasm_exec.js')).href);
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(readFileSync(join(opt.dir, 'mhj-dojo.wasm')), go.importObject);
go.run(instance); // returns once main blocks, with the functions defined

const times = {};
const dump = [];
function request(kind, method, path, body) {
  const t0 = performance.now();
  const res = globalThis.mhjDojoRequest(method, path, JSON.stringify(body));
  (times[kind] ??= []).push(performance.now() - t0);
  if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${res.body}`);
  const state = JSON.parse(res.body);
  if (opt.dump) dump.push(JSON.stringify({ ...state, session_id: undefined, game_id: undefined }));
  return state;
}

const first = Number(opt.first);
const MAX_STEPS = 2000; // a bug must not loop forever
for (let seed = first; seed < first + Number(opt.seeds); seed++) {
  if (opt.mode === 'game') playGame(seed);
  else playPractice(seed);
}

function playPractice(seed) {
  let st = request('create', 'POST', '/api/sessions', { seed });
  const base = `/api/sessions/${st.session_id}`;
  while (st.status === 'playing') {
    st = st.can_tsumo
      ? request('tsumo', 'POST', `${base}/tsumo`, {})
      : request('discard', 'POST', `${base}/discard`, { tile: st.advice.candidates[0].tile });
  }
}

function playGame(seed) {
  let st = request('create', 'POST', '/api/games', { seed, length: opt.length, cpu: opt.cpu });
  const path = `/api/games/${st.game_id}/action`;
  for (let steps = 0; !st.game_over; steps++) {
    if (steps >= MAX_STEPS) throw new Error(`seed ${seed}: no game_over after ${MAX_STEPS} actions`);
    const lg = st.legal;
    let act;
    if (st.can_next) act = { type: 'next' };
    else if (lg.ron) act = { type: 'ron' };
    else if (lg.tsumo) act = { type: 'tsumo' };
    else if (st.phase === 'call' && lg.skip) act = { type: 'skip' };
    else act = { type: 'discard', tile: lg.discards.at(-1) };
    st = request(act.type, 'POST', path, act);
  }
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))];
for (const [kind, xs] of Object.entries(times)) {
  if (xs.length === 0) continue;
  xs.sort((a, b) => a - b);
  const f = (v) => v.toFixed(1).padStart(7);
  console.log(`${kind.padEnd(8)} n=${String(xs.length).padStart(4)}  p50 ${f(pct(xs, 50))} ms  p95 ${f(pct(xs, 95))} ms  max ${f(xs[xs.length - 1])} ms`);
}
if (opt.dump) writeFileSync(opt.dump, dump.join('\n') + '\n');
process.exit(0);

// The engine compiled to WebAssembly, running in a Web Worker
// (site-public/worker.js): starting it, and one call to it at a time
// answered by id. wasm.ts routes the API requests to it.

export interface WasmResponse {
  status: number;
  data: unknown; // the parsed JSON body
  save?: string; // a CPU game's save (JSON), on its successful responses
}

interface Reply {
  id: number;
  status: number;
  body: string;
  save?: string;
}

let engine: Promise<Worker> | null = null;
// Told when a worker is given up: the sessions and games it held are gone.
const lostListeners = new Set<() => void>();
// Gives up on the current worker (see start's fail); null before the first.
let abandon: ((message: string) => void) | null = null;
let nextId = 1;
const pending = new Map<number, (r: Reply) => void>();

// How long one call may take before the engine counts as hung. The longest
// legitimate calls are a rebuild from a save (a whole 半荘戦 replays in well
// under a second on a phone) and a round of CPU turns; nothing takes seconds.
const CALL_TIMEOUT_MS = 60_000;

// Starts the worker on first use. The measure 'mhj-dojo:wasm-init' records how
// long the download, compile and start of the engine took. If the engine
// fails to start, or exits later, the next request starts a new worker;
// the sessions it held are rebuilt from their saves as they are asked for.
export function start(): Promise<Worker> {
  if (engine) return engine;
  const started: Promise<Worker> = new Promise<Worker>((resolve, reject) => {
    const t0 = performance.now();
    const url = new URL('worker.js', document.baseURI);
    // A hash of the worker, wasm_exec.js and mhj-dojo.wasm (vite.config.ts), so a
    // deploy never mixes cached and new copies of them.
    const version = import.meta.env.VITE_MHJDOJO_ENGINE as string;
    url.searchParams.set('v', version);
    const w = new Worker(url);
    const fail = (message: string) => {
      w.terminate();
      if (engine !== started) return; // an old worker, already replaced
      engine = null;
      abandon = null;
      for (const listener of lostListeners) listener();
      reject(new Error(message)); // no-op once it had started
      for (const [id, done] of pending) done({ id, status: 500, body: JSON.stringify({ error: message }) });
      pending.clear();
    };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; error?: string } & Partial<Reply>;
      if (m.type === 'ready') {
        try {
          performance.measure('mhj-dojo:wasm-init', { start: t0, end: performance.now() });
        } catch {
          // measuring is best effort
        }
        resolve(w);
      } else if (m.type === 'failed') {
        fail(`計算エンジンを起動できませんでした: ${m.error}`);
      } else if (typeof m.id === 'number') {
        pending.get(m.id)?.(m as Reply);
        pending.delete(m.id);
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      fail(`計算エンジンを読み込めませんでした${e.message ? `: ${e.message}` : ''}`);
    };
    w.onmessageerror = () => fail('計算エンジンの応答を読めませんでした');
    abandon = fail;
  });
  engine = started;
  return started;
}

export async function call(fn: 'request' | 'restore' | 'restoreGame', ...args: string[]): Promise<WasmResponse> {
  const w = await start();
  const id = nextId++;
  const reply = await new Promise<Reply>((resolve) => {
    // A call the engine never answers (it hung, or looped) would leave the
    // page waiting forever: past the timeout the worker is given up, this
    // and any other pending call fail with a 500, and the next request
    // starts a new worker and rebuilds what it needs from the saves.
    const timer = setTimeout(() => {
      if (pending.has(id)) abandon?.('計算エンジンが応答しません');
    }, CALL_TIMEOUT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, fn, args });
  });
  return { status: reply.status, data: JSON.parse(reply.body) as unknown, save: reply.save };
}

/** Calls listener whenever a worker is given up (it failed to start, broke or hung). */
export function onEngineLost(listener: () => void) {
  lostListeners.add(listener);
}

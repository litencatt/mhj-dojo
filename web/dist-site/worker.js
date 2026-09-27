// The static site's Web Worker (issue #67): runs the engine (practice and CPU
// games), the Go program cmd/mhj-dojo-wasm compiled to WebAssembly, off the
// main thread so the analysis and the CPU turns don't freeze the page.
// src/wasm.ts starts it and talks to it:
//
//   worker → page  {type: 'ready', initMs} | {type: 'failed', error} (at start, or later if the engine exits)
//   page → worker  {id, fn: 'request', args: [method, path, body]}   an HTTP API request (docs/api.md)
//                  {id, fn: 'restore', args: [body, query]}          rebuild a session from its moves
//                  {id, fn: 'restoreGame', args: [save]}             rebuild a CPU game from its save
//   worker → page  {id, status, body, save?}   the status and JSON body the server would send, and
//                                              for a CPU game's success its save (JSON) to keep
//
// wasm_exec.js (Go's JS glue) and mhj-dojo.wasm sit next to this file; `make
// wasm` copies them here. The page loads this file as worker.js?v=<version>,
// a hash of the three files taken at build time, and the same ?v= goes on
// the other two so a browser never mixes a cached copy of one with a new
// copy of another after a deploy.
/* global Go, mhjDojoRequest, mhjDojoRestore, mhjDojoRestoreGame */
const version = new URL(self.location.href).searchParams.get('v');
const versioned = (name) => {
  const url = new URL(name, self.location.href);
  if (version) url.searchParams.set('v', version);
  return url;
};

importScripts(versioned('wasm_exec.js').href);

const started = performance.now();

async function instantiate(go) {
  const url = versioned('mhj-dojo.wasm');
  try {
    return (await WebAssembly.instantiateStreaming(fetch(url), go.importObject)).instance;
  } catch {
    // A host that doesn't serve .wasm as application/wasm: compile from bytes.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mhj-dojo.wasm: ${res.status} ${res.statusText}`);
    return (await WebAssembly.instantiate(await res.arrayBuffer(), go.importObject)).instance;
  }
}

const ready = (async () => {
  const go = new Go();
  const instance = await instantiate(go);
  // Runs main until it blocks, which defines mhjDojoRequest, mhjDojoRestore
  // and mhjDojoRestoreGame.
  // The promise settles only if the program exits (a fatal error): every
  // later call would fail, so tell the page to start a new worker.
  go.run(instance).then(
    () => self.postMessage({ type: 'failed', error: 'the engine exited' }),
    (err) => self.postMessage({ type: 'failed', error: String(err) }),
  );
  if (
    typeof mhjDojoRequest !== 'function' ||
    typeof mhjDojoRestore !== 'function' ||
    typeof mhjDojoRestoreGame !== 'function'
  ) {
    throw new Error('mhj-dojo.wasm did not start');
  }
})();

ready.then(
  () => self.postMessage({ type: 'ready', initMs: performance.now() - started }),
  (err) => self.postMessage({ type: 'failed', error: String(err) }),
);

self.onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    await ready;
    const call = { restore: mhjDojoRestore, restoreGame: mhjDojoRestoreGame }[fn] ?? mhjDojoRequest;
    const res = call(...args);
    self.postMessage({ id, status: res.status, body: res.body, save: res.save });
  } catch (err) {
    self.postMessage({ id, status: 500, body: JSON.stringify({ error: String(err) }) });
  }
};

// The static site's Web Worker (issue #67): runs the practice engine, the Go
// program cmd/mhj2wasm compiled to WebAssembly, off the main thread so the
// analysis doesn't freeze the page. src/wasm.ts starts it and talks to it:
//
//   worker → page  {type: 'ready', initMs} | {type: 'failed', error}
//   page → worker  {id, method, path, body}   (an HTTP API request, docs/api.md)
//   worker → page  {id, status, body}         (the status and JSON body the server would send)
//
// wasm_exec.js (Go's JS glue) and mhj2.wasm sit next to this file; `make
// wasm` copies them here.
/* global Go, mhj2Request */
importScripts('wasm_exec.js');

const started = performance.now();

async function instantiate(go) {
  const url = new URL('mhj2.wasm', self.location.href);
  try {
    return (await WebAssembly.instantiateStreaming(fetch(url), go.importObject)).instance;
  } catch {
    // A host that doesn't serve .wasm as application/wasm: compile from bytes.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mhj2.wasm: ${res.status} ${res.statusText}`);
    return (await WebAssembly.instantiate(await res.arrayBuffer(), go.importObject)).instance;
  }
}

const ready = (async () => {
  const go = new Go();
  const instance = await instantiate(go);
  // Runs main until it blocks, which defines mhj2Request; the promise
  // settles only if the program exits.
  go.run(instance);
  if (typeof mhj2Request !== 'function') throw new Error('mhj2.wasm did not start');
})();

ready.then(
  () => self.postMessage({ type: 'ready', initMs: performance.now() - started }),
  (err) => self.postMessage({ type: 'failed', error: String(err) }),
);

self.onmessage = async (e) => {
  const { id, method, path, body } = e.data;
  try {
    await ready;
    const res = mhj2Request(method, path, body ?? '');
    self.postMessage({ id, status: res.status, body: res.body });
  } catch (err) {
    self.postMessage({ id, status: 500, body: JSON.stringify({ error: String(err) }) });
  }
};

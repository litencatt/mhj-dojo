// What the site's engine worker defines once the Go program runs
// (site-public/worker.js), for the tests that call it from worker.evaluate.
declare function mhjDojoRequest(method: string, path: string, body?: string): { status: number; body: string; save?: string };

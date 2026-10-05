import { useEffect, useState } from 'preact/hooks';

/** Shown while the engine (wasm) downloads and starts: a spinner, and the seconds waited once it takes a while. */
export function EngineLoading() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const timer = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p class="muted engine-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true" />
      計算エンジンを読み込んでいます…{secs >= 2 && ` ${secs}秒`}
    </p>
  );
}

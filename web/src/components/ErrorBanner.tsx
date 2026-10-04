import { useEffect, useState } from 'preact/hooks';
import { onStorageFailed } from '../wasm';

interface ErrorBannerProps {
  message: string;
  busy: boolean;
  onRetry?: () => void; // none: a retry would fail the same way
}

/**
 * A failed request's error, with 再試行 (the request again; a failed
 * engine is started anew) and 再読み込み.
 */
export function ErrorBanner({ message, busy, onRetry }: ErrorBannerProps) {
  return (
    <div class="error-banner" role="alert">
      <span class="error-message">{message}</span>
      <span class="error-banner-actions">
        {onRetry && (
          <button type="button" disabled={busy} onClick={onRetry}>
            再試行
          </button>
        )}
        <button type="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </span>
    </div>
  );
}

/** Tells the player, once, that this browser refused to save (wasm.ts). */
export function SaveFailedNotice() {
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => onStorageFailed(() => setFailed(true)), []);
  if (!failed || dismissed) return null;
  return (
    <div class="save-failed" role="status">
      <span>このブラウザに保存できません。再読み込みすると最初からになります</span>
      <button type="button" aria-label="閉じる" title="閉じる" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

import { useState } from 'preact/hooks';
import { useNewVersion } from '../version';

/** The static site's notice that a newer version has been deployed (src/version.ts). */
export function UpdateBanner() {
  const newer = useNewVersion();
  const [dismissed, setDismissed] = useState(false);
  if (!newer || dismissed) return null;
  return (
    <div class="update-banner" role="status">
      <span>新しいバージョンがあります</span>
      <button type="button" class="update-banner-reload" onClick={() => location.reload()}>
        再読み込み
      </button>
      <button type="button" class="update-banner-close" aria-label="閉じる" title="閉じる" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

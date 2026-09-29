import { useState } from 'preact/hooks';
import { useNewVersion } from '../version';

/**
 * The static site's notice that a newer version has been deployed
 * (src/version.ts). The status region is always there, so that screen
 * readers announce the notice when it appears.
 */
export function UpdateBanner() {
  const { state, reload } = useNewVersion();
  const [dismissed, setDismissed] = useState(false);
  return (
    <div role="status" class="update-status">
      {state !== 'current' && !dismissed && (
        <div class="update-banner">
          {state === 'newer' ? (
            <>
              {/* What's new: the 更新情報 page (web/info), which the deploy has updated too. */}
              <a class="update-banner-info" href="info/" title="更新情報を開く">
                新しいバージョンがあります
              </a>
              <button type="button" class="update-banner-reload" onClick={reload}>
                再読み込み
              </button>
            </>
          ) : (
            <span>新しいバージョンがあります。更新の反映まで時間がかかることがあります</span>
          )}
          <button type="button" class="update-banner-close" aria-label="閉じる" title="閉じる" onClick={() => setDismissed(true)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

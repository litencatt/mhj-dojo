import { BUNDLE, SITE_BUILD } from '../version';

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO 8601 time (UTC, from the build) as the viewer's local
 * date and minute, e.g. "2026-09-27 07:57"; unparsable input as given. */
function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The build in the header: a released site's version (e.g. "v2026.0927.0"), otherwise the commit and the build's date in the viewer's time zone (e.g. "abc1234 · 2026-09-26"); details in its title. A link to the 更新情報 page. */
export function VersionTag() {
  const { version, release, id, built } = SITE_BUILD;
  const details = [
    release && `リリース: ${release}`,
    `ビルド: ${version}（${localTime(built)}、${id}）`,
    BUNDLE && `画面: ${BUNDLE}`,
  ].filter(Boolean);
  // It opens the 更新情報 page (web/info).
  return (
    <a class="version-tag" href="info/" title={['更新情報を開く', ...details].join('\n')}>
      {release ?? `${version} · ${localTime(built).slice(0, 10)}`}
    </a>
  );
}

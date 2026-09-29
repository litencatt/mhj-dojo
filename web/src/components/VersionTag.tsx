import { BUNDLE, SITE_BUILD, useVersion } from '../version';

const pad = (n: number) => String(n).padStart(2, '0');

/** An RFC 3339 time (UTC from Go and the site build) as the viewer's local
 * date and minute, e.g. "2026-09-27 07:57"; unparsable input as given. */
function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The build in the header: a released site's version (e.g. "v2026.0927.0"), otherwise the commit and its date in the viewer's time zone (e.g. "abc1234 · 2026-09-26"); details in its title. A link to the 更新情報 page. */
export function VersionTag() {
  const v = useVersion();
  if (!v) return null;
  // The site's engine reports "dev" if it was built outside git; the page's
  // own build still knows its commit (or MHJDOJO_VERSION), and its build date.
  const site = v.version === 'dev' && SITE_BUILD && SITE_BUILD.version !== 'dev' ? SITE_BUILD : null;
  const version = site ? site.version : v.version;
  const time = site ? site.built : v.time;
  const date = time && localTime(time).slice(0, 10);
  const release = SITE_BUILD?.release ?? null;
  const details = [
    release && `リリース: ${release}`,
    `エンジン: ${v.revision || v.version}${v.time ? `（${localTime(v.time)}）` : ''}${v.modified ? '（未コミットの変更を含む）' : ''}`,
    SITE_BUILD && `公開版のビルド: ${SITE_BUILD.version}（${localTime(SITE_BUILD.built)}、${SITE_BUILD.id}）`,
    BUNDLE && `画面: ${BUNDLE}`,
  ].filter(Boolean);
  // It opens the 更新情報 page (web/info).
  return (
    <a class="version-tag" href="info/" title={['更新情報を開く', ...details].join('\n')}>
      {release ?? version}
      {!release && date && ` · ${date}`}
    </a>
  );
}

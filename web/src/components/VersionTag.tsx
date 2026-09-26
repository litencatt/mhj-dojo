import { BUNDLE, SITE_BUILD, useVersion } from '../version';

/** The build in the header, e.g. "abc1234 · 2026-09-26" (the commit and its date), with details in its title. */
export function VersionTag() {
  const v = useVersion();
  if (!v) return null;
  // The site's engine reports "dev" if it was built outside git; the page's
  // own build still knows its commit (or MHJDOJO_VERSION), and its build date.
  const site = v.version === 'dev' && SITE_BUILD && SITE_BUILD.version !== 'dev' ? SITE_BUILD : null;
  const version = site ? site.version : v.version;
  const date = (site ? site.built : v.time).slice(0, 10);
  const details = [
    `エンジン: ${v.revision || v.version}${v.time ? `（${v.time}）` : ''}${v.modified ? '（未コミットの変更を含む）' : ''}`,
    SITE_BUILD && `公開版のビルド: ${SITE_BUILD.version}（${SITE_BUILD.built}、${SITE_BUILD.id}）`,
    BUNDLE && `画面: ${BUNDLE}`,
  ].filter(Boolean);
  return (
    <span class="version-tag" title={details.join('\n')}>
      {version}
      {date && ` · ${date}`}
    </span>
  );
}

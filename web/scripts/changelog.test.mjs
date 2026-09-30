// The 更新情報 page's CHANGELOG.md parser (src/changelog.ts), run by
// `npm test` in plain Node, which strips the TypeScript types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { changelogHtml, forUsersOnly, parseChangelog } from '../src/changelog.ts';

const SAMPLE = `# Changelog

## [v2026.0929.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0929.0...v2026.0929.1) - 2026-09-29

### 新機能
- 役別向聴: 絞り込みをトグルでたたむ by @litencatt in https://github.com/litencatt/mhj-dojo/pull/141
### CI・リポジトリ
- dependabot の対象を追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/129

## [v2026.0928.0](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.9...v2026.0928.0) - 2026-09-28

### 修正
- E2E: アドバイスのテストを修正 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/130
### 依存関係
- Bump vite from 8.3.0 to 8.3.1 in /web by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/132

## New Contributors
- @someone made their first contribution in https://github.com/litencatt/mhj-dojo/pull/131
- Not an item either by @someone in https://github.com/litencatt/mhj-dojo/pull/133

## [v2026.0927.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.0...v2026.0927.1) - 2026-09-27

- Draw 白 as a blank <tile> in \`TileFace\` by @litencatt in https://github.com/litencatt/mhj-dojo/pull/5
- A pull request elsewhere by @litencatt in https://github.com/other/repo/pull/7
- a stray list line
**Full Changelog**: https://github.com/litencatt/mhj-dojo/compare/v2026.0927.0...v2026.0927.1

## [v2026.0927.0](https://github.com/litencatt/mhj-dojo/commits/v2026.0927.0) - 2026-09-27

- Add CI workflow by @litencatt in https://github.com/litencatt/mhj-dojo/pull/2
- Bump actions/upload-artifact from 4.6.2 to 7.0.1 by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/52
`;

test('parses releases, categories and items, newest first', () => {
  const releases = parseChangelog(SAMPLE);
  assert.deepEqual(
    releases.map((r) => [r.version, r.date]),
    [
      ['v2026.0929.1', '2026-09-29'],
      ['v2026.0928.0', '2026-09-28'],
      ['v2026.0927.1', '2026-09-27'],
      ['v2026.0927.0', '2026-09-27'],
    ],
  );
  assert.deepEqual(releases[0].sections[0], {
    category: '新機能',
    items: [
      {
        title: '役別向聴: 絞り込みをトグルでたたむ',
        author: 'litencatt',
        pr: { number: 141, url: 'https://github.com/litencatt/mhj-dojo/pull/141' },
      },
    ],
  });
  // The oldest releases have no category headings.
  assert.equal(releases[2].sections[0].category, null);
  assert.equal(releases[3].sections[0].items.length, 2);
});

test('leaves out other ## sections up to the next release, and lines that are not items', () => {
  const releases = parseChangelog(SAMPLE);
  // New Contributors' lines don't join v2026.0928.0.
  assert.deepEqual(
    releases[1].sections.map((s) => [s.category, s.items.map((it) => it.pr?.number)]),
    [
      ['修正', [130]],
      ['依存関係', [132]],
    ],
  );
  // The stray list line and the Full Changelog line are not items.
  assert.deepEqual(
    releases[2].sections[0].items.map((it) => it.title),
    ['Draw 白 as a blank <tile> in `TileFace`', 'A pull request elsewhere'],
  );
});

test("reads only this repository's pull requests", () => {
  const items = parseChangelog(SAMPLE)[2].sections[0].items;
  assert.deepEqual(items[0].pr, { number: 5, url: 'https://github.com/litencatt/mhj-dojo/pull/5' });
  assert.equal(items[1].pr, null);
  assert.ok(!changelogHtml(SAMPLE).includes('other/repo'));
});

test('keeps only the items for users; a release left empty stays, with no sections', () => {
  const releases = forUsersOnly(parseChangelog(SAMPLE));
  assert.deepEqual(
    releases[0].sections.map((s) => s.category),
    ['新機能'],
  );
  assert.deepEqual(releases[1].sections, []);
  assert.deepEqual(
    releases[2].sections[0].items.map((it) => it.pr?.number),
    [5, undefined],
  );
  // The first release is only named.
  assert.deepEqual(releases[3].sections, []);
});

test('renders HTML without the author or any link to GitHub, escaped', () => {
  const html = changelogHtml(SAMPLE);
  assert.ok(!html.includes('by @'));
  assert.ok(!html.includes('CI・リポジトリ'));
  assert.ok(!html.includes('依存関係'));
  assert.ok(!html.includes('E2E'));
  assert.match(html, /<h2 id="v2026\.0929\.1-title"><span class="release-version">v2026\.0929\.1<\/span> <time datetime="2026-09-29">/);
  assert.match(html, /<li>役別向聴: 絞り込みをトグルでたたむ<\/li>/);
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('github.com'));
  assert.match(html, /内部の改善のみ/);
  assert.match(html, /a blank &lt;tile&gt; in <code>TileFace<\/code>/);
  assert.ok(html.indexOf('v2026.0929.1') < html.indexOf('v2026.0928.0'));
  assert.match(html, /<section class="release" id="v2026\.0927\.0"[^]*<p class="release-internal">最初の公開<\/p>/);
  assert.ok(!html.includes('Add CI workflow'));
  assert.ok(!html.includes('New Contributors'));
  assert.ok(!html.includes('first contribution'));
});

test('no releases: a placeholder, not an empty list', () => {
  assert.equal(changelogHtml('# Changelog\n'), '<p class="release-internal">まだリリースはありません。</p>');
});

test("the repository's CHANGELOG.md parses: every release has a date and every item a pull request", () => {
  const md = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const releases = parseChangelog(md);
  assert.equal(releases.length, (md.match(/^## /gm) ?? []).length);
  assert.ok(releases.length > 0);
  for (const r of releases) {
    for (const s of r.sections) for (const it of s.items) assert.ok(it.pr, `${r.version}: ${it.title}`);
  }
  // Every item line was read.
  const items = releases.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.items.length, 0), 0);
  assert.equal(items, (md.match(/^- /gm) ?? []).length);
});

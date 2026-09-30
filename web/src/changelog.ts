// The 更新情報 page (web/info): CHANGELOG.md, which tagpr writes on each
// release from GitHub's generated release notes (.github/release.yml), as
// HTML for the app's users. The format is tagpr's own:
//
//   ## [v2026.0929.1](https://github.com/…/compare/…) - 2026-09-29
//
//   ### 新機能
//   - <the pull request's title> by @user in https://github.com/…/pull/141
//
// The oldest releases have no ### headings. The build renders it into the
// page (vite.config.ts). Only erasable TypeScript here: `npm test` runs its
// test in plain Node.

export interface ChangelogItem {
  title: string;
  /** The pull request's number and URL, if the line names one. Not shown on
   * the page; the test checks that every item has one. */
  pr: { number: number; url: string } | null;
  author: string | null;
}

export interface ChangelogSection {
  /** The ### heading, or null for items before any (the oldest releases). */
  category: string | null;
  items: ChangelogItem[];
}

export interface Release {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

const RELEASE = /^## \[(v[^\]]+)\]\([^)]*\) - (\d{4}-\d{2}-\d{2})\s*$/;
const ITEM = /^- (.+?) by @(\S+) in (\S+)\s*$/;
// Only this repository's pull requests count; any other URL gives `pr: null`.
const PR_URL = /^https:\/\/github\.com\/litencatt\/mhj-dojo\/pull\/(\d+)$/;

/** The releases in CHANGELOG.md, in its order (newest first). Any other
 * ## section (such as New Contributors) is left out up to the next release,
 * and so are the lines that are not a release note's item. */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  for (const line of md.split(/\r?\n/)) {
    const r = RELEASE.exec(line);
    if (r) {
      release = { version: r[1], date: r[2], sections: [] };
      releases.push(release);
      continue;
    }
    if (line.startsWith('## ')) {
      release = null;
      continue;
    }
    if (!release) continue;
    if (line.startsWith('### ')) {
      release.sections.push({ category: line.slice(4).trim(), items: [] });
      continue;
    }
    const m = ITEM.exec(line);
    if (!m) continue;
    let section = release.sections.at(-1);
    if (!section) {
      section = { category: null, items: [] };
      release.sections.push(section);
    }
    const pr = PR_URL.exec(m[3]);
    section.items.push({ title: m[1], author: m[2], pr: pr ? { number: Number(pr[1]), url: m[3] } : null });
  }
  return releases;
}

// The release notes' categories that are about the repository, not the app.
export const HIDDEN_CATEGORIES = ['CI・リポジトリ', '依存関係', 'New Contributors'];

/** Whether an item is about the app itself: not a hidden category, a bot's update or a change to the E2E tests only. */
function forUsers(category: string | null, item: ChangelogItem): boolean {
  if (category !== null && HIDDEN_CATEGORIES.includes(category)) return false;
  if (item.author?.endsWith('[bot]')) return false;
  return !/\bE2E\b/.test(item.title);
}

/** The releases with only the items for the app's users. A release left
 * with none stays (with no sections): the header shows its version, so the
 * page lists it too. The oldest release, the first one published, is only
 * named (renderChangelog): its notes, from before the notes had categories,
 * are the whole project's history. */
export function forUsersOnly(releases: Release[]): Release[] {
  return releases.map((r, i) => ({
    ...r,
    sections:
      i === releases.length - 1
        ? []
        : r.sections
            .map((s) => ({ ...s, items: s.items.filter((it) => forUsers(s.category, it)) }))
            .filter((s) => s.items.length > 0),
  }));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A pull request's title as HTML: escaped, with `code` spans. */
function inline(title: string): string {
  return escape(title).replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** The releases as HTML (one <section> each, with the version as its id);
 * the last, the oldest, as the first release. The page is for the app's
 * users, so it doesn't link to GitHub. */
export function renderChangelog(releases: Release[]): string {
  if (releases.length === 0) return '<p class="release-internal">まだリリースはありません。</p>';
  return releases
    .map((r, i) => {
      const body =
        i === releases.length - 1
          ? '<p class="release-internal">最初の公開</p>'
          : r.sections.length === 0
          ? '<p class="release-internal">内部の改善のみ</p>'
          : r.sections
              .map((s) => {
                const items = s.items.map((it) => `<li>${inline(it.title)}</li>`).join('');
                const heading = s.category === null ? '' : `<h3>${escape(s.category)}</h3>`;
                return `${heading}<ul>${items}</ul>`;
              })
              .join('');
      const id = escape(r.version);
      return `<section class="release" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title"><span class="release-version">${id}</span> <time datetime="${r.date}">${r.date}</time></h2>${body}</section>`;
    })
    .join('\n');
}

/** CHANGELOG.md as the 更新情報 page's HTML. */
export function changelogHtml(md: string): string {
  return renderChangelog(forUsersOnly(parseChangelog(md)));
}

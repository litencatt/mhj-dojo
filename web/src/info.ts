// The 更新情報 page (web/info/index.html). The site build has already
// rendered the changelog into the page; the local build, which is committed
// and must not change with every release, asks the server for CHANGELOG.md.

import { changelogHtml } from './changelog';
import './tokens.css';
import './info.css';

const main = document.getElementById('changelog');
if (main && main.childElementCount === 0) {
  fetch('../api/changelog')
    .then((res) => (res.ok ? (res.json() as Promise<{ markdown: string }>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(({ markdown }) => {
      main.innerHTML = changelogHtml(markdown);
    })
    .catch(() => {
      main.innerHTML = '<p class="release-internal">更新情報を読み込めませんでした。</p>';
    });
}

// Came here from the mode a link goes to: go back instead, to the session
// or game that page had in its URL.
const from = document.referrer ? new URL(document.referrer) : null;
const isGame = (u: URL) => u.searchParams.get('mode') === 'game';
for (const a of document.querySelectorAll<HTMLAnchorElement>('.info-nav a')) {
  a.addEventListener('click', (e) => {
    const to = new URL(a.href);
    if (!from || from.origin !== to.origin || from.pathname !== to.pathname || isGame(from) !== isGame(to) || history.length < 2) return;
    e.preventDefault();
    history.back();
  });
}

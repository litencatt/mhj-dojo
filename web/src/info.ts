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

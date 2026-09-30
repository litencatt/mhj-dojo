// The 更新情報 page (web/info/index.html): the build has rendered the
// changelog into the page (vite.config.ts); this only wires its links.

import './tokens.css';
import './info.css';

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

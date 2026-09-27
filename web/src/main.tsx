import { render } from 'preact';
import { App } from './App';
import { GameApp } from './GameApp';
import { TileSprite } from './components/TileFace';
import { UpdateBanner } from './components/UpdateBanner';
import { WASM } from './api';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
// ?mode=game plays against CPU players; anything else is solo practice. The
// static site has only practice so far (issue #67).
const game = !WASM && new URLSearchParams(location.search).get('mode') === 'game';
render(
  <>
    {/* Every <TileFace> on the page (practice or game mode) references this
    sprite by id, so it must render before any tile does. */}
    <TileSprite />
    {game ? <GameApp /> : <App />}
    <UpdateBanner />
  </>,
  root,
);

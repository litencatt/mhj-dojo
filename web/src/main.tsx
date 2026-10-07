import { render } from 'preact';
import { App } from './App';
import { GameApp } from './GameApp';
import { DojoHome } from './dojo/DojoHome';
import { TileSprite } from './components/TileFace';
import { UpdateBanner } from './components/UpdateBanner';
import { registerServiceWorker } from './sw';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
// ?mode=game plays against CPU players; ?mode=dojo is the dojo hub, or a dojo
// game when the URL has a game (a reload) or play (the hub's 対局開始); anything
// else is solo practice.
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const dojoGame = mode === 'dojo' && (params.has('game') || params.has('play'));
render(
  <>
    {/* Every <TileFace> on the page (practice or game mode) references this
    sprite by id, so it must render before any tile does. */}
    <TileSprite />
    {mode === 'dojo' && !dojoGame ? <DojoHome /> : mode === 'game' ? <GameApp /> : dojoGame ? <GameApp dojo /> : <App />}
    <UpdateBanner />
  </>,
  root,
);
registerServiceWorker();

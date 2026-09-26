import { render } from 'preact';
import { App } from './App';
import { GameApp } from './GameApp';
import { WASM } from './api';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
// ?mode=game plays against CPU players; anything else is solo practice. The
// static site has only practice so far (issue #67).
const game = !WASM && new URLSearchParams(location.search).get('mode') === 'game';
render(game ? <GameApp /> : <App />, root);

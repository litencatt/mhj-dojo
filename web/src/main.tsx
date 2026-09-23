import { render } from 'preact';
import { App } from './App';
import { GameApp } from './GameApp';
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
// ?mode=game plays against CPU players; anything else is solo practice.
const game = new URLSearchParams(location.search).get('mode') === 'game';
render(game ? <GameApp /> : <App />, root);

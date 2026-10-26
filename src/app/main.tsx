import './polyfills.ts';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/manrope/latin-ext-400.css';
import '@fontsource/manrope/latin-ext-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/live.css';
import './styles/football.css';
import './styles/playlists.css';
import { render } from 'preact';
import { App } from './App.tsx';
import { initFocus, getEngine } from './focus/index.ts';
import { installInput } from './nav/input.ts';
import { exitApp, isWebOS, onPointerVisibility } from './platform/webos.ts';
import { catalogue, loadCatalogue } from './data/catalogue.ts';
import { loadLibrary } from './data/sourceLibrary.ts';

const stage = document.getElementById('stage') as HTMLElement;

/** Desktop browsers: scale the fixed 1920x1080 stage to the window. On the TV this is 1. */
function fitStage(): void {
  const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = k === 1 ? '' : `scale(${k})`;
  stage.style.left = `${Math.max(0, (window.innerWidth - 1920 * k) / 2)}px`;
  stage.style.top = `${Math.max(0, (window.innerHeight - 1080 * k) / 2)}px`;
}
fitStage();
window.addEventListener('resize', fitStage);

initFocus(stage);
installInput({ engine: getEngine(), root: stage, onExit: exitApp });

if (isWebOS()) {
  document.body.classList.add('pointer-hidden');
  onPointerVisibility((visible) => document.body.classList.toggle('pointer-hidden', !visible));
}

render(<App />, stage);
loadLibrary();
loadCatalogue().then(() => {
  const s = catalogue.value;
  console.info('[fbtv] catalogue', s.status === 'ready' ? `${s.data.origin} ${s.data.channels.length} channels (${s.data.generatedAt})` : s.status);
});
// First focus once the initial screen is in the DOM.
requestAnimationFrame(() => getEngine().focusFirst());

console.info(`[fbtv] ${__APP_TITLE__} ${__APP_VERSION__} (${__APP_COMMIT__}) started`);

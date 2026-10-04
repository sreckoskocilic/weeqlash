import { el, showScreen } from './dom.js';
import { showView } from './nav.js';
import { getSocket } from './socket.js';

const modes = [];

export function registerHomeHandler(handler) {
  modes.push(handler);
}

function goHome() {
  if (modes.some((m) => m.isLive?.()) && !confirm('Quit this game? It counts as a loss.')) {
    return;
  }
  getSocket()?.emit('room:leave');
  for (const m of modes) {
    m.reset();
  }
  showScreen('screen-connect');
  showView('play');
  import('./auth.js').then(({ checkAuth }) => checkAuth());
}

export function initHome() {
  el('btn-home').addEventListener('click', goHome);
}

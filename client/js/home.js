import { el, showScreen } from './dom.js';
import { showView } from './nav.js';
import { getSocket } from './socket.js';

const modes = [];

// Solo screens and their game-over phase; a run is live while its screen shows and game over doesn't.
const SOLO_SCREENS = {
  'screen-skipnot': 'skipnot-phase-gameover',
  'screen-howhigh': 'howhigh-phase-gameover',
  'screen-mathquiz': 'mathquiz-phase-gameover',
  'screen-centographer': 'cento-phase-gameover',
  'screen-pokedome': 'pokedome-phase-gameover',
};

export function registerHomeHandler(handler) {
  modes.push(handler);
}

export function soloRunLive() {
  return Object.entries(SOLO_SCREENS).some(
    ([screen, gameover]) =>
      el(screen).style.display !== 'none' && el(gameover).style.display === 'none',
  );
}

// The server drops a solo run on disconnect or error; say so instead of leaving a frozen screen.
export function showRunEnded(msg = 'Something went wrong. This run has ended.') {
  el('run-ended-msg').textContent = msg;
  el('run-ended').hidden = false;
}

function goHome() {
  const ended = !el('run-ended').hidden;
  el('run-ended').hidden = true;
  if (
    !ended &&
    modes.some((m) => m.isLive?.()) &&
    !confirm('Quit this game? It counts as a loss.')
  ) {
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
  el('btn-run-ended-home').addEventListener('click', goHome);
}

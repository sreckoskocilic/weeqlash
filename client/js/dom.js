import { state } from './state.js';

// Element selector shorthand
export function el(id) {
  return document.getElementById(id);
}

// Alias for compatibility
export const $ = el;

// Qlashique element selector
export function qEl(id) {
  return document.getElementById(id);
}

// Screen visibility management
export function showScreen(id) {
  const isGame = id === 'screen-game';
  const isConnect = id === 'screen-connect';
  const isQlas = id === 'screen-qlashique';
  const isQw = id === 'screen-qlashword';
  const isSkipnot = id === 'screen-skipnot';
  const isHowHigh = id === 'screen-howhigh';
  const isMath = id === 'screen-mathquiz';
  const isCento = id === 'screen-centographer';
  const isLobby = id === 'screen-lobby';
  const hideHome =
    isGame || isQlas || isQw || isSkipnot || isHowHigh || isMath || isCento || isLobby;
  // Qlashword fills the viewport — drop the body's home-title top padding.
  document.body.classList.toggle('qw-active', isQw);
  el('main-title').style.display = hideHome ? 'none' : '';
  el('board-banner').style.display = hideHome ? 'none' : '';
  el('site-footer').style.display = isConnect ? '' : 'none';
  el('announcements').style.display = hideHome ? 'none' : '';
  [
    'screen-connect',
    'screen-lobby',
    'screen-game',
    'screen-gameover',
    'screen-leaderboard',
    'screen-qlashique',
    'screen-qlashword',
    'screen-skipnot',
    'screen-howhigh',
    'screen-mathquiz',
    'screen-centographer',
  ].forEach((s) => {
    el(s).style.display = 'none';
    el(s).classList.remove('show');
  });
  if (isGame || isQlas || isQw || isSkipnot || isHowHigh || isMath || isCento) {
    el(id).style.display = 'flex';
  } else if (isConnect) {
    // Clear inline display so the `.main-columns` flex/center CSS applies (an explicit value left-aligns the card).
    el(id).style.display = '';
  } else {
    el(id).style.display = 'block';
  }
}

// Error display
export function showError(msg) {
  const errEl = el('connect-error');
  errEl.textContent = msg;
  errEl.style.display = msg ? 'block' : 'none';
}

// Sanitize user input to prevent XSS
export function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Get player name (requires login)
export function getPlayerName() {
  if (!state.currentUser) {
    showError('Please log in to play');
    return null;
  }
  showError('');
  return state.currentUser.username;
}

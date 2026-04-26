// ============================================================
// DOM HELPERS
// ============================================================

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
  const isSkipnot = id === 'screen-skipnot';
  el('main-title').style.display = isGame || isQlas || isSkipnot ? 'none' : '';
  el('site-footer').style.display = isConnect ? '' : 'none';
  el('announcements').style.display = isGame || isQlas || isSkipnot ? 'none' : '';
  [
    'screen-connect',
    'screen-lobby',
    'screen-game',
    'screen-gameover',
    'screen-leaderboard',
    'screen-qlashique',
    'screen-skipnot',
  ].forEach((s) => {
    el(s).style.display = 'none';
    el(s).classList.remove('show');
  });
  if (isGame || isQlas || isSkipnot) {
    el(id).style.display = 'flex';
  } else if (isConnect) {
    // Clear inline display so the `.main-columns` class CSS (display: flex
    // with align-items: center) applies. Setting an explicit value here
    // overrides the class and the connect card ends up left-aligned.
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

// Predefined names for guest players (currently unused)
const RANDOM_NAMES = [
  'Qwizakk',
  'PacMoan',
  'EE-TEE',
  'Issous',
  'Sihirator',
  'Bogamber',
  'Dandalf',
  'Burim',
  'Kesko',
  'Lepi',
  'Aliya',
  'Pcheko',
  'Dnepr',
  'nasmirglAna',
];

export function _getRandomName() {
  return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

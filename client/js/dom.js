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
  el('main-title').style.display = isGame || isQlas ? 'none' : '';
  el('site-footer').style.display = isConnect ? '' : 'none';
  [
    'screen-connect',
    'screen-lobby',
    'screen-game',
    'screen-gameover',
    'screen-leaderboard',
    'screen-qlashique',
  ].forEach((s) => {
    el(s).style.display = 'none';
    el(s).classList.remove('show');
  });
  if (isGame || isQlas) {
    el(id).style.display = 'flex';
  } else if (isConnect) {
    el(id).style.display = 'grid';
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

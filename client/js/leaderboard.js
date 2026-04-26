// ============================================================
// LEADERBOARD MODULE
// ============================================================
// Single source of truth for leaderboard row rendering. Every surface that
// shows a leaderboard (panel toggles, gameover screens, post-submit) uses
// `renderLeaderboardRows` — same DOM, same styling, everywhere.

import { el, sanitize } from './dom.js';
import { getSocket } from './socket.js';

export function buildLeaderboardRow(entry, rankNum) {
  const row = document.createElement('div');
  row.className = entry ? 'lb-row' : 'lb-row lb-row-empty';
  const rkText = String(rankNum).padStart(2, '0');
  row.innerHTML = `
    <div class="lb-rk">${rkText}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry ? sanitize(entry.name) : '—'}</div>
    <div style="text-align:center;font-weight:600;font-variant-numeric:tabular-nums">${entry ? entry.answers : '—'}</div>
    <div style="text-align:right;font-size:0.85rem;color:#5ebb52;font-variant-numeric:tabular-nums">${entry ? Math.round(entry.time_ms / 1000) + 's' : '—'}</div>
  `;
  return row;
}

// Always render 10 slots — empty ones get an `lb-row-empty` modifier so we can
// dim them via CSS. Same div, same columns, just a placeholder dash.
export function renderLeaderboardRows(container, entries) {
  if (!container) {
    return;
  }
  container.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    container.appendChild(buildLeaderboardRow(entries[i], i + 1));
  }
}

let _mainLoaded = false;
export function loadMainLeaderboard() {
  if (_mainLoaded) {
    return;
  }
  _mainLoaded = true;
  loadPanelLeaderboard('triviandom', 'triv-lb-rows');
}

export function loadPanelLeaderboard(mode, containerId) {
  const socket = getSocket();
  socket.emit('quiz:leaderboard', { mode }, (res) => {
    const container = document.getElementById(containerId);
    renderLeaderboardRows(container, res.top10 || []);
  });
}

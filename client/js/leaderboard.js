// Single source of truth for leaderboard row rendering across all surfaces.

import { sanitize } from './dom.js';
import { getSocket } from './socket.js';

function buildLeaderboardRow(entry, rankNum) {
  const row = document.createElement('div');
  row.className = entry ? 'lb-row' : 'lb-row lb-row-empty';
  const rkText = String(rankNum).padStart(2, '0');
  row.innerHTML = `
    <div class="lb-rk">${rkText}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry ? sanitize(entry.name) : '—'}</div>
    <div style="text-align:center;font-weight:600;font-variant-numeric:tabular-nums">${entry ? entry.answers : '—'}</div>
    <div style="text-align:right;font-size:var(--fs-sm);color:#5ebb52;font-variant-numeric:tabular-nums">${entry ? Math.round(entry.time_ms / 1000) + 's' : '—'}</div>
  `;
  return row;
}

function renderLeaderboardRows(container, entries) {
  if (!container) {
    return;
  }
  container.innerHTML = '';
  if (!entries.length) {
    return;
  }
  for (let i = 0; i < 10; i++) {
    container.appendChild(buildLeaderboardRow(entries[i], i + 1));
  }
}

export function loadPanelLeaderboard(mode, containerId) {
  const socket = getSocket();
  socket.emit('quiz:leaderboard', { mode }, (res) => {
    const container = document.getElementById(containerId);
    renderLeaderboardRows(container, res.top10 || []);
  });
}

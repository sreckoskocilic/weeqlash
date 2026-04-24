// ============================================================
// LEADERBOARD MODULE
// ============================================================

import { el, sanitize } from './dom.js';
import { getSocket } from './socket.js';

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
    if (!container) {
      return;
    }
    container.innerHTML = '';
    const entries = res.top10 || [];
    for (let i = 0; i < 10; i++) {
      const entry = entries[i];
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML = `
        <div class="lb-rk">${String(i + 1)}</div>
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry ? sanitize(entry.name) : '—'}</div>
        <div style="text-align:center;font-weight:600;font-variant-numeric:tabular-nums">${entry ? entry.answers : '0'}</div>
        <div style="text-align:right;font-size:0.85rem;color:#5ebb52;font-variant-numeric:tabular-nums">${entry ? Math.round(entry.time_ms / 1000) : '0'}s</div>
      `;
      container.appendChild(row);
    }
  });
}

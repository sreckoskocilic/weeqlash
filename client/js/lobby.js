// ============================================================
// LOBBY MODULE
// ============================================================

import { el, sanitize } from './dom.js';
import { state } from './state.js';

export function renderPlayers(players, totalSlots) {
  const ul = el('player-list');
  ul.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot" style="background:${sanitize(p.color)}"></span>
      <span>${sanitize(p.name)}</span>
      ${p.isHost ? '<span class="badge">host</span>' : ''}
      ${p.id === state.myId ? '<span class="badge">you</span>' : ''}
    `;
    ul.appendChild(li);
  });
  for (let i = players.length; i < totalSlots; i++) {
    const li = document.createElement('li');
    li.innerHTML =
      '<span class="dot" style="background:#333"></span><span style="color:var(--muted)">waiting…</span>';
    ul.appendChild(li);
  }
}

export function initLobby() {
  // Lobby initialization if needed
}

import { loadPanelLeaderboard } from './leaderboard.js';
import { showError } from './dom.js';

const GAME_KEY = 'weeqlash.game';

function rememberedGame() {
  try {
    return localStorage.getItem(GAME_KEY);
  } catch {
    return null;
  }
}

function selectGame(id) {
  const panel =
    document.querySelector(`[data-game-panel="${id}"]`) ||
    document.querySelector('[data-game-panel]');
  document.querySelectorAll('[data-game-panel]').forEach((p) => {
    p.hidden = p !== panel;
  });
  document.querySelectorAll('.game-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.game === panel.dataset.gamePanel);
  });
  if (panel.dataset.lbMode) {
    loadPanelLeaderboard(panel.dataset.lbMode, panel.querySelector('.lb-rows').id);
  }
  try {
    localStorage.setItem(GAME_KEY, panel.dataset.gamePanel);
  } catch {
    return;
  }
}

export function showView(name) {
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.dataset.viewName !== name;
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((n) => {
    n.classList.toggle('active', n.dataset.view === name);
  });
  if (name === 'play') {
    selectGame(rememberedGame());
  }
}

export function applyAuthState(loggedIn) {
  document.querySelectorAll('[data-auth]').forEach((el) => {
    el.hidden = loggedIn ? el.dataset.auth === 'out' : el.dataset.auth === 'in';
  });
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.hidden) {
    showView('play');
  }
}

function initLatest() {
  const btn = document.getElementById('btn-latest');
  const pop = document.getElementById('latest-pop');
  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(pop.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target)) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      setOpen(false);
    }
  });
}

function applyInvite() {
  const code = new URLSearchParams(location.search).get('join');
  if (!code) {
    return;
  }
  history.replaceState(null, '', location.pathname);
  const game = document.querySelector('meta[name="wq-invite-game"]')?.content;
  if (!game) {
    showError('That invite has expired or the game already started.');
    return;
  }
  const host = document.querySelector('meta[name="wq-invite-host"]').content;
  selectGame(game);
  const panel = document.querySelector(`[data-game-panel="${game}"]`);
  panel.querySelector('.game-code').value = code.toUpperCase();
  const note = document.createElement('p');
  note.className = 'game-invite';
  note.textContent = `${host} invited you. Hit JOIN.`;
  panel.querySelector('.game-actions').before(note);
  panel.querySelector('.game-join').focus();
}

export function initNav() {
  const nav = document.getElementById('connect-nav');
  if (!nav) {
    return;
  }
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.hidden) {
      return;
    }
    showView(btn.dataset.view);
  });
  document.querySelector('.game-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-game]');
    if (item) {
      selectGame(item.dataset.game);
    }
  });
  initLatest();
  selectGame(rememberedGame());
  applyInvite();
}

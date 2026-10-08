import { loadPanelLeaderboard } from './leaderboard.js';
import { showError } from './dom.js';

const GAME_KEY = 'weeqlash.game';
const SCORES_KEY = 'weeqlash.scores';

function rememberedGame() {
  try {
    return localStorage.getItem(GAME_KEY);
  } catch {
    return null;
  }
}

function scoresHidden() {
  try {
    return localStorage.getItem(SCORES_KEY) === 'hidden';
  } catch {
    return false;
  }
}

function loadScores(panel) {
  if (panel?.dataset.lbMode && !scoresHidden()) {
    loadPanelLeaderboard(panel.dataset.lbMode, panel.querySelector('.lb-rows').id);
  }
}

function applyScoresHidden(hidden) {
  document.querySelector('.game-picker').classList.toggle('scores-hidden', hidden);
  document.querySelectorAll('.game-lb-toggle').forEach((btn) => {
    btn.textContent = hidden ? 'SHOW SCORES' : 'HIDE SCORES';
    btn.setAttribute('aria-expanded', String(!hidden));
  });
}

function toggleScores() {
  const hidden = !scoresHidden();
  try {
    localStorage.setItem(SCORES_KEY, hidden ? 'hidden' : 'shown');
  } catch {
    return;
  }
  applyScoresHidden(hidden);
  loadScores(document.querySelector('[data-game-panel]:not([hidden])'));
}

function selectGame(id) {
  const usable = !document.querySelector(`.game-item[data-game="${id}"]`)?.hidden;
  const panel =
    (usable && document.querySelector(`[data-game-panel="${id}"]`)) ||
    document.querySelector('[data-game-panel]');
  document.querySelectorAll('[data-game-panel]').forEach((p) => {
    p.hidden = p !== panel;
  });
  document.querySelectorAll('.game-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.game === panel.dataset.gamePanel);
  });
  loadScores(panel);
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
  document.getElementById('btn-home').hidden = name === 'play';
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
  const menu = document.querySelector('.game-menu');
  new ResizeObserver(() => {
    if (menu.offsetWidth) {
      const offset = menu.getBoundingClientRect().left - nav.getBoundingClientRect().left;
      document.documentElement.style.setProperty('--menu-w', menu.offsetWidth + offset + 'px');
    }
  }).observe(menu);
  document.querySelectorAll('.game-code').forEach((input) =>
    input.addEventListener('paste', (e) => {
      const link = e.clipboardData.getData('text').match(/[?&]join=([a-z0-9]+)/i);
      if (link) {
        e.preventDefault();
        input.value = link[1].toUpperCase();
        input.dispatchEvent(new Event('input'));
      }
    }),
  );
  applyScoresHidden(scoresHidden());
  document
    .querySelectorAll('.game-lb-toggle')
    .forEach((btn) => btn.addEventListener('click', toggleScores));
  selectGame(rememberedGame());
  applyInvite();
}

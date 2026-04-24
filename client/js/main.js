// ============================================================
// MAIN ENTRY POINT
// ============================================================

import * as constants from './constants.js';
import { state } from './state.js';
import * as dom from './dom.js';
import * as auth from './auth.js';
import * as socket from './socket.js';
import * as game from './game.js';
import * as question from './question.js';
import * as quiz from './quiz.js';
import * as leaderboard from './leaderboard.js';
import * as keyboard from './keyboard.js';
import * as qlashique from './qlashique.js';

// Server URL configuration
const serverUrl =
  window.WEEFLASH_SERVER_URL ||
  (window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin);

// Initialize Socket.IO
async function init() {
  const { io } = await import(`${serverUrl}/socket.io/socket.io.esm.min.js`);

  const sock = io(serverUrl, {
    transports: ['websocket'],
    withCredentials: true,
  });

  // Initialize all modules
  socket.initSocket(serverUrl, sock);
  socket.initSocketEvents();

  auth.initAuth(serverUrl, sock);
  auth.initAuthHandlers();

  // Board-mode socket + room UI wiring (moved to game.js)
  game.setupBoardSocketHandlers(sock);
  game.setupBoardGameHandlers(sock);

  // Qlashique wiring (sits alongside board handlers)
  qlashique.initQlashique(sock);

  // Setup-screen UI (category toggles, help, legal modals, etc.)
  initUI();

  // Quiz mode handlers
  quiz.initQuiz();

  // Question modal continue button
  question.initQuestion();

  // Keyboard handlers
  keyboard.initKeyboard();

  // Load leaderboard on connect
  sock.on('connect', () => {
    leaderboard.loadMainLeaderboard();
    state.myId = sock.id;

    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      dom.el('dev-quickstart-section').style.display = '';
    }
  });
}

function initUI() {
  // Populate category toggle buttons
  dom.el('cat-toggle-btns').innerHTML = constants.CATS.map(
    (cat) =>
      `<button class="cat-toggle-btn active" data-cat="${cat}">${constants.CAT_NAMES[cat]}</button>`,
  ).join('');

  state.setupEnabledCats = constants.CATS.filter((c) => c !== 'death_metal' && c !== 'epl_2025');

  // Setup button groups
  initOptBtnGroup('board-size-btns', (v) => {
    state.setupBoardSize = v;
  });
  initOptBtnGroup('timer-btns', (v) => {
    state.setupTimer = v;
  });

  // Category toggles
  dom.el('cat-toggle-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-toggle-btn');
    if (!btn) return;
    const cat = btn.dataset.cat;
    if (state.setupEnabledCats.includes(cat)) {
      if (state.setupEnabledCats.length <= 1) return;
      state.setupEnabledCats = state.setupEnabledCats.filter((c) => c !== cat);
      btn.classList.remove('active');
    } else {
      state.setupEnabledCats.push(cat);
      btn.classList.add('active');
    }
  });

  dom.el('btn-cats-all').addEventListener('click', () => {
    state.setupEnabledCats = [...constants.CATS];
    document.querySelectorAll('#cat-toggle-btns .cat-toggle-btn').forEach((btn) => {
      btn.classList.add('active');
    });
  });

  dom.el('btn-cats-none').addEventListener('click', () => {
    state.setupEnabledCats = [];
    document.querySelectorAll('#cat-toggle-btns .cat-toggle-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
  });

  // Help and settings
  dom.el('btn-help').addEventListener('click', () => {
    dom.el('help-modal').classList.add('show');
  });
  dom.el('btn-hc').addEventListener('click', () => {
    document.body.classList.toggle('high-contrast');
    dom.el('btn-hc').classList.toggle('active', document.body.classList.contains('high-contrast'));
  });
  dom.el('btn-advanced').addEventListener('click', () => {
    const sec = dom.el('advanced-section');
    const visible = sec.style.display !== 'none';
    sec.style.display = visible ? 'none' : 'block';
    dom.el('btn-advanced').classList.toggle('active', !visible);
  });

  const closeHelp = () => dom.el('help-modal').classList.remove('show');
  const openLegal = (page) => dom.el('modal-' + page).classList.add('open');
  const closeLegal = (page) => dom.el('modal-' + page).classList.remove('open');

  dom.el('ann-howto-link').addEventListener('click', (e) => {
    e.preventDefault();
    dom.el('help-modal').classList.add('show');
  });
  dom.el('btn-help-close').addEventListener('click', closeHelp);
  dom.el('help-modal').addEventListener('click', (e) => {
    if (e.target === dom.el('help-modal')) closeHelp();
  });

  document.querySelectorAll('[data-legal-open]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openLegal(link.dataset.legalOpen);
    });
  });
  document.querySelectorAll('[data-legal-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeLegal(btn.dataset.legalClose));
  });
  ['privacy', 'cookies', 'terms'].forEach((page) => {
    dom.el('modal-' + page).addEventListener('click', (e) => {
      if (e.target === dom.el('modal-' + page)) closeLegal(page);
    });
  });

  dom.el('btn-gameover-newgame').addEventListener('click', () => location.reload());

  // Dev quickstart
  dom.el('btn-dev-quickstart').addEventListener('click', () => {
    state.myPlayerIndex = 0;
    const sock = socket.getSocket();
    sock.emit('dev:quickstart', { boardSize: 4 }, ({ ok, error }) => {
      if (!ok) {
        dom.showError(error ?? 'Dev quickstart failed');
      }
    });
  });
}

function initOptBtnGroup(groupId, setter) {
  const group = dom.el(groupId);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt-btn');
    if (!btn) return;
    group.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setter(parseInt(btn.dataset.val));
  });
}

// Export for external use
export { serverUrl };

// Start the app
init();

// Qlashword: 1v1 Scrabble + trivia-gated bonus squares. Board geometry / letter values mirror server/game/qlashword.ts by hand.

import { el, qEl, showScreen, showError, sanitize, getPlayerName } from './dom.js';
import { renderQuestion } from './question-render.js';

// --- mirrored constants (keep in sync with server/game/qlashword.ts) --------

const BOARD_SIZE = 15;

const LETTER_VALUES = {
  A: 1,
  E: 1,
  I: 1,
  O: 1,
  U: 1,
  L: 1,
  N: 1,
  S: 1,
  T: 1,
  R: 1,
  D: 2,
  G: 2,
  B: 3,
  C: 3,
  M: 3,
  P: 3,
  F: 4,
  H: 4,
  V: 4,
  W: 4,
  Y: 4,
  K: 5,
  J: 8,
  X: 8,
  Q: 10,
  Z: 10,
  _: 0,
};

const BONUS_LAYOUT = [
  '3..d...3...d..3',
  '.2...t...t...2.',
  '..2...d.d...2..',
  'd..2...d...2..d',
  '....2.....2....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  '3..d...*...d..3',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....2.....2....',
  'd..2...d...2..d',
  '..2...d.d...2..',
  '.2...t...t...2.',
  '3..d...3...d..3',
];

const BONUS_CHAR = { 3: 'TW', 2: 'DW', '*': 'DW', t: 'TL', d: 'DL' };
// BOARD_BONUS[row][col] = 'TW'|'DW'|'TL'|'DL'|null
const BOARD_BONUS = BONUS_LAYOUT.map((row) => [...row].map((ch) => BONUS_CHAR[ch] || null));
const CENTER = 7;

const BONUS_CLASS = { TW: 'qw-prem-tw', DW: 'qw-prem-dw', TL: 'qw-prem-tl', DL: 'qw-prem-dl' };
const BONUS_LABEL = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL' };
const BONUS_FULL = {
  TW: 'TRIPLE WORD',
  DW: 'DOUBLE WORD',
  TL: 'TRIPLE LETTER',
  DL: 'DOUBLE LETTER',
};

// --- module state -----------------------------------------------------------

let sock = null;
let qwCode = null;
let qwMyIdx = null;
let qwIsHost = false;
const qwPlayers = [{ name: '' }, { name: '' }];

let qwBoard = emptyBoard(); // server-authoritative settled tiles
let qwRack = []; // my rack letters
let qwScores = [0, 0];
let qwCurrentIdx = 0; // whose turn (server)
let qwPhase = 'place'; // 'place' | 'bonus_q' | 'game_over'
let qwBagCount = 0;

let qwPending = []; // [{row,col,letter,blank,rackIdx}] placed this turn, not submitted
let qwSelectedRackIdx = null; // click-to-place selection
let qwCursor = null; // { row, col, dir: 'H'|'V' } keyboard typing cursor
let qwSwapMode = false;
const qwSwapSel = new Set(); // rack indices marked for swap

let qwBonusTimer = null; // setInterval handle for the bonus question countdown
let qwTurnClockTimer = null; // setInterval handle for the placement-turn clock
let qwHistory = []; // [{turn, text}] accumulating turn log

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function isMyTurn() {
  return qwCurrentIdx === qwMyIdx && qwPhase === 'place';
}

function coordKey(r, c) {
  return r + ',' + c;
}

// --- phase / screen helpers -------------------------------------------------

function qwShowPhase(phase) {
  ['waiting', 'game', 'gameover'].forEach((p) => {
    const node = qEl('qw-phase-' + p);
    if (node) {
      node.style.display = p === phase ? '' : 'none';
    }
  });
}

function qwSetStatus(text) {
  const s = qEl('qw-status');
  if (s) {
    s.textContent = text;
  }
}

// --- turn history log -------------------------------------------------------

function qwPlayerName(idx) {
  return qwPlayers[idx]?.name || 'Player ' + (idx + 1);
}

// Append a turn-log line, grouped under "Turn N:" where N = ceil(turn / 2).
function pushHistory(turn, text) {
  qwHistory.push({ turn: turn || 0, text });
  renderHistory();
}

function renderHistory() {
  const host = qEl('qw-history');
  if (!host) {
    return;
  }
  let html = '';
  let lastRound = null;
  for (const e of qwHistory) {
    const round = Math.max(1, Math.ceil(e.turn / 2));
    if (round !== lastRound) {
      html += '<div class="qw-hist-turn">Turn ' + round + ':</div>';
      lastRound = round;
    }
    html += '<div class="qw-hist-entry">' + sanitize(e.text) + '</div>';
  }
  host.innerHTML = html;
  host.scrollTop = host.scrollHeight;
}

// --- rendering --------------------------------------------------------------

function tileMarkup(letter, blank, extraClass) {
  const val = blank ? 0 : (LETTER_VALUES[letter] ?? 0);
  return (
    '<span class="qw-tile ' +
    extraClass +
    (blank ? ' qw-tile-blank' : '') +
    '">' +
    '<span class="qw-tile-letter">' +
    sanitize(letter) +
    '</span>' +
    '<span class="qw-tile-val">' +
    val +
    '</span>' +
    '</span>'
  );
}

// Legal anchor cells this turn (centre if empty board, else cells adjacent to a tile); null when not my placing turn.
function computePlayableCells() {
  if (!isMyTurn()) {
    return null;
  }
  const occupied = (r, c) => qwBoard[r][c] || qwPending.some((t) => t.row === r && t.col === c);
  const anyTile = qwPending.length > 0 || qwBoard.some((row) => row.some(Boolean));
  const set = new Set();
  if (!anyTile) {
    // First move covers the centre — whole centre row + column stay undimmed.
    for (let i = 0; i < BOARD_SIZE; i++) {
      set.add(coordKey(CENTER, i));
      set.add(coordKey(i, CENTER));
    }
    return set;
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (occupied(r, c)) {
        continue;
      }
      const adjacent = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].some(
        ([rr, cc]) => rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && occupied(rr, cc),
      );
      if (adjacent) {
        set.add(coordKey(r, c));
      }
    }
  }
  return set;
}

function renderBoard() {
  const board = qEl('qw-board');
  if (!board) {
    return;
  }
  const pendingByCoord = new Map();
  for (const t of qwPending) {
    pendingByCoord.set(coordKey(t.row, t.col), t);
  }
  const playable = computePlayableCells();

  let html = '';
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const prem = BOARD_BONUS[r][c];
      const premClass = prem ? ' ' + BONUS_CLASS[prem] : '';
      const isCenter = r === CENTER && c === CENTER;
      const settled = qwBoard[r][c];
      const pending = pendingByCoord.get(coordKey(r, c));
      let inner = '';
      if (settled) {
        inner = tileMarkup(settled.letter, settled.blank, 'qw-tile-settled');
      } else if (pending) {
        inner = tileMarkup(pending.letter, pending.blank, 'qw-tile-pending');
      } else if (prem) {
        inner = '<span class="qw-prem-label">' + BONUS_LABEL[prem] + '</span>';
      } else if (isCenter) {
        inner = '<span class="qw-prem-label">★</span>';
      }
      // Highlight legal anchor cells; dim the rest (only during my turn).
      const emptyCell = !settled && !pending;
      const canPlay = playable && emptyCell && playable.has(coordKey(r, c));
      const dim = playable && emptyCell && !playable.has(coordKey(r, c));
      const isCursor = qwCursor && qwCursor.row === r && qwCursor.col === c && emptyCell;
      if (isCursor) {
        inner += '<span class="qw-cursor-caret">' + (qwCursor.dir === 'V' ? '▾' : '▸') + '</span>';
      }
      html +=
        '<div class="qw-cell' +
        premClass +
        (pending ? ' qw-cell-pending' : '') +
        (canPlay ? ' qw-cell-playable' : '') +
        (dim ? ' qw-cell-dim' : '') +
        (isCursor ? ' qw-cell-cursor' : '') +
        '" data-row="' +
        r +
        '" data-col="' +
        c +
        '">' +
        inner +
        '</div>';
    }
  }
  board.innerHTML = html;
}

function renderRack() {
  const rackEl = qEl('qw-rack');
  if (!rackEl) {
    return;
  }
  const usedIdx = new Set(qwPending.map((t) => t.rackIdx));
  let html = '';
  qwRack.forEach((letter, i) => {
    const used = usedIdx.has(i);
    const selected = qwSelectedRackIdx === i;
    const swapSel = qwSwapSel.has(i);
    const display = letter === '_' ? '' : letter;
    const val = LETTER_VALUES[letter] ?? 0;
    html +=
      '<button type="button" class="qw-rack-tile' +
      (used ? ' used' : '') +
      (selected ? ' selected' : '') +
      (swapSel ? ' swap-sel' : '') +
      '" data-idx="' +
      i +
      '"' +
      (used ? '' : ' draggable="true"') +
      '>' +
      '<span class="qw-tile-letter">' +
      sanitize(display) +
      '</span>' +
      '<span class="qw-tile-val">' +
      val +
      '</span>' +
      '</button>';
  });
  rackEl.innerHTML = html;
}

function renderScores() {
  qEl('qw-p0name').textContent = qwPlayers[0]?.name || 'Player 1';
  qEl('qw-p1name').textContent = qwPlayers[1]?.name || 'Player 2';
  qEl('qw-p0score').textContent = qwScores[0];
  qEl('qw-p1score').textContent = qwScores[1];
  // Highlight the half whose turn it is.
  qEl('qw-score0').classList.toggle('active', qwCurrentIdx === 0);
  qEl('qw-score1').classList.toggle('active', qwCurrentIdx === 1);
  const bag = qEl('qw-bag-count');
  if (bag) {
    bag.textContent = qwBagCount;
  }
}

function renderTurnState() {
  const mine = isMyTurn();
  const ind = qEl('qw-turn-indicator');
  if (ind) {
    if (qwPhase === 'bonus_q') {
      ind.textContent = 'Bonus round…';
    } else {
      const name = qwPlayers[qwCurrentIdx]?.name || 'Player ' + (qwCurrentIdx + 1);
      ind.textContent = mine ? 'YOUR TURN' : name + "'s turn";
    }
    ind.classList.toggle('mine', mine);
  }
  ['qw-btn-submit', 'qw-btn-recall', 'qw-btn-pass', 'qw-btn-swap'].forEach((id) => {
    const b = qEl(id);
    if (b) {
      b.disabled = !mine;
    }
  });
}

function renderAll() {
  renderBoard();
  renderRack();
  renderScores();
  renderTurnState();
}

// --- placement interaction --------------------------------------------------

function exitSwapMode() {
  qwSwapMode = false;
  qwSwapSel.clear();
  qEl('qw-btn-swap').textContent = 'SWAP';
  qEl('qw-btn-swap').classList.remove('active');
}

// blankLetter pre-assigns a blank tile's letter (keyboard path); returns true on success so callers can advance the cursor.
function placeTile(rackIdx, row, col, blankLetter) {
  if (!isMyTurn()) {
    return false;
  }
  if (qwBoard[row][col] || qwPending.some((t) => t.row === row && t.col === col)) {
    return false; // occupied
  }
  if (qwPending.some((t) => t.rackIdx === rackIdx)) {
    return false; // already placed
  }
  let letter = qwRack[rackIdx];
  let blank = false;
  if (letter === '_') {
    const chosen = (blankLetter || window.prompt('Blank tile — choose a letter (A–Z):') || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]$/.test(chosen)) {
      return false;
    }
    letter = chosen;
    blank = true;
  }
  qwPending.push({ row, col, letter, blank, rackIdx });
  qwSelectedRackIdx = null;
  renderAll();
  return true;
}

function recallTile(row, col) {
  const before = qwPending.length;
  qwPending = qwPending.filter((t) => !(t.row === row && t.col === col));
  if (qwPending.length !== before) {
    renderAll();
  }
}

function recallAll() {
  if (qwPending.length) {
    qwPending = [];
    renderAll();
  }
}

// Client-only rack reorder; recalls pending tiles first since they reference rack positions.
function shuffleRack() {
  recallAll();
  for (let i = qwRack.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qwRack[i], qwRack[j]] = [qwRack[j], qwRack[i]];
  }
  qwSelectedRackIdx = null;
  renderRack();
}

function onRackClick(idx) {
  const usedIdx = new Set(qwPending.map((t) => t.rackIdx));
  if (qwSwapMode) {
    if (usedIdx.has(idx)) {
      return;
    }
    if (qwSwapSel.has(idx)) {
      qwSwapSel.delete(idx);
    } else {
      qwSwapSel.add(idx);
    }
    renderRack();
    return;
  }
  if (usedIdx.has(idx)) {
    return;
  }
  qwSelectedRackIdx = qwSelectedRackIdx === idx ? null : idx;
  renderRack();
}

function onCellClick(row, col) {
  if (!isMyTurn()) {
    return;
  }
  // Clicking a pending tile recalls it.
  if (qwPending.some((t) => t.row === row && t.col === col)) {
    recallTile(row, col);
    return;
  }
  if (qwSelectedRackIdx !== null) {
    placeTile(qwSelectedRackIdx, row, col);
    return;
  }
  // No rack tile selected → set/toggle the keyboard cursor; re-click flips direction.
  if (!qwBoard[row][col]) {
    setCursor(row, col);
  }
}

// --- keyboard typing --------------------------------------------------------

function setCursor(row, col) {
  if (qwCursor && qwCursor.row === row && qwCursor.col === col) {
    qwCursor.dir = qwCursor.dir === 'H' ? 'V' : 'H';
  } else {
    qwCursor = { row, col, dir: 'H' };
  }
  renderBoard();
}

// Cell is free to type into (no settled tile, no pending tile).
function cellFree(row, col) {
  return (
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE &&
    !qwBoard[row][col] &&
    !qwPending.some((t) => t.row === row && t.col === col)
  );
}

// Move the cursor to the next free cell in its direction; null if none left.
function advanceCursor() {
  if (!qwCursor) {
    return;
  }
  const dr = qwCursor.dir === 'V' ? 1 : 0;
  const dc = qwCursor.dir === 'H' ? 1 : 0;
  let r = qwCursor.row + dr;
  let c = qwCursor.col + dc;
  while (r < BOARD_SIZE && c < BOARD_SIZE) {
    if (cellFree(r, c)) {
      qwCursor = { row: r, col: c, dir: qwCursor.dir };
      return;
    }
    r += dr;
    c += dc;
  }
  qwCursor = null; // ran off the board / line full
}

function typeLetter(ch) {
  if (!qwCursor || !cellFree(qwCursor.row, qwCursor.col)) {
    return;
  }
  const usedIdx = new Set(qwPending.map((t) => t.rackIdx));
  // Prefer an exact rack letter; fall back to a blank assigned to this letter.
  let idx = qwRack.findIndex((l, i) => l === ch && !usedIdx.has(i));
  let blankLetter;
  if (idx === -1) {
    idx = qwRack.findIndex((l, i) => l === '_' && !usedIdx.has(i));
    blankLetter = ch;
  }
  if (idx === -1) {
    qwSetStatus(`No "${ch}" tile in rack.`);
    return;
  }
  const { row, col } = qwCursor;
  if (placeTile(idx, row, col, blankLetter)) {
    advanceCursor();
    renderBoard();
  }
}

function backspaceTile() {
  const last = qwPending[qwPending.length - 1];
  if (!last) {
    return;
  }
  qwCursor = { row: last.row, col: last.col, dir: qwCursor ? qwCursor.dir : 'H' };
  recallTile(last.row, last.col); // re-renders
  renderBoard();
}

function onQwKeydown(e) {
  // Only when the qlashword board is active, it's my placing turn, and not mid-swap or in a text field.
  if (!document.body.classList.contains('qw-active')) {
    return;
  }
  if (!isMyTurn() || qwPhase !== 'place' || qwSwapMode) {
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }
  const key = e.key;
  if (/^[a-zA-Z]$/.test(key)) {
    e.preventDefault();
    typeLetter(key.toUpperCase());
  } else if (key === 'Backspace') {
    e.preventDefault();
    backspaceTile();
  } else if (key === 'Enter') {
    e.preventDefault();
    submitTurn();
  } else if (key === 'Escape') {
    e.preventDefault();
    recallAll();
    qwCursor = null;
    renderBoard();
  } else if (key === ' ' || key === 'Tab') {
    if (qwCursor) {
      e.preventDefault();
      qwCursor.dir = qwCursor.dir === 'H' ? 'V' : 'H';
      renderBoard();
    }
  }
}

// --- actions ----------------------------------------------------------------

function submitTurn() {
  if (!isMyTurn()) {
    return;
  }
  if (qwPending.length === 0) {
    qwSetStatus('Place at least one tile first.');
    return;
  }
  const placement = qwPending.map((t) => ({
    row: t.row,
    col: t.col,
    letter: t.letter,
    blank: t.blank,
  }));
  qEl('qw-btn-submit').disabled = true;
  sock.emit('qlashword:submit_turn', { code: qwCode, placement }, (res) => {
    if (res?.error) {
      qwSetStatus('✗ ' + res.error);
      qEl('qw-btn-submit').disabled = false;
      return;
    }
    qwSetStatus('');
    // Keep pending rendered until the server's state/rack update arrives.
  });
}

function passTurn() {
  if (!isMyTurn()) {
    return;
  }
  recallAll();
  sock.emit('qlashword:pass', { code: qwCode }, (res) => {
    if (res?.error) {
      qwSetStatus('✗ ' + res.error);
    }
  });
}

function toggleSwap() {
  if (!isMyTurn()) {
    return;
  }
  if (!qwSwapMode) {
    recallAll();
    qwSwapMode = true;
    qwSwapSel.clear();
    qwSelectedRackIdx = null;
    qEl('qw-btn-swap').textContent = 'CONFIRM SWAP';
    qEl('qw-btn-swap').classList.add('active');
    qwSetStatus('Pick rack tiles to swap, then press CONFIRM SWAP.');
    renderRack();
    return;
  }
  // confirm
  const indices = [...qwSwapSel];
  if (indices.length === 0) {
    exitSwapMode();
    renderRack();
    return;
  }
  sock.emit('qlashword:swap', { code: qwCode, indices }, (res) => {
    if (res?.error) {
      qwSetStatus('✗ ' + res.error);
    }
  });
  exitSwapMode();
}

// --- bonus question modal ---------------------------------------------------

function openBonusModal() {
  qEl('qw-bonus-modal').classList.add('show');
}

function closeBonusModal() {
  qEl('qw-bonus-modal').classList.remove('show');
  stopBonusTimer();
}

// Toggle between the opt-in prompt step and the question step.
function showBonusStep(step) {
  qEl('qw-bonus-prompt').style.display = step === 'prompt' ? '' : 'none';
  qEl('qw-bonus-question-step').style.display = step === 'question' ? '' : 'none';
}

function startBonusQuestion() {
  qEl('qw-bonus-start-btn').disabled = true;
  sock.emit('qlashword:bonus_start', { code: qwCode }, (res) => {
    if (res?.error) {
      qEl('qw-bonus-start-btn').disabled = false;
    }
  });
}

function startBonusTimer(seconds) {
  stopBonusTimer();
  let left = seconds;
  const label = qEl('qw-bonus-timer');
  if (label) {
    label.textContent = Math.ceil(left) + 's';
  }
  qwBonusTimer = setInterval(() => {
    left = Math.max(0, left - 0.1);
    if (label) {
      label.textContent = Math.ceil(left) + 's';
      label.classList.toggle('danger', left <= seconds * 0.25);
    }
    if (left <= 0) {
      stopBonusTimer();
    }
  }, 100);
}

function stopBonusTimer() {
  if (qwBonusTimer) {
    clearInterval(qwBonusTimer);
    qwBonusTimer = null;
  }
}

// --- placement-turn clock (90s, shown next to the scores) -------------------

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function startTurnClock(seconds) {
  stopTurnClock();
  const elClock = qEl('qw-turn-clock');
  if (!elClock) {
    return;
  }
  let left = seconds;
  elClock.textContent = fmtClock(left);
  elClock.classList.remove('danger', 'urgent');
  qwTurnClockTimer = setInterval(() => {
    left = Math.max(0, left - 0.25);
    elClock.textContent = fmtClock(left);
    elClock.classList.toggle('danger', left <= 15);
    elClock.classList.toggle('urgent', left <= 10); // flashing box for the final 10s
    if (left <= 0) {
      stopTurnClock();
    }
  }, 250);
}

function stopTurnClock() {
  if (qwTurnClockTimer) {
    clearInterval(qwTurnClockTimer);
    qwTurnClockTimer = null;
  }
  const elClock = qEl('qw-turn-clock');
  if (elClock) {
    elClock.textContent = '';
    elClock.classList.remove('danger', 'urgent');
  }
}

function submitBonusAnswer(answerIdx) {
  document.querySelectorAll('#qw-options .qlas-opt').forEach((b) => (b.disabled = true));
  sock.emit('qlashword:answer_bonus', { code: qwCode, answerIdx }, () => {});
}

// --- lobby actions ----------------------------------------------------------

function createRoom() {
  const playerName = getPlayerName();
  if (!playerName) {
    return;
  }
  qwIsHost = true;
  qwCode = null;
  resetMatch();
  showScreen('screen-qlashword');
  qwShowPhase('waiting');
  qEl('qw-waiting-label').textContent = 'Waiting for opponent…';
  qEl('qw-btn-start').style.display = 'none';
  qEl('qw-code-row').style.display = 'none';

  sock.emit('qlashword:create_room', { playerName }, (res) => {
    if (res?.error) {
      showError(res.error);
      return;
    }
    qwCode = res.code;
    qwMyIdx = 0;
    qwPlayers[0].name = playerName;
    qEl('qw-code-val').textContent = res.code;
    qEl('qw-code-row').style.display = '';
  });
}

function joinRoom() {
  const codeInput = el('qlashword-join-code').value.trim().toUpperCase();
  if (codeInput.length !== 5) {
    showError('Enter a 5-letter Qlashword room code.');
    return;
  }
  const playerName = getPlayerName();
  if (!playerName) {
    return;
  }
  qwIsHost = false;
  qwCode = codeInput;
  resetMatch();
  showScreen('screen-qlashword');
  qwShowPhase('waiting');
  qEl('qw-waiting-label').textContent = 'Waiting for host to start…';
  qEl('qw-btn-start').style.display = 'none';
  qEl('qw-code-row').style.display = 'none';

  sock.emit('room:join', { code: qwCode, playerName }, (res) => {
    if (res?.error) {
      showError(res.error);
      qwCode = null;
      return;
    }
    qwMyIdx = res.myIdx;
    qwPlayers[0].name = res.players[0]?.name || '';
    qwPlayers[1].name = res.players[1]?.name || '';
  });
}

function startGame() {
  const btn = qEl('qw-btn-start');
  btn.disabled = true;
  sock.emit('room:start', { code: qwCode }, (res) => {
    btn.disabled = false;
    if (res?.error) {
      // Surface the error on the waiting panel; leave the button so the host can retry.
      qEl('qw-waiting-label').textContent = res.error + ' — tap START again.';
    }
  });
}

function resetMatch() {
  qwBoard = emptyBoard();
  qwRack = [];
  qwScores = [0, 0];
  qwCurrentIdx = 0;
  qwPhase = 'place';
  qwBagCount = 0;
  qwPending = [];
  qwSelectedRackIdx = null;
  qwCursor = null;
  qwHistory = [];
  renderHistory();
  exitSwapMode();
  stopBonusTimer();
  stopTurnClock();
  closeBonusModal();
}

// --- init -------------------------------------------------------------------

export function initQlashword(socket) {
  sock = socket;

  // Lobby buttons
  el('btn-qlashword-create').addEventListener('click', createRoom);
  el('btn-qlashword-join').addEventListener('click', joinRoom);
  qEl('qw-btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(qEl('qw-code-val').textContent);
  });
  qEl('qw-btn-start').addEventListener('click', startGame);
  qEl('qw-bonus-start-btn').addEventListener('click', startBonusQuestion);
  qEl('qw-btn-playagain').addEventListener('click', () => location.reload());

  // Action buttons
  qEl('qw-btn-submit').addEventListener('click', submitTurn);
  qEl('qw-btn-recall').addEventListener('click', recallAll);
  qEl('qw-btn-pass').addEventListener('click', passTurn);
  qEl('qw-btn-swap').addEventListener('click', toggleSwap);
  qEl('qw-btn-shuffle').addEventListener('click', shuffleRack);
  qEl('qw-btn-history').addEventListener('click', () => {
    renderHistory();
    qEl('qw-history-modal').classList.add('show');
  });
  // Click anywhere on the history overlay closes it.
  qEl('qw-history-modal').addEventListener('click', () => {
    qEl('qw-history-modal').classList.remove('show');
  });

  // Board interaction (event delegation)
  const board = qEl('qw-board');
  board.addEventListener('click', (e) => {
    const cell = e.target.closest('.qw-cell');
    if (!cell) {
      return;
    }
    onCellClick(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  board.addEventListener('dragover', (e) => {
    if (e.target.closest('.qw-cell')) {
      e.preventDefault();
    }
  });
  board.addEventListener('drop', (e) => {
    const cell = e.target.closest('.qw-cell');
    if (!cell) {
      return;
    }
    e.preventDefault();
    const idx = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(idx)) {
      placeTile(idx, Number(cell.dataset.row), Number(cell.dataset.col));
    }
  });

  // Rack interaction (event delegation)
  const rack = qEl('qw-rack');
  rack.addEventListener('click', (e) => {
    const tile = e.target.closest('.qw-rack-tile');
    if (!tile || tile.classList.contains('used')) {
      return;
    }
    onRackClick(Number(tile.dataset.idx));
  });
  rack.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('.qw-rack-tile');
    if (!tile || tile.classList.contains('used')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', tile.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
  });

  // Keyboard typing: click a cell to drop a cursor, then type letters.
  document.addEventListener('keydown', onQwKeydown);

  // --- socket events ---

  socket.on('room:player_joined', ({ players }) => {
    if (!qwCode) {
      return;
    }
    players.forEach((p, i) => {
      if (qwPlayers[i]) {
        qwPlayers[i].name = p.name || '';
      }
    });
    // Host sees the Start button once the room has 2 players.
    if (qwIsHost && players.length === 2) {
      qEl('qw-waiting-label').textContent = players[1].name + ' joined — ready to start.';
      qEl('qw-btn-start').style.display = '';
    }
  });

  socket.on('qlashword:start', ({ players, state }) => {
    if (!qwCode) {
      return;
    }
    players.forEach((p, i) => {
      if (qwPlayers[i]) {
        qwPlayers[i].name = p.name || '';
      }
    });
    applyState(state);
    qwShowPhase('game');
    showScreen('screen-qlashword');
    renderAll();
    qwSetStatus('');
  });

  socket.on('qlashword:rack', ({ rack: r }) => {
    if (!qwCode) {
      return;
    }
    qwRack = r || [];
    qwPending = [];
    qwSelectedRackIdx = null;
    exitSwapMode();
    renderRack();
  });

  socket.on('qlashword:state', (state) => {
    if (!qwCode) {
      return;
    }
    applyState(state);
    renderAll();
  });

  socket.on('qlashword:turn_start', ({ seconds }) => {
    if (!qwCode) {
      return;
    }
    startTurnClock(seconds || 90);
  });

  socket.on('qlashword:bonus_prompt', (data) => {
    if (!qwCode) {
      return;
    }
    const mine = data.activePlayerIdx === qwMyIdx;
    qwPhase = 'bonus_q';
    stopTurnClock(); // turn clock pauses during the bonus round
    renderTurnState();
    qEl('qw-bonus-badge').textContent = BONUS_FULL[data.bonus.bonusType] || 'BONUS';
    qEl('qw-bonus-badge').className = 'qw-bonus-badge ' + (BONUS_CLASS[data.bonus.bonusType] || '');
    qEl('qw-bonus-progress').textContent = data.bonusIdx + 1 + '/' + data.bonusTotal;
    qEl('qw-bonus-timer').textContent = '';
    qEl('qw-bonus-timer').classList.remove('danger');
    showBonusStep('prompt');
    const startBtn = qEl('qw-bonus-start-btn');
    const spectate = qEl('qw-bonus-spectate');
    if (mine) {
      qEl('qw-bonus-prompt-text').textContent =
        'Answer a question to unlock this ' +
        (BONUS_FULL[data.bonus.bonusType] || 'bonus') +
        ' square.';
      startBtn.style.display = '';
      startBtn.disabled = false;
      spectate.style.display = 'none';
    } else {
      qEl('qw-bonus-prompt-text').textContent = 'Opponent is on a bonus square…';
      startBtn.style.display = 'none';
      spectate.style.display = '';
    }
    openBonusModal();
  });

  socket.on('qlashword:bonus_question', (data) => {
    if (!qwCode) {
      return;
    }
    const mine = data.activePlayerIdx === qwMyIdx;
    qwPhase = 'bonus_q';
    renderTurnState();
    showBonusStep('question');
    qEl('qw-bonus-badge').textContent = BONUS_FULL[data.bonus.bonusType] || 'BONUS';
    qEl('qw-bonus-badge').className = 'qw-bonus-badge ' + (BONUS_CLASS[data.bonus.bonusType] || '');
    qEl('qw-bonus-progress').textContent = data.bonusIdx + 1 + '/' + data.bonusTotal;
    qEl('qw-flash').classList.remove('show');
    renderQuestion(
      {
        questionEl: qEl('qw-question'),
        optionsEl: qEl('qw-options'),
        flashEl: qEl('qw-flash'),
      },
      data.question,
      data.bonusIdx,
      mine ? submitBonusAnswer : () => {},
    );
    const spectate = qEl('qw-bonus-spectate');
    if (!mine) {
      document.querySelectorAll('#qw-options .qlas-opt').forEach((b) => (b.disabled = true));
      spectate.style.display = '';
    } else {
      spectate.style.display = 'none';
    }
    openBonusModal();
    startBonusTimer(data.timerSeconds || 15);
  });

  socket.on('qlashword:bonus_result', ({ bonus, correct, answerIdx }) => {
    if (!qwCode) {
      return;
    }
    stopBonusTimer();
    // Color only the picked option (never reveal the correct answer); answerIdx -1 = timed out.
    const opts = document.querySelectorAll('#qw-options .qlas-opt');
    opts.forEach((b) => (b.disabled = true));
    if (typeof answerIdx === 'number' && answerIdx >= 0 && opts[answerIdx]) {
      opts[answerIdx].classList.add(correct ? 'correct' : 'wrong');
    }
    const flash = qEl('qw-flash');
    if (flash) {
      flash.textContent =
        '> ' + (correct ? 'UNLOCKED ' : 'MISSED ') + (BONUS_LABEL[bonus.bonusType] || '');
      flash.className = 'qlas-flash show ' + (correct ? 'hit' : 'miss');
    }
  });

  socket.on('qlashword:turn_result', ({ playerIdx, turn, breakdown, scores }) => {
    if (!qwCode) {
      return;
    }
    qwScores = scores;
    closeBonusModal();
    renderScores();
    const total = breakdown?.total ?? 0;
    const words = (breakdown?.words || []).map((w) => w.word).join(', ');
    let text = qwPlayerName(playerIdx) + ' scored ' + total + (total === 1 ? ' point' : ' points');
    if (words) {
      text += ' — ' + words;
    }
    if (breakdown?.bingo) {
      text += ' (BINGO +50)';
    }
    pushHistory(turn, text);
  });

  socket.on('qlashword:passed', ({ playerIdx, turn, reason }) => {
    if (!qwCode) {
      return;
    }
    pushHistory(
      turn,
      qwPlayerName(playerIdx) + (reason === 'timeout' ? ' ran out of time' : ' passed'),
    );
  });

  socket.on('qlashword:swapped', ({ playerIdx, turn, count }) => {
    if (!qwCode) {
      return;
    }
    pushHistory(
      turn,
      qwPlayerName(playerIdx) + ' swapped ' + count + (count === 1 ? ' tile' : ' tiles'),
    );
  });

  socket.on('qlashword:game_over', ({ winnerIdx, reason, scores }) => {
    if (!qwCode) {
      return;
    }
    qwScores = scores || qwScores;
    qwPhase = 'game_over';
    stopBonusTimer();
    stopTurnClock();
    closeBonusModal();
    qwShowPhase('gameover');
    const winText = qEl('qw-winner-text');
    if (winnerIdx === -1) {
      winText.textContent = "IT'S A TIE";
    } else if (winnerIdx === qwMyIdx) {
      winText.textContent = '🏆 YOU WIN!';
    } else {
      winText.textContent = (qwPlayers[winnerIdx]?.name || 'Opponent') + ' WINS';
    }
    const reasonMap = { normal: 'Game complete', disconnect: 'Opponent disconnected' };
    qEl('qw-go-reason').textContent = reasonMap[reason] || reason || '';
    qEl('qw-go-p0name').textContent = qwPlayers[0]?.name || 'Player 1';
    qEl('qw-go-p1name').textContent = qwPlayers[1]?.name || 'Player 2';
    qEl('qw-go-p0score').textContent = qwScores[0];
    qEl('qw-go-p1score').textContent = qwScores[1];
  });
}

// Apply a server public-state payload into module state.
function applyState(state) {
  if (!state) {
    return;
  }
  if (state.board) {
    qwBoard = state.board;
  }
  if (state.scores) {
    qwScores = state.scores;
  }
  if (typeof state.currentPlayerIdx === 'number') {
    qwCurrentIdx = state.currentPlayerIdx;
  }
  if (state.phase) {
    qwPhase = state.phase;
  }
  if (typeof state.bagCount === 'number') {
    qwBagCount = state.bagCount;
  }
}

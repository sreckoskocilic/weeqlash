// ============================================================
// RENDER
// ============================================================

import { el } from './dom.js';
import { sanitize } from './dom.js';
import { PHASE, CAT_NAMES, COORD_BASE } from './constants.js';
import { state as S } from './state.js';

export const tileEls = S.tileEls;
export const movedPegs = S.movedPegs;

// Board initialization
export function initBoard(state) {
  const boardEl = el('board');
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${state.boardSize}, 1fr)`;
  const ts = `calc(var(--bs) / ${state.boardSize})`;
  boardEl.style.setProperty('--ts', ts);
  tileEls.length = 0;

  for (let r = 0; r < state.boardSize; r++) {
    tileEls[r] = [];
    for (let c = 0; c < state.boardSize; c++) {
      const tile = document.createElement('div');
      tile.dataset.r = r;
      tile.dataset.c = c;
      boardEl.appendChild(tile);
      tileEls[r][c] = tile;
    }
  }

  // Board-level click delegation
  boardEl.addEventListener(
    'click',
    (e) => {
      // Check for peg first
      const pegEl = e.target.closest('.peg');
      if (pegEl) {
        const pegId = pegEl.dataset.pegId;
        const gameState = S.gameState;
        const phase = S.localPhase ?? gameState?.phase;
        const coord =
          gameState?.board?.[+pegEl.parentElement.dataset.r]?.[+pegEl.parentElement.dataset.c]
            ?.pegId === pegId
            ? +pegEl.parentElement.dataset.r * COORD_BASE + +pegEl.parentElement.dataset.c
            : null;

        // In SELECT_TILE phase, if clicking on enemy peg that's a valid move, treat as tile click
        if (phase === PHASE.SELECT_TILE && coord !== null && S.validMovesSet.has(coord)) {
          import('./game.js').then(({ onTileClick }) => {
            onTileClick(+pegEl.parentElement.dataset.r, +pegEl.parentElement.dataset.c);
          });
          return;
        }

        import('./game.js').then(({ onPegClick }) => onPegClick(pegId));
        return;
      }

      // Find tile from target or ancestors
      let target = e.target;
      while (target && target !== boardEl) {
        const r = target.dataset?.r;
        const c = target.dataset?.c;
        if (r !== undefined && c !== undefined) {
          import('./game.js').then(({ onTileClick }) => {
            onTileClick(+r, +c);
          });
          return;
        }
        target = target.parentElement;
      }
    },
    true,
  );
}

// Full board render
export function renderAll(state) {
  for (let r = 0; r < state.boardSize; r++) {
    for (let c = 0; c < state.boardSize; c++) {
      updateTile(r, c, state);
    }
  }
  updateTurnUI(state);
  movedPegs.clear();
}

// Diff-based tile update
export function renderChangedTiles(oldState, newState, events) {
  const changedTiles = new Set();

  // Track peg movements
  for (const [pegId, newPeg] of Object.entries(newState.pegs)) {
    const oldPeg = oldState.pegs[pegId];
    if (!oldPeg) {
      changedTiles.add(`${newPeg.row},${newPeg.col}`);
      continue;
    }
    if (oldPeg.row !== newPeg.row || oldPeg.col !== newPeg.col) {
      changedTiles.add(`${oldPeg.row},${oldPeg.col}`);
      changedTiles.add(`${newPeg.row},${newPeg.col}`);
    }
    if (oldPeg.hp !== newPeg.hp) {
      changedTiles.add(`${newPeg.row},${newPeg.col}`);
    }
  }

  // Check for eliminated pegs
  for (const pegId of Object.keys(oldState.pegs)) {
    if (!newState.pegs[pegId]) {
      const oldPeg = oldState.pegs[pegId];
      changedTiles.add(`${oldPeg.row},${oldPeg.col}`);
    }
  }

  // Phase changes affect all tiles
  if (
    oldState.phase !== newState.phase ||
    oldState.currentPlayerIdx !== newState.currentPlayerIdx ||
    oldState.selectedPegId !== newState.selectedPegId
  ) {
    renderAll(newState);
    return;
  }

  // Flag capture changes
  if (events?.some((e) => e.type === 'flag_captured')) {
    for (let r = 0; r < newState.boardSize; r++) {
      for (let c = 0; c < newState.boardSize; c++) {
        const oldTile = oldState.board[r][c];
        const newTile = newState.board[r][c];
        if (oldTile.cornerOwner !== newTile.cornerOwner) {
          changedTiles.add(`${r},${c}`);
        }
      }
    }
  }

  // Render only changed tiles
  for (const key of changedTiles) {
    const [r, c] = key.split(',').map(Number);
    if (r >= 0 && r < newState.boardSize && c >= 0 && c < newState.boardSize) {
      updateTile(r, c, newState);
    }
  }

  updateTurnUI(newState);
  movedPegs.clear();
}

export { renderChangedTiles as diffRender };

// Single tile update
export function updateTile(r, c, state) {
  const tile = state.board[r][c];
  const tileEl = tileEls[r][c];
  if (!tileEl) {
    return;
  }

  // Base class
  tileEl.className = tile.category === 'flag' ? 'tile flag-tile' : `tile cat-${tile.category}`;
  tileEl.innerHTML = '';

  // Highlight states
  const isMyTurn = state.currentPlayerIdx === S.myPlayerIndex;
  const phase = S.localPhase ?? state.phase;
  const coord = r * COORD_BASE + c;
  const isValidMove = S.validMovesSet.has(coord);
  const isSelectedPeg = tile.pegId && tile.pegId === S.localSelectedPegId;

  if (phase === PHASE.SELECT_PEG && isMyTurn) {
    const myPlayer = state.players[S.myPlayerIndex];
    if (tile.pegId && myPlayer?.pegIds.includes(tile.pegId)) {
      tileEl.classList.add('clickable');
    }
  } else if (phase === PHASE.SELECT_TILE && isMyTurn) {
    if (isValidMove) {
      tileEl.classList.add('valid-move', 'clickable');
    } else if (!isSelectedPeg) {
      tileEl.classList.add('dimmed');
    }
  }
  if (isSelectedPeg) {
    tileEl.classList.add('selected-peg-tile');
  }
  if (
    S.navCursor.row === r &&
    S.navCursor.col === c &&
    isMyTurn &&
    (phase === PHASE.SELECT_PEG || phase === PHASE.SELECT_TILE)
  ) {
    tileEl.classList.add('nav-highlight');
  }

  // Tile content
  if (tile.category === 'flag' && tile.cornerOwner !== null) {
    const owner = state.players[tile.cornerOwner];
    if (owner) {
      tileEl.style.borderColor = owner.color;
      const flagEl = document.createElement('div');
      flagEl.className = 'flag-icon';
      flagEl.textContent = '⚑';
      flagEl.style.color = owner.color;
      tileEl.appendChild(flagEl);
      const nameEl = document.createElement('div');
      nameEl.className = 'flag-owner';
      nameEl.style.color = owner.color;
      nameEl.textContent = owner.name;
      tileEl.appendChild(nameEl);
    }
  } else {
    const label = document.createElement('div');
    label.className = 'tile-cat-label';
    label.textContent = CAT_NAMES[tile.category] ?? tile.category;
    tileEl.appendChild(label);
  }

  // Peg
  if (tile.pegId) {
    const peg = state.pegs[tile.pegId];
    if (!peg) {
      return;
    }
    const player = state.players[peg.playerId];
    const pegEl = document.createElement('div');
    pegEl.className = 'peg';
    pegEl.dataset.pegId = tile.pegId;
    if (tile.pegId === S.localSelectedPegId) {
      pegEl.classList.add('selected');
    }
    if (movedPegs.has(tile.pegId)) {
      pegEl.classList.add('just-moved');
    }
    if (state.currentPlayerIdx === S.myPlayerIndex) {
      pegEl.classList.add('can-move');
    }
    pegEl.style.background = player.color;
    const pegLetterIdx = player?.pegIds?.indexOf(tile.pegId) ?? -1;
    const letterEl = document.createElement('span');
    letterEl.textContent = pegLetterIdx >= 0 ? String.fromCharCode(65 + pegLetterIdx) : '';
    pegEl.appendChild(letterEl);
    pegEl.title = `${sanitize(player.name)} — HP: ${peg.hp}`;
    const hpEl = document.createElement('span');
    hpEl.className = 'peg-hp';
    const heartEl = document.createElement('span');
    heartEl.className = 'peg-hp-heart';
    heartEl.textContent = '♥';
    const countEl = document.createElement('span');
    countEl.className = 'peg-hp-count';
    countEl.textContent = peg.hp;
    hpEl.appendChild(heartEl);
    hpEl.appendChild(countEl);
    pegEl.appendChild(hpEl);
    tileEl.appendChild(pegEl);
  }
}

// Turn UI update
export function updateTurnUI(state) {
  const cp = state.players[state.currentPlayerIdx];
  el('turn-player-box').style.borderColor = cp?.color ?? '#444';
  el('turn-player-name').textContent = cp?.name ?? '—';
  el('turn-player-name').style.color = cp?.color ?? '';

  const mr = state.movesRemaining;
  const movesText = mr === 1 ? '1 move' : `${mr} moves`;
  el('turn-moves').textContent = movesText;

  el('turn-number').textContent = `TURN ${state.turnNumber ?? 1}`;

  el('player-stats').innerHTML = state.players
    .map((p) => {
      const stats = p.stats?.byCategory ?? {};
      let attempts = 0;
      let correct = 0;
      for (const cat of Object.values(stats)) {
        attempts += cat.attempts ?? 0;
        correct += cat.correct ?? 0;
      }
      const pct = attempts > 0 ? ((correct / attempts) * 100).toFixed(0) + '%' : '—';
      return `<span class="player-stat-item" style="color:${p.color}">
        <span class="player-stat-ratio">${correct}/${attempts}</span>
        <span class="player-stat-pct">${pct}</span>
      </span>`;
    })
    .join('');
}

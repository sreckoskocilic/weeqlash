// ============================================================
// QUIZ MODE (Triviandom / EPL 2025)
// ============================================================

import { el } from './dom.js';
import { showError } from './dom.js';
import { sanitize } from './dom.js';
import { CAT_NAMES, CAT_COLORS, OPTION_KEYS } from './constants.js';

let currentQuizMode = 'triviandom';
let quizModalOptionBtns = [];

const quizState = {
  run: null,
  timerInterval: null,
  gameTimerInterval: null,
};

let gameTimerStart = 0;
export function startGameTimer() {
  gameTimerStart = Date.now();
  const timerEl = document.getElementById('modal-game-timer');
  timerEl.style.display = '';
  clearInterval(quizState.gameTimerInterval);
  quizState.gameTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - gameTimerStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 500);
}

export function stopGameTimer() {
  clearInterval(quizState.gameTimerInterval);
  quizState.gameTimerInterval = null;
}

// Start quiz mode
export function startQuizMode(mode) {
  currentQuizMode = mode;
  document.getElementById('screen-lobby').style.display = 'none';
  document.getElementById('screen-game').style.display = 'none';
  clearInterval(quizState.timerInterval);
  clearInterval(quizState.gameTimerInterval);
  quizState.timerInterval = null;
  quizState.gameTimerInterval = null;

  import('./socket.js').then(({ getSocket }) => {
    const socket = getSocket();
    socket.emit('quiz:start', { mode }, (res) => {
      if (res.error) {
        showError('Quiz error: ' + res.error);
        return;
      }
      quizState.run = { answers: 0, startedAt: Date.now() };
      startGameTimer();
      showQuizQuestion(res);
    });
  });
}

// Show quiz question
export function showQuizQuestion(q) {
  document.getElementById('modal-overlay').classList.add('visible');
  document.getElementById('modal-cat-badge').textContent = q.category
    ? CAT_NAMES[q.category] || q.category
    : 'QUESTION';
  document.getElementById('modal-cat-badge').style.background = q.category
    ? CAT_COLORS[q.category] || '#0f3460'
    : '#0f3460';
  const streak = quizState.run.answers;
  document.getElementById('modal-player-label').textContent = streak > 0 ? `Streak ${streak}` : '';
  document.getElementById('modal-combat-label').style.display = 'none';
  document.getElementById('modal-question').textContent = q.q;

  const optContainer = document.getElementById('modal-options');
  optContainer.innerHTML = '';
  optContainer.dataset.submitting = '';
  quizModalOptionBtns = [];
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'modal-option';
    btn.innerHTML = `<span class="option-key">${OPTION_KEYS[i]}</span>${sanitize(opt)}`;
    btn.onclick = () => submitQuizAnswer(i);
    optContainer.appendChild(btn);
    quizModalOptionBtns.push(btn);
  });

  document.getElementById('modal-continue-wrap').style.display = 'none';
  document.getElementById('modal-continue-btn').textContent = 'CONTINUE';
  startQuizTimer();
}

// Submit quiz answer
export function submitQuizAnswer(answerIdx) {
  if (document.getElementById('modal-options')?.dataset?.submitting === 'true') {
    return;
  }
  document.getElementById('modal-options').dataset.submitting = 'true';
  clearInterval(quizState.timerInterval);

  import('./socket.js').then(({ getSocket }) => {
    const socket = getSocket();
    socket.emit('quiz:answer', { answerIdx }, (res) => {
      if (res.error) {
        return;
      }

      // Highlight chosen answer
      quizModalOptionBtns.forEach((btn, i) => {
        btn.disabled = true;
        if (i === answerIdx) {
          btn.classList.add(res.correct ? 'answer-correct' : 'answer-wrong');
        }
      });

      if (res.correct) {
        document.getElementById('modal-continue-wrap').style.display = 'flex';
        document.getElementById('modal-continue-btn').textContent = 'NEXT QUESTION';
        document.getElementById('modal-continue-btn').onclick = () => {
          socket.emit('quiz:next', (nextQ) => {
            if (nextQ.ok) {
              showQuizQuestion(nextQ);
            }
          });
        };
      } else {
        stopGameTimer();
        document.getElementById('modal-continue-btn').textContent = 'SEE RESULTS';
        document.getElementById('modal-continue-btn').onclick = () => {
          document.getElementById('modal-overlay').classList.remove('visible');
          setTimeout(() => showLeaderboard(res), 300);
        };
        document.getElementById('modal-continue-wrap').style.display = 'flex';
      }
    });
  });
}

// Quiz timer
function startQuizTimer() {
  let secs = 10;
  document.getElementById('timer-text').textContent = `${secs}s`;
  const timerFill = document.getElementById('timer-fill');

  quizState.timerInterval = setInterval(() => {
    secs--;
    document.getElementById('timer-text').textContent = `${secs}s`;
    const percent = (secs / 10) * 100;
    timerFill.style.width = percent + '%';

    if (secs === 0) {
      clearInterval(quizState.timerInterval);
      stopGameTimer();
      document.getElementById('modal-options').dataset.submitting = 'true';
      quizModalOptionBtns.forEach((btn) => (btn.disabled = true));

      import('./socket.js').then(({ getSocket }) => {
        const socket = getSocket();
        socket.emit('quiz:answer', { answerIdx: -1 }, (res) => {
          document.getElementById('modal-continue-btn').textContent = 'SEE RESULTS';
          document.getElementById('modal-continue-btn').onclick = () => {
            document.getElementById('modal-overlay').classList.remove('visible');
            setTimeout(() => showLeaderboard(res), 300);
          };
          document.getElementById('modal-continue-wrap').style.display = 'flex';
        });
      });
    }
  }, 1000);
}

// Show leaderboard
export function showLeaderboard(result) {
  document.getElementById('screen-leaderboard').classList.add('show');

  import('./socket.js').then(({ getSocket }) => {
    const socket = getSocket();
    socket.emit('quiz:leaderboard', { mode: currentQuizMode }, (res) => {
      const container = document.getElementById('lb-rows');
      container.innerHTML = '';

      res.top10.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row';
        row.innerHTML = `
          <div class="lb-rk">${String(i + 1).padStart(2, '0')}</div>
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${sanitize(entry.name)}</div>
          <div style="text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;">${entry.answers}</div>
          <div style="text-align: right; font-size: 0.75rem; color: #445; font-variant-numeric: tabular-nums;">${Math.round(entry.time_ms / 1000)}s</div>
        `;
        container.appendChild(row);
      });

      if (result.qualifies) {
        const newRow = document.createElement('div');
        newRow.className = 'lb-row new';
        newRow.innerHTML = `
          <div class="lb-rk">${String(result.answers < res.top10.length ? result.answers + 1 : 10).padStart(2, '0')}</div>
          <div class="lb-inp-wrap">
            <input id="lb-name-input" placeholder="your name" maxlength="16" autofocus/>
            <button id="lb-submit-score-btn">OK</button>
          </div>
          <div style="text-align: right; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums;">${result.answers}</div>
          <div style="text-align: right; font-size: 0.75rem; color: #445; font-variant-numeric: tabular-nums;">${Math.round(result.timeSec)}s</div>
        `;
        const insertPos = res.top10.filter(
          (e) =>
            e.answers > result.answers ||
            (e.answers === result.answers && e.time_ms < result.timeSec * 1000),
        ).length;
        container.insertBefore(newRow, container.children[insertPos]);
        newRow.querySelector('#lb-submit-score-btn').addEventListener('click', submitQuizScore);
      }
    });

    document.getElementById('lb-play-again').onclick = () => {
      document.getElementById('screen-leaderboard').classList.remove('show');
      clearInterval(quizState.timerInterval);
      clearInterval(quizState.gameTimerInterval);
      quizState.timerInterval = null;
      quizState.gameTimerInterval = null;
      socket.emit('quiz:start', { mode: currentQuizMode }, (res) => {
        if (res.ok) {
          quizState.run = { answers: 0, startedAt: Date.now() };
          startGameTimer();
          showQuizQuestion(res);
        }
      });
    };

    document.getElementById('lb-back').onclick = () => {
      document.getElementById('screen-leaderboard').classList.remove('show');
      document.getElementById('screen-connect').style.display = '';
      leaderboardLoaded = false;
      import('./leaderboard.js').then(({ loadMainLeaderboard }) => loadMainLeaderboard());
      quizState.run = null;
      clearInterval(quizState.timerInterval);
      clearInterval(quizState.gameTimerInterval);
      quizState.timerInterval = null;
      quizState.gameTimerInterval = null;
    };
  });
}

function submitQuizScore() {
  const name = document.getElementById('lb-name-input').value.trim();
  if (!name) {
    return;
  }
  import('./socket.js').then(({ getSocket }) => {
    const socket = getSocket();
    socket.emit('quiz:submit_score', { name }, () => {
      showLeaderboard({ qualifies: false });
    });
  });
}

// Leaderboard loading
let leaderboardLoaded = false;
export function loadMainLeaderboard() {
  if (leaderboardLoaded) {
    return;
  }
  leaderboardLoaded = true;
  import('./leaderboard.js').then(({ loadPanelLeaderboard }) => {
    loadPanelLeaderboard('triviandom', 'triv-lb-rows');
  });
}

export { currentQuizMode };

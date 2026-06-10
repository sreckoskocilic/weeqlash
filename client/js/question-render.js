// Shared question-rendering helpers (qlashique + skipnot); callers pass DOM refs so the helpers aren't bound to screen IDs.

import { sanitize } from './dom.js';

// Render the question + 4 option buttons; onClick(i) fires the chosen index, optional flashEl gets its `show` class cleared.
export function renderQuestion(
  { questionEl, optionsEl, flashEl },
  q,
  idx,
  onClick,
  { showCategory = true } = {},
) {
  const catText = showCategory && q && q.category ? sanitize(String(q.category)).toUpperCase() : '';
  questionEl.innerHTML =
    '<div class="qlas-q-meta">' +
    '<span class="qlas-q-tag">&gt; QUESTION ' +
    (idx + 1) +
    '</span>' +
    (catText ? '<span class="qlas-q-cat">' + catText + '</span>' : '') +
    '</div>' +
    '<div class="qlas-q-text">' +
    sanitize(q.q) +
    '</div>';
  optionsEl.innerHTML = '';
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'qlas-opt';
    btn.innerHTML = '<span class="qlas-opt-key">' + 'ABCD'[i] + '</span>' + sanitize(opt);
    btn.onclick = () => onClick(i);
    optionsEl.appendChild(btn);
  });
  if (flashEl) {
    flashEl.classList.remove('show');
  }
}

// 100ms-tick countdown ring controller; `start(totalSec)` is idempotent and owns its interval handle.
export function makeCountdownRing({
  ringEl,
  labelEl,
  progressEl,
  ringCirc,
  ringClass = 'qlas-timer-ring',
}) {
  let interval = null;
  return {
    start(totalSec) {
      let left = totalSec;
      clearInterval(interval);
      interval = setInterval(() => {
        left = Math.max(0, left - 0.1);
        const pct = left / totalSec;
        const state = pct < 0.25 ? ' danger' : pct < 0.5 ? ' warn' : '';
        if (ringEl) {
          ringEl.className = ringClass + state;
        }
        if (labelEl) {
          labelEl.textContent = Math.ceil(left) + 's';
        }
        if (progressEl) {
          progressEl.setAttribute('stroke-dashoffset', String((1 - pct) * ringCirc));
        }
        if (left <= 0) {
          clearInterval(interval);
          interval = null;
        }
      }, 100);
    },
    stop() {
      clearInterval(interval);
      interval = null;
    },
  };
}

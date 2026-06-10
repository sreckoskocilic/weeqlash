// Game theme switcher: data-game-theme on <body>, persisted. Themes amber (default), green, cyan, pink.

const STORAGE_KEY = 'weeqlash.theme';
const KNOWN = new Set(['amber', 'green', 'cyan', 'pink']);

function _getStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return KNOWN.has(v) ? v : 'amber';
  } catch {
    return 'amber';
  }
}

function _setStored(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* persist failure ok */
  }
}

function _applyTheme(theme) {
  if (!KNOWN.has(theme)) {
    theme = 'amber';
  }
  if (theme === 'amber') {
    document.body.removeAttribute('data-game-theme');
  } else {
    document.body.setAttribute('data-game-theme', theme);
  }
  // Sync any visible picker UI (each game screen may have its own picker).
  document.querySelectorAll('.game-theme-picker .skp').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

export function initSkipnotTheme() {
  _applyTheme(_getStored());

  // Wire all pickers via per-picker delegation so dynamically added pickers also work.
  document.querySelectorAll('.game-theme-picker').forEach((picker) => {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.skp');
      if (!btn) {
        return;
      }
      const theme = btn.dataset.theme;
      if (!KNOWN.has(theme)) {
        return;
      }
      _applyTheme(theme);
      _setStored(theme);
    });
  });
}

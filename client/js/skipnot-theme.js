// SkipNoT theme switcher — toggles a data-skipnot-theme attribute on
// #screen-skipnot, persists choice to localStorage. Available themes are
// defined in styles.css under #screen-skipnot[data-skipnot-theme="..."].

const STORAGE_KEY = 'skipnot.theme';
const KNOWN = new Set(['amber', 'green', 'cyan', 'pink']);

function _getStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return KNOWN.has(v) ? v : 'amber';
  } catch (_) {
    return 'amber';
  }
}

function _setStored(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (_) {}
}

export function initSkipnotTheme() {
  const screen = document.getElementById('screen-skipnot');
  const picker = document.querySelector('.skipnot-theme-picker');
  if (!screen || !picker) return;

  const apply = (theme) => {
    if (!KNOWN.has(theme)) theme = 'amber';
    screen.setAttribute('data-skipnot-theme', theme);
    picker.querySelectorAll('.skp').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
  };

  apply(_getStored());

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.skp');
    if (!btn) return;
    const theme = btn.dataset.theme;
    if (!KNOWN.has(theme)) return;
    apply(theme);
    _setStored(theme);
  });
}

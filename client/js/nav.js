// Tiny view router for the connect-screen horizontal nav.
//
// Views are `<div class="view" data-view-name="...">`. Nav items are
// `<button class="nav-item" data-view="...">`. Auth-aware items use
// `data-auth="in" | "out"` and toggle their `hidden` attribute via
// applyAuthState() — no role-conditional CSS.

export function showView(name) {
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.dataset.viewName !== name;
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((n) => {
    n.classList.toggle('active', n.dataset.view === name);
  });
}

export function applyAuthState(loggedIn) {
  document.querySelectorAll('[data-auth]').forEach((el) => {
    el.hidden = loggedIn ? el.dataset.auth === 'out' : el.dataset.auth === 'in';
  });
  // If the active view's nav item is now hidden, fall back to play.
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.hidden) {
    showView('play');
  }
}

export function initNav() {
  const nav = document.getElementById('connect-nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.hidden) return;
    showView(btn.dataset.view);
  });
}

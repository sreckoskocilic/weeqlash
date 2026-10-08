import { el as $ } from './dom.js';
import { showScreen } from './dom.js';
import { state } from './state.js';
import { applyAuthState, showView } from './nav.js';

// Server URL (imported from main)
let serverUrl = '';
let socket = null;

async function postAuth(path, body) {
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { error: 'Network error — try again.' };
  }
}

export function initAuth(svrUrl, sock) {
  serverUrl = svrUrl;
  socket = sock;

  // Server kicks us when the same account logs in elsewhere; clear local state and tell the user why.
  socket.on('auth:kicked', ({ reason }) => {
    hideUserBar();
    const msg =
      reason === 'logged_in_elsewhere'
        ? 'Prijavljeni ste s drugog uređaja. Ova sesija je zatvorena.'
        : 'Sesija je zatvorena.';
    showAuthMessage(msg, true);
    showScreen('screen-connect');
  });
}

export function showAuthMessage(msg, isError) {
  const msgEl = $('auth-message');
  msgEl.textContent = msg;
  msgEl.style.display = 'block';
  msgEl.style.background = isError ? 'rgba(217,57,57,0.2)' : 'rgba(67,160,71,0.2)';
  msgEl.style.color = isError ? '#ff6b6b' : '#66bb6a';
}

export function showUserBar(user) {
  state.currentUser = user;
  $('nav-user').textContent = user.username;
  applyAuthState(true);
  // applyAuthState shows the admin button (data-auth="in"); hide it again for non-admins.
  const isAdmin = user.is_admin === 1 || user.is_admin === true;
  $('btn-admin').hidden = !isAdmin;
}

export function hideUserBar() {
  state.currentUser = null;
  applyAuthState(false);
}

export async function checkAuth() {
  try {
    const res = await fetch(`${serverUrl}/auth/me`, {
      credentials: 'include',
    });
    const data = await res.json();
    if (data.user) {
      // Restore logged-in UI from /auth/me, not the socket ack (ack can be dropped after a server restart).
      showUserBar(data.user);
      socket.emit('auth:setUserId', data.user.id, () => {});
    } else {
      hideUserBar();
    }
  } catch (error) {
    console.warn('[auth] Auth check failed (will retry):', error);
  }
}

// Login handler
export function initLogin() {
  $('btn-login').addEventListener('click', async () => {
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    const keepLoggedIn = $('keep-logged-in').checked;
    if (!username || !password) {
      return showAuthMessage('Fill in all fields', true);
    }

    const data = await postAuth('/auth/login', { username, password, keepLoggedIn });
    if (data.error) {
      return showAuthMessage(data.error, true);
    }
    if (data.reconnectSocket) {
      socket.disconnect();
      socket.connect();
    }
    socket.emit('auth:setUserId', data.user.id, () => {
      showUserBar(data.user);
    });
  });

  $('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.currentTarget.value) {
      $('btn-login').click();
    }
  });
}

// Register handler
export function initRegister() {
  $('btn-register').addEventListener('click', async () => {
    const username = $('reg-username').value.trim();
    const email = $('reg-email').value.trim();
    const password = $('reg-password').value;
    if (!username || !email || !password) {
      return showAuthMessage('Fill in all fields', true);
    }

    const data = await postAuth('/auth/register', { username, email, password });
    if (data.error) {
      return showAuthMessage(data.error, true);
    }
    showAuthMessage(data.message || 'Check your email to confirm', false);
  });
}

// Forgot password handlers
export function initForgotPassword() {
  $('link-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    $('auth-login-form').style.display = 'none';
    $('auth-forgot-form').style.display = '';
    $('auth-message').style.display = 'none';
  });

  $('link-back-login').addEventListener('click', (e) => {
    e.preventDefault();
    $('auth-forgot-form').style.display = 'none';
    $('auth-login-form').style.display = '';
    $('auth-message').style.display = 'none';
  });

  $('btn-forgot').addEventListener('click', async () => {
    const email = $('forgot-email').value.trim();
    if (!email) {
      return showAuthMessage('Enter your email', true);
    }

    const data = await postAuth('/auth/forgot-password', { email });
    if (data.error) {
      return showAuthMessage(data.error, true);
    }
    showAuthMessage(data.message || 'If that email exists, a reset link has been sent', false);
  });
}

// Reset password handler
let resetToken = null;

export function initResetPassword() {
  $('btn-reset').addEventListener('click', async () => {
    const password = $('reset-password').value;
    if (!password || password.length < 8) {
      return showAuthMessage('Password must be at least 8 characters', true);
    }

    const data = await postAuth('/auth/reset-password', { token: resetToken, password });
    if (data.error) {
      return showAuthMessage(data.error, true);
    }
    showAuthMessage('Password reset! You can now log in.', false);
    $('auth-reset-form').style.display = 'none';
    $('auth-login-form').style.display = '';
  });
}

// Logout handler
export function initLogout() {
  $('btn-logout').addEventListener('click', async () => {
    await fetch(`${serverUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    hideUserBar();
  });
}

// Admin panel handler
export function initAdmin() {
  $('btn-admin').addEventListener('click', () => {
    window.open(`${serverUrl}/admin/users`, '_blank');
  });
}

// View Stats handler
export function initViewStats() {
  $('btn-view-stats').addEventListener('click', async () => {
    if (!state.currentUser) {
      showAuthMessage('Please log in to view stats', true);
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/auth/stats/${state.currentUser.id}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `HTTP ${res.status}: ${res.statusText}`;
        showAuthMessage(`Server error: ${errorMsg}`, true);
        return;
      }

      const data = await res.json();
      if (data.error) {
        return showAuthMessage(data.error, true);
      }
      // Import dynamically to avoid circular dependency
      const { showStatsModal } = await import('./stats.js');
      showStatsModal(data);
      renderAccountDeletion();
    } catch {
      showAuthMessage('Network error: Unable to reach server', true);
    }
  });
}

// Account deletion, shown under the stats in the Stats modal. The request waits for admin approval.
async function renderAccountDeletion() {
  const box = $('stats-account');
  if (!box) {
    return;
  }
  let pending;
  try {
    const res = await fetch(`${serverUrl}/auth/me`, { credentials: 'include' });
    pending = !!(await res.json()).user?.deletion_requested;
  } catch {
    return;
  }

  if (pending) {
    box.innerHTML = `
      <p class="stats-account-note">Deletion requested. An admin will remove your account and all its data.</p>
      <button type="button" class="stats-account-link" data-act="cancel">Cancel request</button>`;
  } else {
    box.innerHTML = `
      <button type="button" class="stats-account-link" data-act="open">Delete my account…</button>
      <form class="stats-account-form" hidden>
        <p class="stats-account-note">Your account, stats and game history will be permanently deleted once an admin approves.</p>
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
        <button type="submit" class="stats-account-danger">Request deletion</button>
        <p class="stats-account-error" hidden></p>
      </form>`;
  }

  box.querySelector('[data-act="open"]')?.addEventListener('click', (e) => {
    e.currentTarget.hidden = true;
    const form = box.querySelector('form');
    form.hidden = false;
    form.elements.password.focus();
  });
  box.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => {
    await postAuth('/auth/delete-request/cancel', {});
    renderAccountDeletion();
  });
  box.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = await postAuth('/auth/delete-request', {
      password: e.target.elements.password.value,
    });
    if (data.error) {
      const err = box.querySelector('.stats-account-error');
      err.textContent = data.error;
      err.hidden = false;
      return;
    }
    renderAccountDeletion();
  });
}

// Handle URL params (email confirmation, password reset)
export function handleUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.get('confirm')) {
    fetch(`${serverUrl}/auth/confirm/${urlParams.get('confirm')}`)
      .then((r) => r.json())
      .then((data) => {
        showAuthMessage(
          data.message || (data.error ? data.error : 'Email confirmed!'),
          !!data.error,
        );
      });
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (urlParams.get('reset')) {
    resetToken = urlParams.get('reset');
    $('auth-login-form').style.display = 'none';
    $('auth-reset-form').style.display = '';
    showView('login');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// Initialize all auth handlers
export function initAuthHandlers() {
  // initAuthTabs() — removed, auth-tabs replaced by horizontal nav (nav.js)
  initLogin();
  initRegister();
  initForgotPassword();
  initResetPassword();
  initLogout();
  initAdmin();
  initViewStats();
  handleUrlParams();
  checkAuth();
}

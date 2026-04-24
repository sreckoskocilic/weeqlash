// ============================================================
// AUTHENTICATION
// ============================================================

import { el, $ } from './dom.js';
import { showError } from './dom.js';
import { showScreen } from './dom.js';
import { _currentUser, setCurrentUser } from './state.js';

// Server URL (imported from main)
let serverUrl = '';
let socket = null;

export function initAuth(svrUrl, sock) {
  serverUrl = svrUrl;
  socket = sock;
}

export function showAuthMessage(msg, isError) {
  const msgEl = $('auth-message');
  msgEl.textContent = msg;
  msgEl.style.display = 'block';
  msgEl.style.background = isError ? 'rgba(217,57,57,0.2)' : 'rgba(67,160,71,0.2)';
  msgEl.style.color = isError ? '#ff6b6b' : '#66bb6a';
}

export function showUserBar(user) {
  setCurrentUser(user);
  $('user-logged-as').textContent = `logged as ${user.username}`;
  $('user-logged-as').style.display = 'block';
  $('user-bar').style.display = 'flex';
  const isAdmin = user.is_admin === 1 || user.is_admin === true;
  $('btn-admin').style.display = isAdmin ? 'inline-block' : 'none';
  $('login-section').style.display = 'none';
}

export function hideUserBar() {
  setCurrentUser(null);
  $('user-logged-as').style.display = 'none';
  $('user-bar').style.display = 'none';
  $('login-section').style.display = '';
}

export async function checkAuth() {
  try {
    const res = await fetch(`${serverUrl}/auth/me`, {
      credentials: 'include',
    });
    const data = await res.json();
    if (data.user) {
      showUserBar(data.user);
    } else {
      hideUserBar();
    }
  } catch (error) {
    console.warn('[auth] Auth check failed (will retry):', error);
  }
}

// Auth tab switching
export function initAuthTabs() {
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = 'var(--muted)';
        t.style.borderColor = 'var(--bg3)';
      });
      tab.classList.add('active');
      tab.style.background = 'var(--bg3)';
      tab.style.color = 'var(--text)';
      const which = tab.dataset.tab;
      $('auth-login-form').style.display = which === 'login' ? '' : 'none';
      $('auth-register-form').style.display = which === 'register' ? '' : 'none';
      $('auth-forgot-form').style.display = 'none';
      $('auth-reset-form').style.display = 'none';
      $('auth-message').style.display = 'none';
    });
  });
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

    const res = await fetch(`${serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, keepLoggedIn }),
    });
    const data = await res.json();
    if (data.error) {
      return showAuthMessage(data.error, true);
    }
    showUserBar(data.user);
    setCurrentUser(data.user);
    // Send userId directly to socket
    socket.emit('auth:setUserId', data.user.id);
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

    const res = await fetch(`${serverUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
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

    const res = await fetch(`${serverUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    showAuthMessage(data.message || 'If that email exists, a reset link has been sent', false);
  });
}

// Reset password handler
let resetToken = null;

export function setResetToken(token) {
  resetToken = token;
}

export function initResetPassword() {
  $('btn-reset').addEventListener('click', async () => {
    const password = $('reset-password').value;
    if (!password || password.length < 8) {
      return showAuthMessage('Password must be at least 8 characters', true);
    }

    const res = await fetch(`${serverUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password }),
    });
    const data = await res.json();
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
    if (!_currentUser) {
      showAuthMessage('Please log in to view stats', true);
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/auth/stats/${_currentUser.id}`, {
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
    } catch {
      showAuthMessage('Network error: Unable to reach server', true);
    }
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
    $('auth-register-form').style.display = 'none';
    $('auth-reset-form').style.display = '';
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// Initialize all auth handlers
export function initAuthHandlers() {
  initAuthTabs();
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

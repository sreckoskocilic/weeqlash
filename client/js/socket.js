import { showError } from './dom.js';
import { soloRunLive, showRunEnded } from './home.js';

let socket = null;

export function initSocket(_svrUrl, sock) {
  socket = sock;
}

export function getSocket() {
  return socket;
}

export function initSocketEvents() {
  // Socket.IO error handling
  socket.io.on('error', (err) => {
    console.error('Socket.IO error:', err);
    showError('Connection error. Please refresh the page.');
  });

  socket.on('disconnect', () => {
    if (soloRunLive()) {
      showRunEnded('Connection lost. This run has ended.');
    }
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    console.warn(`Reconnecting... attempt ${attempt}`);
  });

  socket.io.on('reconnect', () => {
    console.warn('Reconnected');
    showError('');
    // Re-check authentication status after reconnect
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  });

  // Periodically re-check authentication status (every 2 minutes; hidden tabs skip it)
  setInterval(() => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  }, 120000);

  return socket;
}

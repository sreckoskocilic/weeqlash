// ============================================================
// SOCKET
// ============================================================

import { showError } from './dom.js';
import { renderAll } from './render.js';
import { state } from './state.js';

let socket = null;
let serverUrl = '';

export function initSocket(svrUrl, sock) {
  serverUrl = svrUrl;
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

  socket.io.on('reconnect_attempt', (attempt) => {
    console.warn(`Reconnecting... attempt ${attempt}`);
  });

  socket.io.on('reconnect', () => {
    console.warn('Reconnected');
    showError('');
    if (state.qlasToken && state.qlasCode) {
      socket.emit('session:resume', { token: state.qlasToken, code: state.qlasCode }, (res) => {
        if (res.error || res.mode !== 'qlashique') {
          console.warn('Qlashique session resume failed:', res.error);
          return;
        }
        // Import dynamically to avoid circular dependency
        import('./qlashique.js').then(({ qlasRestoreFromReconnect }) => {
          qlasRestoreFromReconnect(res);
        });
      });
    } else if (state.myToken && state.myRoom?.code) {
      socket.emit('session:resume', { token: state.myToken, code: state.myRoom.code }, (res) => {
        if (res.error) {
          console.warn('Session resume failed:', res.error);
          return;
        }
        if (res.state) {
          state.spectateGen++;
          state.pendingQuestions = [];
          state.pendingAnswers = [];
          state.gameState = res.state;
          renderAll(res.state);
        }
      });
    }
    // Re-check authentication status after reconnect
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  });

  // Periodically re-check authentication status (every 2 minutes)
  setInterval(() => {
    import('./auth.js').then(({ checkAuth }) => checkAuth());
  }, 120000);

  return socket;
}

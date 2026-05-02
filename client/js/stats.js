// ============================================================
// STATS MODULE
// ============================================================

import { showAuthMessage } from './auth.js';
import { CAT_NAMES } from './constants.js';
import { getSocket } from './socket.js';
import { sanitize } from './dom.js';
import { state } from './state.js';

export function showStatsModal(statsData) {
  showAuthMessage('Loading stats...', false);

  let modalOverlay = document.getElementById('stats-modal-overlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'stats-modal-overlay';
    modalOverlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 5000;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity 0.3s;
    `;
    modalOverlay.innerHTML = `
      <div id="stats-modal" style="
        background: linear-gradient(145deg, #1e1e24 0%, #25252d 100%);
        border: 1px solid #3a3a45;
        border-radius: 16px;
        padding: 32px; max-width: 520px; width: 92%;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 25px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1);
        z-index: 5001;
        font-family: 'Montserrat', 'Segoe UI', sans-serif;
      ">
        <div style="text-align: center; margin-bottom: 28px;">
          <h2 style="margin: 0 0 8px 0; color: #fff; font-size: 1.6rem; font-weight: 600; letter-spacing: 0.5px;">
            Your Statistics
          </h2>
          <div id="stats-modal-player-label" style="color: #888; font-size: 0.9rem;">
            Player: ${sanitize(state.currentUser?.username || 'Guest')}
          </div>
        </div>

        <div id="stats-modal-content" style="margin-bottom: 24px;">
        </div>

        <div style="text-align: center;">
          <button id="stats-modal-close" style="
            width: auto; padding: 14px 36px; background: linear-gradient(135deg, #4a4a5a 0%, #3a3a45 100%);
            border: none; color: #ddd;
            font-size: 0.9rem; font-weight: 500;
            cursor: pointer; border-radius: 8px;
            transition: transform 0.15s, box-shadow 0.15s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          ">Close</button>
        </div>
      </div>
    `;

    modalOverlay.querySelector('#stats-modal-close').addEventListener('click', () => {
      modalOverlay.classList.remove('visible');
      setTimeout(() => {
        if (modalOverlay.parentElement) {
          modalOverlay.parentElement.removeChild(modalOverlay);
        }
      }, 300);
    });

    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.classList.remove('visible');
      }
    });

    document.body.appendChild(modalOverlay);
  }

  const _contentEl = modalOverlay.querySelector('#stats-modal-content');

  const totalAnswered = statsData.categories.reduce((sum, cat) => sum + cat.answered, 0);
  const totalCorrect = statsData.categories.reduce((sum, cat) => sum + cat.correct, 0);
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  let accuracyColor = '#ef4444';
  if (accuracy >= 80) accuracyColor = '#22c55e';
  else if (accuracy >= 60) accuracyColor = '#eab308';
  else if (accuracy >= 40) accuracyColor = '#f97316';

  let _statsHTML = `
    <div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px;">
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 10px; padding: 16px; text-align: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          border: 1px solid #2a2a4a;
        ">
          <div style="font-size: 2.2rem; font-weight: 700; color: #fa5e2e; line-height: 1;">${statsData.gamesWon}</div>
          <div style="font-size: 0.8rem; color: #b9d0f8; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px;">Won</div>
        </div>
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 10px; padding: 16px; text-align: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          border: 1px solid #2a2a4a;
        ">
          <div style="font-size: 2.2rem; font-weight: 700; color: #34dfd0; line-height: 1;">${statsData.gamesPlayed}</div>
          <div style="font-size: 0.8rem; color: #b9d0f8; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px;">Played</div>
        </div>
        <div style="
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 10px; padding: 16px; text-align: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          border: 1px solid #2a2a4a;
        ">
          <div style="font-size: 2rem; font-weight: 700; color: ${accuracyColor}; line-height: 1;">${accuracy}%</div>
          <div style="font-size: 0.95rem; color: #b9d0f8; margin-top: 8px;">${totalCorrect}/${totalAnswered}</div>
        </div>
      </div>

      <div style="
        background: linear-gradient(135deg, #1f1f2e 0%, #252530 100%);
        border-radius: 16px; padding: 20px;
        border: 1px solid #3a3a4a;
      ">
        <h3 style="color: #fff; font-size: 1rem; margin: 0 0 16px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          By Category
        </h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
  `;

  const catColors = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#3b82f6'];
  statsData.categories.forEach((cat, idx) => {
    const rawCat = cat.category ?? '';
    const catName =
      CAT_NAMES[rawCat] ||
      rawCat.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const catAccuracy = cat.answered > 0 ? Math.round((cat.correct / cat.answered) * 100) : 0;
    const barColor = catColors[idx % catColors.length];

    _statsHTML += `
      <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-weight: 600; color: #e5e7eb; font-size: 0.8rem;">${catName}</span>
          <span style="font-size: 0.75rem; color: #9ca3af;">
            <span style="color: ${barColor}; font-weight: 600;">${cat.correct}</span> / ${cat.answered}
            <span style="color: ${barColor}; margin-left: 4px;">(${catAccuracy}%)</span>
          </span>
        </div>
        <div style="background: #1a1a2a; border-radius: 3px; height: 6px; overflow: hidden;">
          <div style="
            width: ${cat.answered > 0 ? (cat.correct / cat.answered) * 100 : 0}%;
            background: linear-gradient(90deg, ${barColor} 0%, ${barColor}dd 100%);
            height: 100%; border-radius: 3px;
            transition: width 0.5s ease;
          "></div>
        </div>
      </div>
    `;
  });

  _statsHTML += `
        </div>
      </div>
    </div>
  `;

  const statsContainer = modalOverlay.querySelector('#stats-modal-content');
  statsContainer.innerHTML = _statsHTML;

  modalOverlay.classList.add('visible');
  modalOverlay.style.opacity = '1';
  modalOverlay.style.pointerEvents = 'auto';
}

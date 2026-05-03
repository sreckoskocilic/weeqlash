// Decorative home-page background — scatters the announcement node-arrow SVG
// at random positions / sizes / rotations behind the connect screen.
// Generated once at init; static after that.

const SHAPE_COUNT = 130;
const SHAPE_SVG = `<svg viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="14" stroke="#00ff41" stroke-width="2.5" />
  <path d="M 4 32 L 18 32" stroke="#00ff41" stroke-width="2.5" />
  <circle cx="4" cy="32" r="2" fill="#00ff41" />
  <path d="M 32 4 L 32 18" stroke="#00ff41" stroke-width="2.5" />
  <circle cx="32" cy="4" r="2" fill="#00ff41" />
  <path d="M 42 42 L 52 52 L 62 52" stroke="#ffe600" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="62" cy="52" r="2.5" fill="#ffe600" />
</svg>`;

function _rand(min, max) {
  return min + Math.random() * (max - min);
}

export function initHomeBg() {
  const host = document.getElementById('home-bg');
  if (!host) {return;}
  host.innerHTML = '';
  for (let i = 0; i < SHAPE_COUNT; i++) {
    const wrap = document.createElement('span');
    wrap.className = 'home-bg-shape';
    // ~60% chance for tiny / small shapes, ~40% for medium-large.
    const tiny = Math.random() < 0.6;
    const size = Math.round(tiny ? _rand(14, 48) : _rand(48, 130));
    wrap.style.width = size + 'px';
    wrap.style.height = Math.round((size * 64) / 72) + 'px';
    wrap.style.left = _rand(-2, 99).toFixed(2) + '%';
    wrap.style.top = _rand(-2, 99).toFixed(2) + '%';
    wrap.style.transform = `rotate(${Math.round(_rand(0, 360))}deg)`;
    wrap.style.opacity = _rand(0.05, 0.20).toFixed(2);
    wrap.innerHTML = SHAPE_SVG;
    host.appendChild(wrap);
  }
}

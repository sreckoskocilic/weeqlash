// Ephemeral canvas plotter for math-quiz graph problems; ships sampled points (never the closed form) so the answer can't be derived client-side.

const COLORS = {
  bg: '#0d1326',
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(255,255,255,0.35)',
  curve: '#4fd1c5',
  mark: '#f6c453',
  shade: 'rgba(79,209,197,0.15)',
  label: 'rgba(255,255,255,0.85)',
};

const PAD = 28; // px gutter for axis labels

// spec: { points:[[x,y]...], xRange:[a,b], yRange:[c,d], shade?:[a,b], markX?:n }
export function drawGraph(canvas, spec) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !spec) {
    return;
  }

  // HiDPI: size the backing store to devicePixelRatio, draw in CSS px.
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;
  const [xa, xb] = spec.xRange;
  const [ya, yb] = spec.yRange;

  // data → pixel mappers
  const px = (x) => PAD + ((x - xa) / (xb - xa)) * (W - 2 * PAD);
  const py = (y) => H - PAD - ((y - ya) / (yb - ya)) * (H - 2 * PAD);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // shaded interval (e.g. area under curve)
  if (spec.shade) {
    const [sa, sb] = spec.shade;
    const region = spec.points.filter((p) => p[0] >= sa && p[0] <= sb);
    if (region.length > 1) {
      ctx.fillStyle = COLORS.shade;
      ctx.beginPath();
      ctx.moveTo(px(region[0][0]), py(0));
      for (const [x, y] of region) {
        ctx.lineTo(px(x), py(y));
      }
      ctx.lineTo(px(region[region.length - 1][0]), py(0));
      ctx.closePath();
      ctx.fill();
    }
  }

  // gridlines on integer ticks
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let gx = Math.ceil(xa); gx <= xb; gx++) {
    ctx.beginPath();
    ctx.moveTo(px(gx), PAD);
    ctx.lineTo(px(gx), H - PAD);
    ctx.stroke();
  }
  for (let gy = Math.ceil(ya); gy <= yb; gy++) {
    ctx.beginPath();
    ctx.moveTo(PAD, py(gy));
    ctx.lineTo(W - PAD, py(gy));
    ctx.stroke();
  }

  // axes (drawn only when 0 is within range)
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.5;
  if (ya <= 0 && yb >= 0) {
    ctx.beginPath();
    ctx.moveTo(PAD, py(0));
    ctx.lineTo(W - PAD, py(0));
    ctx.stroke();
  }
  if (xa <= 0 && xb >= 0) {
    ctx.beginPath();
    ctx.moveTo(px(0), PAD);
    ctx.lineTo(px(0), H - PAD);
    ctx.stroke();
  }

  // axis range labels (corners)
  ctx.fillStyle = COLORS.label;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(String(xa), PAD, H - PAD + 14);
  ctx.fillText(String(xb), W - PAD - 12, H - PAD + 14);
  ctx.fillText(String(Math.round(yb)), 4, PAD + 4);
  ctx.fillText(String(Math.round(ya)), 4, H - PAD);

  // x-marker (vertical guide at the queried x)
  if (typeof spec.markX === 'number' && spec.markX >= xa && spec.markX <= xb) {
    ctx.strokeStyle = COLORS.mark;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px(spec.markX), PAD);
    ctx.lineTo(px(spec.markX), H - PAD);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.mark;
    ctx.fillText(`x=${spec.markX}`, px(spec.markX) + 4, PAD + 12);
  }

  // the curve
  ctx.strokeStyle = COLORS.curve;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  spec.points.forEach(([x, y], i) => {
    const X = px(x);
    const Y = py(y);
    if (i === 0) {
      ctx.moveTo(X, Y);
    } else {
      ctx.lineTo(X, Y);
    }
  });
  ctx.stroke();
}

// General geometric-figure renderer; world box `fig.view` letterboxed into the canvas, only given values labeled.
function _unit(x, y) {
  const L = Math.hypot(x, y) || 1;
  return { x: x / L, y: y / L };
}

export function drawFigure(canvas, fig) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !fig) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const [xmin, xmax, ymin, ymax] = fig.view;
  const pad = 52; // generous gutter so pixel-offset / outside-corner labels stay on-canvas
  // Default stretches each axis independently to fill the canvas; uniform:true preserves aspect (circles).
  let sx = (W - 2 * pad) / (xmax - xmin);
  let sy = (H - 2 * pad) / (ymax - ymin);
  let offX = pad;
  let offY = pad;
  if (fig.uniform) {
    const s = Math.min(sx, sy);
    sx = s;
    sy = s;
    offX = (W - (xmax - xmin) * s) / 2;
    offY = (H - (ymax - ymin) * s) / 2;
  }
  const px = (x) => offX + (x - xmin) * sx;
  const py = (y) => H - (offY + (y - ymin) * sy); // world y up → canvas y down

  ctx.font = '700 19px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw text on an opaque plaque so figure edges never cross/overlap a label.
  const drawText = (txt, x, y, color) => {
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x - w / 2 - 5, y - 13, w + 10, 26);
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
  };

  for (const it of fig.items) {
    if (it.t === 'poly') {
      ctx.beginPath();
      it.pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
      if (it.close) {
        ctx.closePath();
      }
      if (it.fill) {
        ctx.fillStyle = COLORS.shade;
        ctx.fill();
      }
      ctx.strokeStyle = COLORS.curve;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (it.t === 'seg') {
      ctx.beginPath();
      ctx.moveTo(px(it.a[0]), py(it.a[1]));
      ctx.lineTo(px(it.b[0]), py(it.b[1]));
      ctx.strokeStyle = it.dash ? COLORS.mark : COLORS.axis;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(it.dash ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.t === 'circle') {
      ctx.beginPath();
      ctx.arc(px(it.c[0]), py(it.c[1]), it.r * sx, 0, 2 * Math.PI);
      ctx.strokeStyle = COLORS.curve;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (it.t === 'point') {
      ctx.beginPath();
      ctx.arc(px(it.p[0]), py(it.p[1]), it.r || 4, 0, 2 * Math.PI);
      ctx.fillStyle = COLORS.mark;
      ctx.fill();
      if (it.label) {
        drawText(it.label, px(it.p[0]), py(it.p[1]) - 18, COLORS.label);
      }
    } else if (it.t === 'label') {
      let lx;
      let ly;
      if (it.edge) {
        // Offset perpendicular to the edge as drawn (screen space) so non-uniform stretch still moves it straight off the line.
        const ax = px(it.edge[0][0]);
        const ay = py(it.edge[0][1]);
        const bx = px(it.edge[1][0]);
        const by = py(it.edge[1][1]);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        let nx = -(by - ay);
        let ny = bx - ax;
        const L = Math.hypot(nx, ny) || 1;
        nx /= L;
        ny /= L;
        if (it.away) {
          const rx = px(it.away[0]);
          const ry = py(it.away[1]);
          if (nx * (rx - mx) + ny * (ry - my) > 0) {
            nx = -nx;
            ny = -ny;
          }
        }
        const off = it.off || 30;
        lx = mx + nx * off;
        ly = my + ny * off;
      } else {
        lx = px(it.p[0]);
        ly = py(it.p[1]);
      }
      drawText(it.text, lx, ly, COLORS.label);
    } else if (it.t === 'angle') {
      const vx = px(it.at[0]);
      const vy = py(it.at[1]);
      const a1 = Math.atan2(py(it.from[1]) - vy, px(it.from[0]) - vx);
      const a2 = Math.atan2(py(it.to[1]) - vy, px(it.to[0]) - vx);
      let d = a2 - a1;
      while (d <= -Math.PI) {
        d += 2 * Math.PI;
      }
      while (d > Math.PI) {
        d -= 2 * Math.PI;
      }
      const r = it.r || 22;
      ctx.strokeStyle = COLORS.mark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(vx, vy, r, a1, a1 + d, d < 0);
      ctx.stroke();
      if (it.label) {
        // Place outside the corner (opposite the wedge) so the number never touches the arc or either side.
        const m = a1 + d / 2 + Math.PI;
        drawText(it.label, vx + Math.cos(m) * (r + 24), vy + Math.sin(m) * (r + 24), COLORS.mark);
      }
    } else if (it.t === 'right') {
      const vx = px(it.at[0]);
      const vy = py(it.at[1]);
      const f = _unit(px(it.from[0]) - vx, py(it.from[1]) - vy);
      const g = _unit(px(it.to[0]) - vx, py(it.to[1]) - vy);
      const m = 13;
      ctx.strokeStyle = COLORS.axis;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(vx + f.x * m, vy + f.y * m);
      ctx.lineTo(vx + (f.x + g.x) * m, vy + (f.y + g.y) * m);
      ctx.lineTo(vx + g.x * m, vy + g.y * m);
      ctx.stroke();
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

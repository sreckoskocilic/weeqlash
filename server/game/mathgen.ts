// Procedural math-problem generator; answer/scoring fields stay server-side, strip with toPublic() before emitting.

import { BASE_POINTS } from './mathquiz.ts';

// Graph sent as sampled points, not a closed form, so the formula never leaves the server.
export interface GraphSpec {
  points: [number, number][];
  xRange: [number, number];
  yRange: [number, number];
  shade?: [number, number]; // optional x-interval to shade (e.g. area under curve)
  markX?: number; // optional vertical marker line at x
}

// A geometric figure drawn on the client canvas; only given quantities are labeled, the asked value is never drawn.
export interface FigureItem {
  t: 'poly' | 'seg' | 'point' | 'label' | 'angle' | 'right' | 'circle';
  pts?: number[][]; // poly
  a?: number[]; // seg endpoints
  b?: number[];
  at?: number[]; // angle/right vertex
  from?: number[];
  to?: number[];
  p?: number[]; // point/label position
  c?: number[]; // circle center
  r?: number; // circle radius (world) or point radius (px)
  text?: string;
  label?: string;
  close?: boolean;
  fill?: boolean;
  dash?: boolean;
  edge?: number[][]; // label: [P,Q] edge the label belongs to (offset perpendicular to it)
  away?: number[]; // label: reference point; offset goes away from it
  off?: number; // label: pixel offset distance
}
export interface FigureSpec {
  view: number[]; // [xmin, xmax, ymin, ymax]
  items: FigureItem[];
  uniform?: boolean; // true = preserve aspect (circles); default stretches to fill
}

export interface NumericProblem {
  topic: string;
  prompt: string;
  tex?: string;
  graph?: GraphSpec;
  figure?: FigureSpec;
  points: number;
  // secret — server-only, strip before sending to client
  answer: number;
  scoring: 'exact' | 'proximity';
  tol: number;
  range: number;
  bonus?: number; // near-exact bonus points (see mathquiz.scorePick)
  bonusTol?: number; // distance within which the bonus applies
}

export type PublicProblem = Omit<
  NumericProblem,
  'answer' | 'scoring' | 'tol' | 'range' | 'bonus' | 'bonusTol'
>;

export function toPublic(p: NumericProblem): PublicProblem {
  const { answer, scoring, tol, range, bonus, bonusTol, ...pub } = p;
  void answer;
  void scoring;
  void tol;
  void range;
  void bonus;
  void bonusTol;
  return pub;
}

// ---------------------------------------------------------------------------
// rng + formatting helpers
// ---------------------------------------------------------------------------

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function nonZero(lo: number, hi: number): number {
  let v = 0;
  while (v === 0) {
    v = randInt(lo, hi);
  }
  return v;
}

// " + 3" / " - 3" for KaTeX (trailing term, keeps a leading space).
function fmtSigned(n: number): string {
  return n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`;
}

// coefficient with implicit 1 / -1 ("" / "-")
function coef(n: number): string {
  return n === 1 ? '' : n === -1 ? '-' : String(n);
}

// A signed non-leading term with the implicit-1 coefficient dropped:
// fmtTerm(1,'x') = " + x", fmtTerm(-3,'x^2') = " - 3x^2". Assumes n !== 0.
function fmtTerm(n: number, suffix: string): string {
  const mag = Math.abs(n);
  return ` ${n >= 0 ? '+' : '-'} ${mag === 1 ? '' : mag}${suffix}`;
}

// a x^2 + b x + c as KaTeX, dropping zero terms.
function fmtQuadratic(a: number, b: number, c: number): string {
  let s = `${coef(a)}x^2`;
  if (b !== 0) {
    s += fmtTerm(b, 'x');
  }
  if (c !== 0) {
    s += ` ${fmtSigned(c)}`;
  }
  return s;
}

// a x^3 + b x^2 + c x + d as KaTeX, dropping zero terms.
function fmtCubic(a: number, b: number, c: number, d: number): string {
  let s = `${coef(a)}x^3`;
  if (b !== 0) {
    s += fmtTerm(b, 'x^2');
  }
  if (c !== 0) {
    s += fmtTerm(c, 'x');
  }
  if (d !== 0) {
    s += ` ${fmtSigned(d)}`;
  }
  return s;
}

// Sample f over [xa, xb] into a polyline plus a fitted y-range.
function sample(
  f: (x: number) => number,
  xa: number,
  xb: number,
  steps = 48,
): { points: [number, number][]; yRange: [number, number] } {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = xa + (i / steps) * (xb - xa);
    points.push([x, f(x)]);
  }
  const ys = points.map((p) => p[1]);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  return { points, yRange: [lo - pad, hi + pad] };
}

// ---------------------------------------------------------------------------
// Topic generators
// ---------------------------------------------------------------------------

// Evaluate the derivative of a quadratic at a point. f'(x) = 2a x + b → integer.
function genDerivPolyEval(): NumericProblem {
  const a = nonZero(-5, 5);
  const b = randInt(-9, 9);
  const c = randInt(-9, 9);
  const x0 = randInt(-4, 4);
  return {
    topic: 'deriv-poly-eval',
    prompt: 'Compute the derivative at the given point:',
    tex: `f(x) = ${fmtQuadratic(a, b, c)}, \\quad f'(${x0}) = \\;?`,
    points: BASE_POINTS,
    answer: 2 * a * x0 + b,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Evaluate a definite integral of a quadratic. Result is usually fractional →
// proximity scoring (answer to ~2 decimals).
function genDefIntegral(): NumericProblem {
  const a = nonZero(-3, 3);
  const b = randInt(-5, 5);
  const c = randInt(-5, 5);
  const lo = randInt(-3, 1);
  const hi = randInt(lo + 1, 4);
  const F = (x: number) => (a / 3) * x ** 3 + (b / 2) * x ** 2 + c * x;
  return {
    topic: 'def-integral',
    prompt: 'Evaluate the definite integral (round to 2 decimals):',
    tex: `\\int_{${lo}}^{${hi}} \\left(${fmtQuadratic(a, b, c)}\\right)\\,dx`,
    points: BASE_POINTS,
    answer: F(hi) - F(lo),
    scoring: 'proximity',
    tol: 0.05,
    range: 2,
  };
}

// Read the value of a plotted line at a marked x; points only, proximity scoring.
function genReadGraph(): NumericProblem {
  const m = nonZero(-3, 3);
  const k = randInt(-4, 4);
  const x0 = randInt(-4, 4);
  const xRange: [number, number] = [-5, 5];
  const f = (x: number) => m * x + k;
  const { points, yRange } = sample(f, xRange[0], xRange[1]);
  return {
    topic: 'read-graph',
    prompt: `Read the value of the plotted function at x = ${x0}:`,
    graph: { points, xRange, yRange, markX: x0 },
    points: BASE_POINTS,
    answer: f(x0),
    scoring: 'proximity',
    tol: 0.25,
    range: 2,
  };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Bounding box (with padding) for a set of points → FigureSpec.view.
function boundsOf(pts: number[][], pad = 1): number[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    Math.min(...xs) - pad,
    Math.max(...xs) + pad,
    Math.min(...ys) - pad,
    Math.max(...ys) + pad,
  ];
}

// --- Trigonometry ---

// Evaluate sin/cos/tan at a special angle (degrees); proximity to 3 decimals.
const TRIG_FNS = ['sin', 'cos', 'tan'] as const;
const TRIG_ANGLES_SINCOS = [0, 30, 45, 60, 90, 120, 135, 150, 180];
const TRIG_ANGLES_TAN = [0, 30, 45, 60, 120, 135, 150]; // skip 90/270 (undefined)
function genTrigEval(): NumericProblem {
  const fn = pick(TRIG_FNS);
  const deg = pick(fn === 'tan' ? TRIG_ANGLES_TAN : TRIG_ANGLES_SINCOS);
  const rad = (deg * Math.PI) / 180;
  const raw = fn === 'sin' ? Math.sin(rad) : fn === 'cos' ? Math.cos(rad) : Math.tan(rad);
  return {
    topic: 'trig-eval',
    prompt: 'Evaluate (round to 3 decimals):',
    tex: `\\${fn} ${deg}^\\circ`,
    points: BASE_POINTS,
    answer: Math.round(raw * 1e6) / 1e6,
    scoring: 'proximity',
    tol: 0.005,
    range: 0.4,
  };
}

// --- Geometry (drawn on the canvas) ---

function genCircleArea(): NumericProblem {
  const r = randInt(2, 12);
  return {
    topic: 'geo-circle-area',
    prompt: 'Area of the circle (round to 2 decimals):',
    figure: {
      view: [-r - 1, r + 1, -r - 1, r + 1],
      uniform: true, // keep it round
      items: [
        { t: 'circle', c: [0, 0], r },
        { t: 'seg', a: [0, 0], b: [r, 0] },
        { t: 'point', p: [0, 0], r: 3 },
        {
          t: 'label',
          text: `r = ${r}`,
          edge: [
            [0, 0],
            [r, 0],
          ],
          away: [0, 1],
        },
      ],
    },
    points: BASE_POINTS,
    answer: Math.round(Math.PI * r * r * 1e6) / 1e6,
    scoring: 'proximity',
    tol: 0.05,
    range: 5,
  };
}

function genTriangleArea(): NumericProblem {
  const b = randInt(4, 18);
  const h = randInt(3, 14);
  const apexX = randInt(0, b);
  const A = [0, 0];
  const B = [b, 0];
  const P = [apexX, h];
  const foot = [apexX, 0];
  // Offset h toward the wider base side so the label doesn't overlap an edge.
  const hAway = apexX < b / 2 ? A : B;
  return {
    topic: 'geo-triangle-area',
    prompt: 'Area of the triangle (base b, height h):',
    figure: {
      view: boundsOf([A, B, P, foot], 0.6),
      items: [
        { t: 'poly', pts: [A, B, P], close: true },
        { t: 'seg', a: P, b: foot, dash: true }, // height
        { t: 'label', text: `b = ${b}`, edge: [A, B], away: P },
        { t: 'label', text: `h = ${h}`, edge: [P, foot], away: hAway },
      ],
    },
    points: BASE_POINTS,
    answer: 0.5 * b * h,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

const PYTH_TRIPLES = [
  [3, 4, 5],
  [6, 8, 10],
  [5, 12, 13],
  [9, 12, 15],
  [8, 15, 17],
];
function genPythagoras(): NumericProblem {
  const [a, b, c] = pick(PYTH_TRIPLES);
  const A = [0, 0];
  const B = [a, 0];
  const C = [0, b];
  return {
    topic: 'geo-pythagoras',
    prompt: 'Right triangle — find the hypotenuse c:',
    figure: {
      view: boundsOf([A, B, C], 0.6),
      items: [
        { t: 'poly', pts: [A, B, C], close: true },
        { t: 'right', at: A, from: B, to: C },
        { t: 'label', text: String(a), edge: [A, B], away: C },
        { t: 'label', text: String(b), edge: [A, C], away: B },
        { t: 'label', text: 'c = ?', edge: [B, C], away: A },
      ],
    },
    points: BASE_POINTS,
    answer: c,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// --- Limits ---

// lim x→∞ of a same-degree rational → ratio of leading coefficients.
function genLimitInfinity(): NumericProblem {
  const a = nonZero(-6, 6);
  const b = randInt(-5, 5);
  const c = randInt(-5, 5);
  const d = nonZero(-6, 6);
  const e = randInt(-5, 5);
  const f = randInt(-5, 5);
  return {
    topic: 'limit-infinity',
    prompt: 'Evaluate the limit (round to 2 decimals):',
    tex: `\\lim_{x \\to \\infty} \\frac{${fmtQuadratic(a, b, c)}}{${fmtQuadratic(d, e, f)}}`,
    points: BASE_POINTS,
    answer: Math.round((a / d) * 1e6) / 1e6,
    scoring: 'proximity',
    tol: 0.01,
    range: 0.5,
  };
}

// Removable discontinuity: (x-r)(x-s)/(x-r) → limit at x=r is (r - s).
function genLimitRemovable(): NumericProblem {
  const r = nonZero(-5, 5);
  let s = randInt(-5, 5);
  while (s === r) {
    s = randInt(-5, 5);
  }
  return {
    topic: 'limit-removable',
    prompt: 'Evaluate the limit:',
    tex: `\\lim_{x \\to ${r}} \\frac{${fmtQuadratic(1, -(r + s), r * s)}}{x ${fmtSigned(-r)}}`,
    points: BASE_POINTS,
    answer: r - s,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// --- Logarithms / algebra / matrices ---

const LOG_BASES = [2, 3, 5, 10];
function genLogEval(): NumericProblem {
  const base = pick(LOG_BASES);
  const k = randInt(1, base === 10 ? 4 : 5);
  return {
    topic: 'log-eval',
    prompt: 'Evaluate the logarithm:',
    tex: `\\log_{${base}} ${Math.pow(base, k)}`,
    points: BASE_POINTS,
    answer: k,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Larger root of a factorable quadratic (x-r)(x-s) = 0.
function genQuadRoot(): NumericProblem {
  const r = randInt(-7, 7);
  let s = randInt(-7, 7);
  while (s === r) {
    s = randInt(-7, 7);
  }
  return {
    topic: 'quad-root',
    prompt: 'Find the larger root of the equation:',
    tex: `${fmtQuadratic(1, -(r + s), r * s)} = 0`,
    points: BASE_POINTS,
    answer: Math.max(r, s),
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Estimate a non-perfect-square root; proximity-graded, near-exact earns a bonus.
function genSqrtEstimate(): NumericProblem {
  let n = randInt(2, 150);
  while (Number.isInteger(Math.sqrt(n))) {
    n = randInt(2, 150);
  }
  return {
    topic: 'sqrt-estimate',
    prompt: 'Estimate the square root as closely as you can:',
    tex: `\\sqrt{${n}}`,
    points: BASE_POINTS,
    answer: Math.sqrt(n),
    scoring: 'proximity',
    tol: 0.02, // within 0.02 → full credit
    range: 1, // off by ≥ 1 → zero
    bonus: 5, // near-exact bonus
    bonusTol: 0.005, // within 0.005 of the true value
  };
}

// --- Proximity geometry / trigonometry ---

// Law of cosines: given 3 sides, find the marked angle (opposite side c).
function genTriangleAngleCosine(): NumericProblem {
  const a = randInt(4, 12);
  const b = randInt(4, 12);
  const c = randInt(Math.abs(a - b) + 1, a + b - 1); // strict triangle inequality
  const gamma = Math.acos((a * a + b * b - c * c) / (2 * a * b)); // angle at vertex C
  // Vertex C at origin; side b (=CA) along x; side a (=CB) at angle gamma.
  const C = [0, 0];
  const A = [b, 0];
  const B = [a * Math.cos(gamma), a * Math.sin(gamma)];
  return {
    topic: 'triangle-angle',
    prompt: 'Find the marked angle (degrees, 1 decimal):',
    figure: {
      view: boundsOf([C, A, B], 0.6),
      items: [
        { t: 'poly', pts: [C, A, B], close: true },
        { t: 'angle', at: C, from: A, to: B, label: '?' },
        { t: 'label', text: `b = ${b}`, edge: [C, A], away: B },
        { t: 'label', text: `a = ${a}`, edge: [C, B], away: A },
        { t: 'label', text: `c = ${c}`, edge: [A, B], away: C },
      ],
    },
    points: BASE_POINTS,
    answer: (gamma * 180) / Math.PI,
    scoring: 'proximity',
    tol: 0.3,
    range: 12,
  };
}

// Right triangle: the marked angle θ from its opposite & adjacent legs.
function genRightTriangleAngle(): NumericProblem {
  const opp = randInt(2, 12);
  const adj = randInt(2, 12);
  const A = [0, 0]; // right angle
  const B = [adj, 0];
  const C = [0, opp];
  return {
    topic: 'right-triangle-angle',
    prompt: 'Find the marked angle θ (degrees, 1 decimal):',
    figure: {
      view: boundsOf([A, B, C], 0.6),
      items: [
        { t: 'poly', pts: [A, B, C], close: true },
        { t: 'right', at: A, from: B, to: C },
        { t: 'angle', at: B, from: A, to: C, label: 'θ' },
        { t: 'label', text: String(adj), edge: [A, B], away: C },
        { t: 'label', text: String(opp), edge: [A, C], away: B },
      ],
    },
    points: BASE_POINTS,
    answer: (Math.atan2(opp, adj) * 180) / Math.PI,
    scoring: 'proximity',
    tol: 0.3,
    range: 12,
  };
}

// Distance between two plotted lattice points.
function genDistance2Pts(): NumericProblem {
  const x1 = randInt(-6, 6);
  const y1 = randInt(-6, 6);
  let x2 = randInt(-6, 6);
  let y2 = randInt(-6, 6);
  while (x2 === x1 && y2 === y1) {
    x2 = randInt(-6, 6);
    y2 = randInt(-6, 6);
  }
  const view = [
    Math.min(x1, x2) - 1.5,
    Math.max(x1, x2) + 1.5,
    Math.min(y1, y2) - 1.5,
    Math.max(y1, y2) + 1.5,
  ];
  return {
    topic: 'distance-2pts',
    prompt: 'Distance between the two points (round to 2 decimals):',
    figure: {
      view,
      items: [
        { t: 'seg', a: [view[0], 0], b: [view[1], 0] }, // x-axis
        { t: 'seg', a: [0, view[2]], b: [0, view[3]] }, // y-axis
        { t: 'seg', a: [x1, y1], b: [x2, y2], dash: true },
        { t: 'point', p: [x1, y1], label: `(${x1}, ${y1})` },
        { t: 'point', p: [x2, y2], label: `(${x2}, ${y2})` },
      ],
    },
    points: BASE_POINTS,
    answer: Math.hypot(x2 - x1, y2 - y1),
    scoring: 'proximity',
    tol: 0.05,
    range: 2,
  };
}

// Law of sines: given angle A, opposite side a, and angle B → side b.
function genLawOfSinesSide(): NumericProblem {
  const A = randInt(25, 80);
  const B = randInt(25, 150 - A); // A + B < 180, valid triangle
  const a = randInt(5, 15);
  const Crad = ((180 - A - B) * Math.PI) / 180;
  const Brad = (B * Math.PI) / 180;
  const Arad = (A * Math.PI) / 180;
  const c = (a * Math.sin(Crad)) / Math.sin(Arad);
  // B=origin (angle B), C along x at distance a, A from B at angle B, length c.
  const Bv = [0, 0];
  const Cv = [a, 0];
  const Av = [c * Math.cos(Brad), c * Math.sin(Brad)];
  return {
    topic: 'law-of-sines-side',
    prompt: 'Law of sines — find the side marked b = ? (2 decimals):',
    figure: {
      view: boundsOf([Av, Bv, Cv], 0.6),
      items: [
        { t: 'poly', pts: [Av, Bv, Cv], close: true },
        { t: 'angle', at: Bv, from: Cv, to: Av, label: `${B}°` },
        { t: 'angle', at: Av, from: Bv, to: Cv, label: `${A}°` },
        { t: 'label', text: `a = ${a}`, edge: [Bv, Cv], away: Av },
        { t: 'label', text: 'b = ?', edge: [Cv, Av], away: Bv },
      ],
    },
    points: BASE_POINTS,
    answer: (a * Math.sin(Brad)) / Math.sin(Arad),
    scoring: 'proximity',
    tol: 0.05,
    range: 3,
  };
}

// Interior angle of a regular n-gon: (n-2)·180/n.
function genPolygonInteriorAngle(): NumericProblem {
  const n = randInt(3, 12);
  const R = 4;
  const verts: number[][] = [];
  for (let k = 0; k < n; k++) {
    const ang = Math.PI / 2 + (2 * Math.PI * k) / n; // start at top
    verts.push([R * Math.cos(ang), R * Math.sin(ang)]);
  }
  return {
    topic: 'polygon-interior-angle',
    prompt: `Interior angle of this regular ${n}-gon (degrees, 2 decimals):`,
    figure: {
      view: [-R - 1, R + 1, -R - 1, R + 1],
      uniform: true, // keep the polygon regular
      items: [
        { t: 'poly', pts: verts, close: true },
        // mark the interior angle at vertex 0 (between its two neighbours)
        { t: 'angle', at: verts[0], from: verts[n - 1], to: verts[1], label: '?', r: 26 },
      ],
    },
    points: BASE_POINTS,
    answer: ((n - 2) * 180) / n,
    scoring: 'proximity',
    tol: 0.05,
    range: 5,
  };
}

// --- More calculus ---

// Critical point of a parabola: the x where f'(x)=0, i.e. -b/(2a).
function genCriticalPoint(): NumericProblem {
  const a = nonZero(-5, 5);
  const b = nonZero(-9, 9);
  const c = randInt(-9, 9);
  return {
    topic: 'critical-point',
    prompt: "Find the x where f'(x) = 0 (round to 2 decimals):",
    tex: `f(x) = ${fmtQuadratic(a, b, c)}`,
    points: BASE_POINTS,
    answer: -b / (2 * a),
    scoring: 'proximity',
    tol: 0.02,
    range: 1,
  };
}

// Second derivative of a cubic at a point: f''(x) = 6a x + 2b → integer.
function genSecondDeriv(): NumericProblem {
  const a = nonZero(-4, 4);
  const b = randInt(-6, 6);
  const c = randInt(-6, 6);
  const d = randInt(-6, 6);
  const x0 = randInt(-4, 4);
  return {
    topic: 'second-deriv',
    prompt: 'Compute the second derivative at the given point:',
    tex: `f(x) = ${fmtCubic(a, b, c, d)}, \\quad f''(${x0}) = \\;?`,
    points: BASE_POINTS,
    answer: 6 * a * x0 + 2 * b,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Slope of the tangent to a cubic at a point: f'(x) = 3a x^2 + 2b x + c → integer.
function genTangentSlope(): NumericProblem {
  const a = nonZero(-3, 3);
  const b = randInt(-5, 5);
  const c = randInt(-9, 9);
  const d = randInt(-9, 9);
  const x0 = randInt(-3, 3);
  return {
    topic: 'tangent-slope',
    prompt: 'Slope of the tangent line at the given point:',
    tex: `f(x) = ${fmtCubic(a, b, c, d)}, \\quad f'(${x0}) = \\;?`,
    points: BASE_POINTS,
    answer: 3 * a * x0 * x0 + 2 * b * x0 + c,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Derivative of ln(x) at x=c → 1/c.
function genDerivLn(): NumericProblem {
  const c = randInt(2, 9);
  return {
    topic: 'deriv-ln',
    prompt: 'Derivative of the natural log at the point (round to 3 decimals):',
    tex: `\\frac{d}{dx}\\ln(x)\\,\\Big|_{x=${c}} = \\;?`,
    points: BASE_POINTS,
    answer: 1 / c,
    scoring: 'proximity',
    tol: 0.005,
    range: 0.2,
  };
}

// Maximum value of a downward parabola (a < 0): c - b^2/(4a).
function genOptimization(): NumericProblem {
  const a = -nonZero(1, 5); // negative → opens downward → has a maximum
  const b = randInt(-9, 9);
  const c = randInt(-9, 9);
  return {
    topic: 'optimization',
    prompt: 'Find the maximum value of the function (round to 2 decimals):',
    tex: `f(x) = ${fmtQuadratic(a, b, c)}`,
    points: BASE_POINTS,
    answer: c - (b * b) / (4 * a),
    scoring: 'proximity',
    tol: 0.05,
    range: 3,
  };
}

// Average value of a quadratic over [lo,hi]: (1/(hi-lo))∫.
function genAvgValue(): NumericProblem {
  const a = nonZero(-3, 3);
  const b = randInt(-5, 5);
  const c = randInt(-5, 5);
  const lo = randInt(-3, 1);
  const hi = randInt(lo + 1, 4);
  const F = (x: number) => (a / 3) * x ** 3 + (b / 2) * x ** 2 + c * x;
  return {
    topic: 'avg-value',
    prompt: 'Average value of the function over the interval (round to 2 decimals):',
    tex: `\\frac{1}{${hi} - (${lo})}\\int_{${lo}}^{${hi}} \\left(${fmtQuadratic(a, b, c)}\\right)\\,dx`,
    points: BASE_POINTS,
    answer: (F(hi) - F(lo)) / (hi - lo),
    scoring: 'proximity',
    tol: 0.03,
    range: 1.5,
  };
}

// Average rate of change of a quadratic over [x1,x2]: (f(x2)-f(x1))/(x2-x1).
function genSecantSlope(): NumericProblem {
  const a = nonZero(-3, 3);
  const b = randInt(-6, 6);
  const c = randInt(-6, 6);
  const x1 = randInt(-5, 1);
  const x2 = randInt(x1 + 1, 5);
  const f = (x: number) => a * x * x + b * x + c;
  return {
    topic: 'secant-slope',
    prompt: 'Average rate of change over the interval (round to 2 decimals):',
    tex: `f(x) = ${fmtQuadratic(a, b, c)}, \\quad [${x1},\\, ${x2}]`,
    points: BASE_POINTS,
    answer: (f(x2) - f(x1)) / (x2 - x1),
    scoring: 'proximity',
    tol: 0.02,
    range: 1.5,
  };
}

// lim x→0 sin(ax)/(bx) = a/b.
function genLimitTrig(): NumericProblem {
  const a = nonZero(-6, 6);
  const b = nonZero(-6, 6);
  return {
    topic: 'limit-trig',
    prompt: 'Evaluate the limit (round to 3 decimals):',
    tex: `\\lim_{x \\to 0} \\frac{\\sin(${coef(a)}x)}{${coef(b)}x}`,
    points: BASE_POINTS,
    answer: a / b,
    scoring: 'proximity',
    tol: 0.005,
    range: 0.3,
  };
}

// lim x→0 (e^{ax} - 1)/x = a (standard / L'Hôpital limit) → integer.
function genLimitExp(): NumericProblem {
  const a = nonZero(-5, 5);
  return {
    topic: 'limit-exp',
    prompt: 'Evaluate the limit:',
    tex: `\\lim_{x \\to 0} \\frac{e^{${coef(a)}x} - 1}{x}`,
    points: BASE_POINTS,
    answer: a,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// Definite integral of sin/cos over [lo,hi] in radians.
function genIntegralTrig(): NumericProblem {
  const fn = pick(['sin', 'cos'] as const);
  const lo = randInt(-3, 1);
  const hi = randInt(lo + 1, 4);
  const answer = fn === 'cos' ? Math.sin(hi) - Math.sin(lo) : -(Math.cos(hi) - Math.cos(lo));
  return {
    topic: 'integral-trig',
    prompt: 'Evaluate the definite integral (radians, round to 2 decimals):',
    tex: `\\int_{${lo}}^{${hi}} \\${fn}(x)\\,dx`,
    points: BASE_POINTS,
    answer,
    scoring: 'proximity',
    tol: 0.03,
    range: 1.5,
  };
}

// Instantaneous velocity: position s(t)=a t^2+b t+c, v(t)=s'(t)=2a t+b at t0.
function genInstantVelocity(): NumericProblem {
  const a = nonZero(-4, 4);
  const b = randInt(-9, 9);
  const c = randInt(-9, 9);
  const t0 = randInt(0, 5);
  return {
    topic: 'instant-velocity',
    prompt: 'A particle has position s(t). Find its velocity at the given time:',
    tex: `s(t) = ${fmtQuadratic(a, b, c).replace(/x/g, 't')}, \\quad v(${t0}) = \\;?`,
    points: BASE_POINTS,
    answer: 2 * a * t0 + b,
    scoring: 'exact',
    tol: 1e-6,
    range: 1e-6,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOPICS = {
  'deriv-poly-eval': genDerivPolyEval,
  'def-integral': genDefIntegral,
  'read-graph': genReadGraph,
  'trig-eval': genTrigEval,
  'geo-circle-area': genCircleArea,
  'geo-triangle-area': genTriangleArea,
  'geo-pythagoras': genPythagoras,
  'limit-infinity': genLimitInfinity,
  'limit-removable': genLimitRemovable,
  'log-eval': genLogEval,
  'quad-root': genQuadRoot,
  'sqrt-estimate': genSqrtEstimate,
  'triangle-angle': genTriangleAngleCosine,
  'right-triangle-angle': genRightTriangleAngle,
  'distance-2pts': genDistance2Pts,
  'law-of-sines-side': genLawOfSinesSide,
  'polygon-interior-angle': genPolygonInteriorAngle,
  'critical-point': genCriticalPoint,
  'second-deriv': genSecondDeriv,
  'tangent-slope': genTangentSlope,
  'deriv-ln': genDerivLn,
  optimization: genOptimization,
  'avg-value': genAvgValue,
  'secant-slope': genSecantSlope,
  'limit-trig': genLimitTrig,
  'limit-exp': genLimitExp,
  'integral-trig': genIntegralTrig,
  'instant-velocity': genInstantVelocity,
} as const;

export type TopicId = keyof typeof TOPICS;
export const TOPIC_IDS = Object.keys(TOPICS) as TopicId[];

export function generate(topic: TopicId): NumericProblem {
  return TOPICS[topic]();
}

// Build n problems from a shuffled pool of enabled topics; cycles the order if n exceeds pool size.
export function generateSet(n: number, topics: TopicId[] = TOPIC_IDS): NumericProblem[] {
  const pool = (topics.length ? topics : TOPIC_IDS).slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: NumericProblem[] = [];
  for (let i = 0; i < n; i++) {
    out.push(generate(pool[i % pool.length]));
  }
  return out;
}

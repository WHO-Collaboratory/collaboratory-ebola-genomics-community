// regression.js — OLS regression and confidence interval utilities.
//
// Provides:
//   computeOLS(pts)                              — ordinary least-squares fit over {x,y} pairs
//   tQuantile(df, alpha)                         — two-tailed t-distribution quantile
//   ciHalfWidth(x, reg, alpha)                   — CI half-width for the regression mean at x
//   optimalRootPosition(bSide, pSide, L, opts)   — optimal split point on a branch
//
// These are pure numerical functions with no DOM or tree dependencies.
// rttrenderer.js and rttchart.js import from here; phylograph.js delegates
// TreeCalibration.computeOLS() here so callers can use either path.
//
// optimalRootPosition() implements the same mathematics as _evalBranch() in
// phylograph.js.  _evalBranch() achieves O(1) per branch by reusing pre-computed
// DFS aggregate sums built in _buildRootOptState(); optimalRootPosition()
// derives those same aggregates directly from the raw tip arrays (O(n) per call)
// and is intended for correctness verification, single-branch optimisation, and
// unit testing.  Both functions must produce identical d and score values for any
// valid input.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordinary least-squares regression over {x, y} point pairs.
 * Returns the fit plus summary statistics needed to compute confidence and
 * prediction interval envelopes.
 *
 * @param  {Array<{x:number, y:number}>} pts
 * @returns {{a,b,xInt,r,r2,cv,rmse,rms,n,xBar,ssxx}|null}
 *   a, b        — slope and intercept  (y = a·x + b)
 *   xInt        — x-intercept  (−b/a, or null when slope ≈ 0)
 *   r, r2       — Pearson correlation and R²
 *   rmse        — √(SSE/n)  used for the ±2σ residual band
 *   rms         — SSE/(n−2) used for confidence intervals  (null when n < 3)
 *   n           — number of valid points used
 *   xBar, ssxx  — mean of x and Σ(xi−x̄)²; needed for CI computation
 */
export function computeOLS(pts) {
  const valid = pts.filter(p => p.x != null && !Number.isNaN(p.x));
  const n = valid.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const { x, y } of valid) { sx += x; sy += y; sxx += x*x; sxy += x*y; syy += y*y; }
  const xBar = sx / n, yBar = sy / n;
  const ssxx = sxx - n * xBar * xBar;
  const ssyy = syy - n * yBar * yBar;
  const ssxy = sxy - n * xBar * yBar;
  if (Math.abs(ssxx) < 1e-20) return null;
  const a    = ssxy / ssxx;
  const b    = yBar - a * xBar;
  const xInt = Math.abs(a) > 1e-20 ? -b / a : null;
  const r    = (ssxx > 0 && ssyy > 0) ? ssxy / Math.sqrt(ssxx * ssyy) : 0;
  let sse = 0;
  for (const { x, y } of valid) { const res = y - (a * x + b); sse += res * res; }
  const rmse = Math.sqrt(sse / n);
  const rms  = n > 2 ? sse / (n - 2) : null;   // residual mean squared (SSE / n-2)
  return { a, b, xInt, r, r2: r * r, cv: yBar > 0 ? rmse / yBar : 0, rmse, rms, n, xBar, ssxx };
}

// ─── t-distribution quantile ─────────────────────────────────────────────────

// Exact two-tailed 95% (alpha=0.05) t-quantiles for df = 1 … 10.
const _T95_EXACT = [
  Infinity,  // [0] — sentinel, df starts at 1
  12.706,    // [1]
   4.303,    // [2]
   3.182,    // [3]
   2.776,    // [4]
   2.571,    // [5]
   2.447,    // [6]
   2.365,    // [7]
   2.306,    // [8]
   2.262,    // [9]
   2.228,    // [10]
];

/**
 * Rational-polynomial approximation to Φ⁻¹(p) (standard normal inverse CDF).
 * A&S 26.2.17 — accurate to ~3–4 significant figures.
 * @private
 */
function _normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  const signFlip = p > 0.5;
  const q = signFlip ? 1 - p : p;
  const t = Math.sqrt(-2 * Math.log(q));
  const z = t - (c[0] + t * (c[1] + t * c[2])) / (1 + t * (d[0] + t * (d[1] + t * d[2])));
  return signFlip ? z : -z;
}

/**
 * Two-tailed t-distribution quantile t_{alpha/2, df}.
 * Uses exact table for df ≤ 10 when alpha = 0.05; Cornish-Fisher expansion
 * (A&S 26.7.8, 4 terms) for larger df.  Suitable for CI half-width computation.
 *
 * @param {number} df    degrees of freedom (n − 2 for OLS)
 * @param {number} alpha significance level; 0.05 → 95% CI (default)
 * @returns {number}
 */
export function tQuantile(df, alpha = 0.05) {
  if (df < 1) return Infinity;
  if (alpha === 0.05 && df <= 10) return _T95_EXACT[df];
  const p = 1 - alpha / 2;
  const z = _normInv(p);
  if (df >= 200) return z;    // normal approximation is adequate
  const z2 = z * z;
  const z3 = z2 * z, z5 = z2 * z3, z7 = z2 * z5;
  const df2 = df * df, df3 = df2 * df;
  return z
    + (z3 + z)                         / (4   * df)
    + (5*z5 + 16*z3 + 3*z)             / (96  * df2)
    + (3*z7 + 19*z5 + 17*z3 - 15*z)   / (384 * df3);
}

/**
 * Half-width of the 95% (or arbitrary alpha) confidence interval for the
 * regression mean E[y | x].  The CI band is:  ŷ ± ciHalfWidth(x, reg, alpha)
 *
 * Formula:  t_{alpha/2, n−2} · √( rms · (1/n  +  (x − x̄)² / Σ(xi−x̄)²) )
 *
 * Returns 0 when information is insufficient (n < 3, or rms / ssxx missing).
 * When reg comes from an older code path that did not store xBar/ssxx, the
 * function degrades gracefully to zero rather than throwing.
 *
 * @param {number} x     predictor value (e.g. decimal year for RTT)
 * @param {object} reg   OLS result from computeOLS (needs rms, n, xBar, ssxx)
 * @param {number} alpha significance level — default 0.05 → 95% CI
 * @returns {number}
 */
export function ciHalfWidth(x, reg, alpha = 0.05) {
  if (!reg || reg.rms == null || reg.ssxx == null || reg.ssxx <= 0 || reg.n < 3) return 0;
  const t  = tQuantile(reg.n - 2, alpha);
  const se = Math.sqrt(reg.rms * (1 / reg.n + (x - reg.xBar) ** 2 / reg.ssxx));
  return t * se;
}

// ─── Optimal root position on a branch ───────────────────────────────────────

/**
 * Find the optimal position along a branch of length L that divides tips into
 * a B-side (child / away-from-anchor) group and a P-side (parent / toward-anchor)
 * group, minimising either:
 *
 *   heterochronous  – the OLS regression residual of (date, root-to-tip distance)
 *   homochronous    – the variance of root-to-tip distances
 *
 * When the root is placed at distance d from the P-node (0 ≤ d ≤ L):
 *   root-to-tip height for P-side tip j  =  p_j + d
 *   root-to-tip height for B-side tip i  =  r_i + (L − d)
 *
 * Each tip is supplied as { r, t }:
 *   r  – distance from that group's endpoint node to the tip  (≥ 0)
 *   t  – tip date in decimal years; required only in heterochronous mode
 *
 * This function derives the aggregate sums it needs directly from the raw arrays.
 * It is O(n) per call; phylograph.js._evalBranch() achieves O(1) per branch by
 * reusing pre-built DFS sweeps — both must return identical d and score values.
 *
 * @param {Array<{r:number, t?:number}>} bSide   B-side (child) tips
 * @param {Array<{r:number, t?:number}>} pSide   P-side (parent) tips
 * @param {number} L                              edge length
 * @param {object} [opts]
 * @param {boolean} [opts.heterochronous=true]    use regression score
 * @param {boolean} [opts.forcePositiveRate=true] reject non-positive-slope window
 * @returns {{ d: number, score: number } | null}
 *   d     – optimal distance from P-node to root position in [0, L]
 *   score – residual variance (heterochronous) or height variance (homochronous)
 */
export function optimalRootPosition(bSide, pSide, L, opts = {}) {
  const { heterochronous = true, forcePositiveRate = true } = opts;
  const nd = bSide.length;
  const np = pSide.length;
  const N  = nd + np;
  if (nd === 0 || np === 0 || !(L > 0)) return null;

  // ── Aggregate sums over each side ────────────────────────────────────────
  let sum_tB = 0, sum_rB = 0, sum_rrB = 0, sum_trB = 0;
  let sum_tP = 0, sum_rP = 0, sum_rrP = 0, sum_trP = 0;
  let sum_tt = 0;
  for (const { r, t = 0 } of bSide) {
    sum_tB += t; sum_rB += r; sum_rrB += r * r; sum_trB += t * r; sum_tt += t * t;
  }
  for (const { r, t = 0 } of pSide) {
    sum_tP += t; sum_rP += r; sum_rrP += r * r; sum_trP += t * r; sum_tt += t * t;
  }

  const sum_t = sum_tB + sum_tP;
  const t_bar = sum_t / N;
  // C = Σ(t_i − t̄)² = Σt_i² − N·t̄²
  const C = sum_tt - sum_t * sum_t / N;

  // ── Heights at d=0 (root coincides with P-node) ──────────────────────────
  // P-side tip height = p_j + 0 = p_j
  // B-side tip height = r_i + L
  const sum_hB0  = sum_rB + nd * L;                      // Σ(r_i + L)
  const sum_dBL2 = sum_rrB + 2 * L * sum_rB + nd * L*L; // Σ(r_i + L)²
  const sum_dP2  = sum_rrP;                              // Σ p_j²
  const M0 = (sum_rP + sum_hB0) / N;                    // mean height at d=0

  // ── Polynomial: N·Var(heights) = B0 + B1·d + B2·d²  ─────────────────────
  // Moving the root from d to d+δ shifts P-side heights by +δ and B-side by −δ.
  const B2 = 4 * nd * np / N;   // always positive
  if (!(B2 * L > 1e-20)) return null;

  const B0 = (sum_dP2  - 2 * M0 * sum_rP  + np * M0 * M0)
           + (sum_dBL2 - 2 * M0 * sum_hB0 + nd * M0 * M0);
  const sumV_B = sum_hB0 - nd * M0;
  const sumV_P = sum_rP  - np * M0;
  const B1 = 2 * (sumV_P - sumV_B);

  let d, score;

  if (heterochronous && C > 1e-20) {
    // ── Minimise OLS regression residual (heterochronous) ──────────────────
    //
    // The regression uses date as predictor and height as response.
    // ssxy at d=0:  A0 = Σ t_i·h_i(0) − t̄·Σ h_i(0)
    // d(ssxy)/dd:   A1 = (Σ_P t_j − np·t̄) − (Σ_B t_i − nd·t̄)
    //   (P-side heights increase with d, B-side decrease)
    const sum_ty0 = sum_trP + sum_trB + L * sum_tB;  // Σ t_i·h_i at d=0
    const A0 = sum_ty0 - t_bar * (sum_rP + sum_hB0);
    const A1 = (sum_tP - np * t_bar) - (sum_tB - nd * t_bar);

    // Score = (ssyy − ssxy²/C) / N  (proportional to residual variance)
    // Substituting ssxy(d) = A0 + A1·d and ssyy(d) = B0 + B1·d + B2·d²:
    //   score(d) = (B0 + B1·d + B2·d² − (A0 + A1·d)²/C) / N
    // This is a quadratic in d; minimise over the feasible interval [d_lo, d_hi].

    let d_lo = 0, d_hi = L;
    if (forcePositiveRate) {
      // The slope a(d) = ssxy(d)/C = (A0 + A1·d)/C.
      // Enforce a(d) > 0  →  A0 + A1·d > 0.
      if      (A1 > 1e-20)  d_lo = Math.max(d_lo, -A0 / A1);  // lower bound
      else if (A1 < -1e-20) d_hi = Math.min(d_hi, -A0 / A1);  // upper bound
      else if (A0 <= 0)     return null;    // slope non-positive everywhere
      if (d_lo >= d_hi) return null;
    }

    // Reduced quadratic (Q2·d² + Q1·d + const) after subtracting (A0+A1·d)²/C
    const Q2 = B2 - A1 * A1 / C;
    const Q1 = B1 - 2 * A0 * A1 / C;

    if (Q2 > 1e-30) {
      // Minimum of the quadratic lies at −Q1/(2·Q2); clamp to feasible range
      d = Math.max(d_lo, Math.min(d_hi, -Q1 / (2 * Q2)));
    } else {
      // Quadratic is flat or concave; minimum is at one of the endpoints
      const eval_ = dv => B0 + B1*dv + B2*dv*dv - (A0 + A1*dv) ** 2 / C;
      d = eval_(d_lo) <= eval_(d_hi) ? d_lo : d_hi;
    }

    const ssxy_d = A0 + A1 * d;
    const ssyy_d = B0 + B1 * d + B2 * d * d;
    score = (ssyy_d - ssxy_d * ssxy_d / C) / N;

  } else {
    // ── Minimise variance of root-to-tip distances (homochronous) ──────────
    // Variance is minimised at the vertex of the upward-opening parabola.
    d     = Math.max(0, Math.min(L, -B1 / (2 * B2)));
    score = (B0 + B1 * d + B2 * d * d) / N;
  }

  return { d, score };
}

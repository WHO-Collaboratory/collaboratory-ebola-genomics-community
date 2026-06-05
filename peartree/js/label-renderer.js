// ─────────────────────────────────────────────────────────────────────────────
// AnnotationLabelRenderer
//
// Renders annotation text labels at a compass-relative offset from an anchor
// point on a Canvas 2D context.
//
// Used by TreeRenderer for two distinct label types:
//   • Node labels  – anchor = node position, positions: E / NW / SW
//   • Branch labels – anchor = branch midpoint, positions: N / S
//
// The full 8-point compass model is implemented so additional positions
// (W, NE, SE) can be enabled without further changes to this class.
//
// Compass → Canvas text anchor
//
//    NW  N  NE
//     \  |  /
//  W──[anchor]──E
//     /  |  \
//    SW  S  SE
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canvas text-alignment descriptor for each compass direction.
 *   dx: +1 = text starts to the right of anchor,  -1 = left,  0 = centred
 *   dy: +1 = text starts below the anchor,         -1 = above, 0 = centred
 */
const COMPASS = {
  'E':  { baseline: 'middle', align: 'left',   dx: +1, dy:  0 },
  'W':  { baseline: 'middle', align: 'right',  dx: -1, dy:  0 },
  'N':  { baseline: 'bottom', align: 'center', dx:  0, dy: -1 },
  'S':  { baseline: 'top',    align: 'center', dx:  0, dy: +1 },
  'NE': { baseline: 'bottom', align: 'left',   dx: +1, dy: -1 },
  'NW': { baseline: 'bottom', align: 'right',  dx: -1, dy: -1 },
  'SE': { baseline: 'top',    align: 'left',   dx: +1, dy: +1 },
  'SW': { baseline: 'top',    align: 'right',  dx: -1, dy: +1 },
};

export class AnnotationLabelRenderer {
  constructor() {
    this._position      = 'E';
    this._anchorRadius  = 0;
    this._spacing       = 4;
    this._fontSize      = 12;
    this._color         = '#aaaaaa';
    this._typefaceKey   = null;
    this._typefaceStyle = null;
    this._colorFn       = null;
    this._filterFn      = null;
    this._getLabel      = null;
    this._getAnchor     = null;
    this._fontFn        = null;
  }

  update(s) {
    this._position      = s.position      ?? 'E';
    this._anchorRadius  = s.anchorRadius  ?? 0;
    this._spacing       = s.spacing       ?? 4;
    this._fontSize      = s.fontSize      ?? 12;
    this._color         = s.color         ?? '#aaaaaa';
    this._typefaceKey   = s.typefaceKey   ?? null;
    this._typefaceStyle = s.typefaceStyle ?? null;
    this._colorFn       = s.colorFn       ?? null;
    this._filterFn      = s.filterFn      ?? null;
    this._getLabel      = s.getLabel      ?? null;
    this._getAnchor     = s.getAnchor     ?? null;
    this._fontFn        = s.fontFn        ?? null;
  }

  draw(ctx, nodes, wx, wy, scaleY) {
    if (!this._getLabel || !this._getAnchor || !this._fontFn) return;
    if (scaleY < this._fontSize * 0.5) return;

    const dir = COMPASS[this._position] ?? COMPASS['E'];
    const R   = this._anchorRadius;
    const sp  = this._spacing;

    ctx.save();
    ctx.font         = this._fontFn(this._fontSize, this._typefaceKey, this._typefaceStyle);
    ctx.fillStyle    = this._color;
    ctx.textBaseline = dir.baseline;
    ctx.textAlign    = dir.align;

    for (const node of nodes) {
      if (this._filterFn && !this._filterFn(node)) continue;
      const label = this._getLabel(node);
      if (!label) continue;
      const anchor = this._getAnchor(node);
      if (!anchor) continue;
      if (this._colorFn) ctx.fillStyle = this._colorFn(node) ?? this._color;
      const ax = wx(anchor.x);
      const ay = wy(anchor.y);
      const tx = dir.dx === 0 ? ax : (dir.dx > 0 ? ax + R + sp : ax - R - sp);
      const ty = dir.dy === 0 ? ay : (dir.dy > 0 ? ay + sp    : ay - sp);
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }
}

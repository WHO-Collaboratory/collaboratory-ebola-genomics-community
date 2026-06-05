// ─────────────────────────────────────────────────────────────────────────────
// CircleShapeRenderer
//
// Renders a set of circle shapes (tip circles or internal-node circles) on a
// Canvas 2D context.
// ─────────────────────────────────────────────────────────────────────────────

export class CircleShapeRenderer {
  constructor() {
    this._radius         = 0;
    this._color          = '#888888';
    this._bgColor        = 'transparent';
    this._haloSize       = 0;
    this._perNodeColorFn = null;
    this._filterFn       = null;
  }

  update({ radius, color, bgColor, haloSize, perNodeColorFn = null, filterFn = null }) {
    this._radius         = radius;
    this._color          = color;
    this._bgColor        = bgColor;
    this._haloSize       = haloSize;
    this._perNodeColorFn = perNodeColorFn;
    this._filterFn       = filterFn;
  }

  drawHalos(ctx, nodes, wx, wy) {
    const r    = this._radius;
    const halo = this._haloSize;
    if (r <= 0 || halo <= 0) return;
    ctx.strokeStyle = this._bgColor;
    ctx.lineWidth   = halo * 2;
    ctx.beginPath();
    for (const node of nodes) {
      if (this._filterFn && !this._filterFn(node)) continue;
      ctx.moveTo(wx(node.x) + r, wy(node.y));
      ctx.arc(wx(node.x), wy(node.y), r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  drawFills(ctx, nodes, wx, wy) {
    const r = this._radius;
    if (r <= 0) return;
    if (this._perNodeColorFn) {
      const defaultColor = this._color;
      for (const node of nodes) {
        if (this._filterFn && !this._filterFn(node)) continue;
        ctx.fillStyle = this._perNodeColorFn(node) ?? defaultColor;
        ctx.beginPath();
        ctx.arc(wx(node.x), wy(node.y), r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = this._color;
      ctx.beginPath();
      for (const node of nodes) {
        if (this._filterFn && !this._filterFn(node)) continue;
        ctx.moveTo(wx(node.x) + r, wy(node.y));
        ctx.arc(wx(node.x), wy(node.y), r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}

// graphics-export.js — Generic SVG/PNG export dialog + print for pearcore apps.
// ─────────────────────────────────────────────────────────────────────────────
//
// Provides `createGraphicsExporter` — a factory that owns:
//   • The export dialog form (filename, SVG/PNG radio, optional full-view
//     toggle, background checkbox, PNG size hint)
//   • Format dispatch: PNG blob pipeline or SVG string pipeline
//   • Save-handler integration (Tauri native dialogs)
//   • Print via SVG injection into a hidden layer
//
// The caller supplies app-specific rendering callbacks (buildSvg,
// buildPngCanvas) and viewport dimension providers.  The factory handles
// all the UI, wiring, and download/save logic.
// ─────────────────────────────────────────────────────────────────────────────

import { downloadBlob, blobToBase64 } from './utils.js';

/**
 * Create a graphics exporter — manages an SVG/PNG export dialog and print.
 *
 * @param {Object}      opts
 * @param {HTMLElement}  opts.overlay          – modal overlay element
 * @param {HTMLElement}  opts.body             – modal body container
 * @param {HTMLElement}  opts.footer           – modal footer container
 * @param {HTMLElement}  [opts.closeBtn]       – close button element (wired to close())
 * @param {HTMLElement}  [opts.openBtn]        – open button element (wired to open())
 * @param {string}       [opts.prefix='gfx']  – unique ID prefix for form fields
 * @param {string}       [opts.defaultFilename='image'] – default filename (no extension)
 * @param {number}       [opts.pngScale=2]     – PNG pixel multiplier
 * @param {string}       [opts.fullViewLabel='Full view'] – label for full-view radio
 * @param {Function}     opts.getViewportDims  – () => { width, height }
 * @param {Function}     [opts.getFullDims]    – () => { width, height }; enables the
 *                                                "Current view / Full view" radio
 * @param {Function}     opts.buildSvg         – ({ fullView, transparent }) => string|null
 * @param {Function}     opts.buildPngCanvas   – ({ width, height, fullView, transparent })
 *                                                => OffscreenCanvas | Promise<OffscreenCanvas>
 * @param {Function}     opts.hasContent       – () => boolean (guard: anything to export?)
 *
 * @returns {{
 *   open:            Function,
 *   close:           Function,
 *   doPrint:         Function,
 *   setSaveHandler:  Function,
 *   setPrintTrigger: Function,
 * }}
 */
export function createGraphicsExporter({
  overlay,
  body,
  footer,
  closeBtn,
  openBtn,
  prefix          = 'gfx',
  defaultFilename = 'image',
  pngScale        = 2,
  fullViewLabel   = 'Full view',
  getViewportDims,
  getFullDims,
  buildSvg,
  buildPngCanvas,
  hasContent,
}) {
  let _saveHandler  = null;
  let _printTrigger = null;

  const _hasFullView = typeof getFullDims === 'function';

  // Scoped element lookup inside the overlay.
  const _$ = (id) => overlay.querySelector('#' + id);

  // Read a checked radio value by short name (e.g. 'fmt' → prefix-fmt).
  const _radio = (name) =>
    overlay.querySelector(`input[name="${prefix}-${name}"]:checked`)?.value;

  // ── Wire optional chrome buttons ─────────────────────────────────────────
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (openBtn)  openBtn.addEventListener('click', () => open());

  // ── Public API ───────────────────────────────────────────────────────────

  function open() {
    if (!hasContent()) return;
    overlay.classList.add('open');
    _build();
  }

  function close() {
    overlay.classList.remove('open');
  }

  // ── Dialog builder ───────────────────────────────────────────────────────

  function _build() {
    const { width: vw, height: vh } = getViewportDims();
    const defW     = Math.round(vw * pngScale);
    const defH     = Math.round(vh * pngScale);
    const btnLabel = _saveHandler ? 'Export' : 'Download';
    const btnIcon  = _saveHandler ? 'folder-check' : 'download';

    body.innerHTML =
      `<div class="expg-row">
        <span class="expg-label">Filename</span>
        <input type="text" id="${prefix}-filename" class="expg-input" value="${defaultFilename}" autocomplete="off" spellcheck="false">
        <span id="${prefix}-ext-hint" style="font-size:0.82rem;color:var(--bs-secondary-color);flex-shrink:0">.svg</span>
      </div>
      <div class="expg-row">
        <span class="expg-label">Format</span>
        <div class="expg-radios">
          <label class="expg-radio"><input type="radio" name="${prefix}-fmt" value="svg" checked>&nbsp;SVG (vector)</label>
          <label class="expg-radio"><input type="radio" name="${prefix}-fmt" value="png">&nbsp;PNG (raster)</label>
        </div>
      </div>` +
      (_hasFullView
        ? `<div class="expg-row">
        <span class="expg-label">View</span>
        <div class="expg-radios">
          <label class="expg-radio"><input type="radio" name="${prefix}-view" value="current" checked>&nbsp;Current view</label>
          <label class="expg-radio"><input type="radio" name="${prefix}-view" value="full">&nbsp;${fullViewLabel}</label>
        </div>
      </div>`
        : '') +
      `<div class="expg-row">
        <span class="expg-label">Background</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="${prefix}-bg" checked>&nbsp;Include background colour
        </label>
      </div>
      <div id="${prefix}-png-opts" style="display:none">
        <p class="expg-hint">Output size: ${defW} × ${defH} px (${pngScale}× current viewport)</p>
      </div>`;

    footer.innerHTML =
      `<button id="${prefix}-cancel" class="btn btn-sm btn-secondary">Cancel</button>
      <button id="${prefix}-download" class="btn btn-sm btn-primary"><i class="bi bi-${btnIcon} me-1"></i>${btnLabel}</button>`;

    // ── Wire interactions ──────────────────────────────────────────────────
    overlay.querySelectorAll(`input[name="${prefix}-fmt"]`).forEach(r =>
      r.addEventListener('change', () => {
        const isPng = _radio('fmt') === 'png';
        _$(prefix + '-png-opts').style.display = isPng ? 'block' : 'none';
        _$(prefix + '-ext-hint').textContent   = isPng ? '.png' : '.svg';
        if (isPng) _updateHint();
      }));

    if (_hasFullView) {
      overlay.querySelectorAll(`input[name="${prefix}-view"]`).forEach(r =>
        r.addEventListener('change', _updateHint));
    }

    _$(prefix + '-cancel').addEventListener('click', close);
    _$(prefix + '-download').addEventListener('click', _doExport);
  }

  // ── PNG size hint ────────────────────────────────────────────────────────

  function _updateHint() {
    const fullView = _hasFullView && _radio('view') === 'full';
    const dims     = fullView ? getFullDims() : getViewportDims();
    const pw       = Math.round(dims.width  * pngScale);
    const ph       = Math.round(dims.height * pngScale);
    const hint     = _$(prefix + '-png-opts')?.querySelector('p');
    if (hint) {
      const label = fullView ? 'full view height' : 'current viewport';
      hint.textContent = `Output size: ${pw} × ${ph} px (${pngScale}× ${label})`;
    }
  }

  // ── Export dispatch ──────────────────────────────────────────────────────

  async function _doExport() {
    const fmt         = _radio('fmt') || 'svg';
    const filename    = _$(prefix + '-filename')?.value.trim() || defaultFilename;
    const fullView    = _hasFullView && _radio('view') === 'full';
    const transparent = !(_$(prefix + '-bg')?.checked ?? true);

    if (fmt === 'png') {
      const dims   = fullView && _hasFullView ? getFullDims() : getViewportDims();
      const width  = Math.round(dims.width  * pngScale);
      const height = Math.round(dims.height * pngScale);
      const oc     = await buildPngCanvas({ width, height, fullView, transparent });
      const blob   = await oc.convertToBlob({ type: 'image/png' });
      if (_saveHandler) {
        _saveHandler({
          contentBase64: await blobToBase64(blob),
          base64:        true,
          filename:      `${filename}.png`,
          mimeType:      'image/png',
          filterName:    'PNG images',
          extensions:    ['png'],
        });
      } else {
        downloadBlob(blob, 'image/png', `${filename}.png`);
      }
    } else {
      const svgStr = await buildSvg({ fullView, transparent });
      if (!svgStr) return;
      if (_saveHandler) {
        _saveHandler({
          content:    svgStr,
          base64:     false,
          filename:   `${filename}.svg`,
          mimeType:   'image/svg+xml',
          filterName: 'SVG images',
          extensions: ['svg'],
        });
      } else {
        downloadBlob(svgStr, 'image/svg+xml', `${filename}.svg`);
      }
    }
    close();
  }

  // ── Print ────────────────────────────────────────────────────────────────

  /**
   * Print via SVG injection.  Builds the SVG for the current view, injects
   * it into a hidden `#pt-print-layer`, then triggers the OS print dialog.
   */
  async function doPrint() {
    if (!hasContent()) return;
    const svgStr = await buildSvg({ fullView: false, transparent: false });
    if (!svgStr) return;

    let layer = document.getElementById('pt-print-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'pt-print-layer';
      document.body.appendChild(layer);
    }
    layer.innerHTML = svgStr;

    const _cleanup = () => { layer.innerHTML = ''; };
    window.addEventListener('afterprint', _cleanup, { once: true });
    setTimeout(() => { if (layer.innerHTML) _cleanup(); }, 60_000);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (_printTrigger) {
        _printTrigger(layer);
      } else {
        window.print();
      }
    }));
  }

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    open,
    close,
    doPrint,
    setSaveHandler:  (fn) => { _saveHandler  = fn; },
    setPrintTrigger: (fn) => { _printTrigger = fn; },
  };
}

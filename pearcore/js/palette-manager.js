// palette-manager.js — Palette Manager dialog for pearcore-based apps.
//
// Two-tab modal (Categorical / Continuous) with a list + editor split layout
// matching the filter-manager pattern.  Built-in palettes from palettes.js
// are shown as non-deletable entries; user palettes are fully editable.
//
// Categorical editor:  colour-swatch table with add/remove/reorder (drag).
// Continuous editor:   multi-stop linear gradient builder with HSB sweep option.
//
// Persistence:  the host app is responsible for saving / restoring user palettes
// via the callbacks provided to createPaletteManager().
// ─────────────────────────────────────────────────────────────────────────────

import { CATEGORICAL_PALETTES, SEQUENTIAL_PALETTES,
         DEFAULT_CATEGORICAL_PALETTE, DEFAULT_SEQUENTIAL_PALETTE,
         hexToRgb, lerpSequential } from './palettes.js';
import { htmlEsc as esc } from './utils.js';

// ── Colour conversion helpers ────────────────────────────────────────────────

function _hexToHsb(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn)      h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h *= 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, b: max };
}

function _hsbToHex(h, s, b) {
  h = ((h % 360) + 360) % 360;
  const c = b * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = b - c;
  let r1, g1, b1;
  if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function _rgbToHex(r, g, b) {
  const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pt-user-palettes';

const _CONTINUOUS_MODES = [
  { value: 'stops',    label: 'Colour Stops' },
  { value: 'hsb-sweep', label: 'HSB Sweep' },
];

// ── Main factory ─────────────────────────────────────────────────────────────

/**
 * Create the palette-manager dialog controller.
 *
 * @param {Object}   opts
 * @param {Function} [opts.onPalettesChange] – (userCat, userSeq) called whenever user palettes are modified.
 *                                             Both are plain objects { name: string[] }.
 * @param {Function} [opts.showConfirm]      – (title, msg, opts) => Promise<boolean>
 * @param {Function} [opts.getUserPalettes]  – () => { categorical: {}, sequential: {} }
 * @returns {{ open, close, getUserCategorical, getUserSequential, getAllCategorical, getAllSequential }}
 */
export function createPaletteManager({ onPalettesChange, showConfirm, getUserPalettes } = {}) {

  // ── State ──────────────────────────────────────────────────────────────

  // User-defined palettes (mutable copies)
  let _userCat = {};   // name → string[]
  let _userSeq = {};   // name → string[]

  // Currently selected tab: 'categorical' | 'continuous'
  let _activeTab = 'categorical';
  // Currently selected palette name (per tab)
  let _selectedCat = null;
  let _selectedSeq = null;

  // Editing state
  let _editingName = null;  // name being edited (null = not editing)
  let _editDraft = null;    // { name, colours[] } or { name, stops[], mode, hsb }
  let _editDirty = false;

  // Drag state for categorical reorder
  let _dragIdx = -1;

  // ── Load persisted user palettes ───────────────────────────────────────

  function _loadUserPalettes() {
    if (getUserPalettes) {
      const p = getUserPalettes();
      _userCat = { ...(p?.categorical || {}) };
      _userSeq = { ...(p?.sequential || {}) };
    } else {
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        _userCat = { ...(raw.categorical || {}) };
        _userSeq = { ...(raw.sequential || {}) };
      } catch { _userCat = {}; _userSeq = {}; }
    }
  }

  function _notifyChange() {
    if (onPalettesChange) onPalettesChange({ ..._userCat }, { ..._userSeq });
    if (!getUserPalettes) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ categorical: _userCat, sequential: _userSeq }));
      } catch {}
    }
  }

  // ── All palettes (builtin + user) ──────────────────────────────────────

  function _allCat() {
    const all = {};
    for (const [k, v] of Object.entries(CATEGORICAL_PALETTES)) all[k] = { colours: v, builtin: true };
    for (const [k, v] of Object.entries(_userCat))              all[k] = { colours: v, builtin: false };
    return all;
  }

  function _allSeq() {
    const all = {};
    for (const [k, v] of Object.entries(SEQUENTIAL_PALETTES)) all[k] = { colours: v, builtin: true };
    for (const [k, v] of Object.entries(_userSeq))             all[k] = { colours: v, builtin: false };
    return all;
  }

  // ── DOM references (lazily resolved) ───────────────────────────────────

  let _overlay, _tabCat, _tabCont, _listEl, _editorEl;

  function _$(id) { return document.getElementById(id); }

  function _ensureDOM() {
    _overlay  = _$('palette-manager-overlay');
    _tabCat   = _$('pm-tab-categorical');
    _tabCont  = _$('pm-tab-continuous');
    _listEl   = _$('pm-list');
    _editorEl = _$('pm-editor');
  }

  // ── Open / Close ───────────────────────────────────────────────────────

  function open() {
    _ensureDOM();
    if (!_overlay) return;
    _loadUserPalettes();
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _setTab(_activeTab);
    _overlay.classList.add('open');
  }

  function close() {
    if (_overlay) _overlay.classList.remove('open');
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
  }

  // ── Tab switching ──────────────────────────────────────────────────────

  function _setTab(tab) {
    _activeTab = tab;
    _editingName = null;
    _editDraft = null;
    _editDirty = false;

    if (_tabCat && _tabCont) {
      _tabCat.classList.toggle('active', tab === 'categorical');
      _tabCont.classList.toggle('active', tab === 'continuous');
    }
    _renderList();
    _renderEditor();
  }

  // ── List pane ──────────────────────────────────────────────────────────

  function _renderList() {
    if (!_listEl) return;
    const isCat = _activeTab === 'categorical';
    const all = isCat ? _allCat() : _allSeq();
    const selected = isCat ? _selectedCat : _selectedSeq;

    if (Object.keys(all).length === 0) {
      _listEl.innerHTML = '<div class="pm-empty">No palettes defined.</div>';
      return;
    }

    let html = '';
    for (const [name, entry] of Object.entries(all)) {
      const active = name === selected ? ' active' : '';
      const builtinCls = entry.builtin ? ' pm-builtin' : '';
      // Mini gradient/swatch preview
      const preview = isCat
        ? _catSwatchPreviewHTML(entry.colours)
        : _seqGradientPreviewHTML(entry.colours);
      html += `<div class="pm-list-row${active}${builtinCls}" data-name="${esc(name)}">
        <div class="pm-list-info">
          <span class="pm-list-name">${esc(name)}</span>
          <div class="pm-list-preview">${preview}</div>
        </div>
        <div class="pm-list-actions">
          ${!entry.builtin ? `<button class="btn btn-xs btn-outline-secondary pm-edit-btn" title="Edit"><i class="bi bi-pencil"></i></button>` : ''}
          <button class="btn btn-xs btn-outline-secondary pm-dup-btn" title="Duplicate"><i class="bi bi-copy"></i></button>
          ${!entry.builtin ? `<button class="btn btn-xs btn-outline-danger pm-del-btn" title="Delete"><i class="bi bi-trash"></i></button>` : ''}
        </div>
      </div>`;
    }
    _listEl.innerHTML = html;

    // Wire click handlers
    for (const row of _listEl.querySelectorAll('.pm-list-row')) {
      const name = row.dataset.name;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pm-edit-btn, .pm-dup-btn, .pm-del-btn')) return;
        _selectPalette(name);
      });
      const editBtn = row.querySelector('.pm-edit-btn');
      if (editBtn) editBtn.addEventListener('click', () => _startEdit(name));
      const dupBtn = row.querySelector('.pm-dup-btn');
      if (dupBtn) dupBtn.addEventListener('click', () => _duplicatePalette(name));
      const delBtn = row.querySelector('.pm-del-btn');
      if (delBtn) delBtn.addEventListener('click', () => _deletePalette(name));
    }
  }

  function _catSwatchPreviewHTML(colours) {
    return colours.slice(0, 12).map(c =>
      `<span class="pm-mini-swatch" style="background:${c}"></span>`
    ).join('');
  }

  function _seqGradientPreviewHTML(stops) {
    if (!stops || stops.length === 0) return '';
    const grad = stops.length === 1
      ? stops[0]
      : `linear-gradient(to right, ${stops.join(', ')})`;
    return `<span class="pm-mini-gradient" style="background:${grad}"></span>`;
  }

  function _selectPalette(name) {
    if (_activeTab === 'categorical') _selectedCat = name;
    else _selectedSeq = name;
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _renderList();
    _renderEditor();
  }

  // ── Editor pane ────────────────────────────────────────────────────────

  function _renderEditor() {
    if (!_editorEl) return;

    // If editing, show the editor
    if (_editDraft) {
      if (_activeTab === 'categorical') _renderCatEditor();
      else _renderSeqEditor();
      return;
    }

    // If a palette is selected, show a read-only preview
    const isCat = _activeTab === 'categorical';
    const selected = isCat ? _selectedCat : _selectedSeq;
    const all = isCat ? _allCat() : _allSeq();
    if (selected && all[selected]) {
      _renderPreview(selected, all[selected], isCat);
      return;
    }

    _editorEl.innerHTML = '<div class="pm-editor-empty">Select a palette or create a new one.</div>';
  }

  function _renderPreview(name, entry, isCat) {
    const isBuiltin = entry.builtin;
    let html = `<div class="pm-editor-header">
      <div class="pm-name-display">${esc(name)}${isBuiltin ? ' <span class="pm-builtin-badge">built-in</span>' : ''}</div>
    </div>`;
    html += `<div class="pm-preview-content">`;
    if (isCat) {
      html += '<div class="pm-swatch-grid">';
      for (const c of entry.colours) {
        html += `<div class="pm-swatch-cell">
          <span class="pm-swatch" style="background:${c}"></span>
          <span class="pm-swatch-label">${c}</span>
        </div>`;
      }
      html += '</div>';
    } else {
      html += _seqPreviewHTML(entry.colours);
    }
    html += `</div>`;
    _editorEl.innerHTML = html;
  }

  function _seqPreviewHTML(stops) {
    if (!stops || stops.length === 0) return '';
    const grad = stops.length === 1
      ? stops[0]
      : `linear-gradient(to right, ${stops.join(', ')})`;
    let html = `<div class="pm-gradient-bar" style="background:${grad}"></div>`;
    html += '<div class="pm-stop-labels">';
    for (const s of stops) {
      html += `<span class="pm-stop-label"><span class="pm-mini-swatch" style="background:${s}"></span> ${s}</span>`;
    }
    html += '</div>';
    return html;
  }

  // ── Categorical Editor ─────────────────────────────────────────────────

  function _renderCatEditor() {
    const draft = _editDraft;
    if (!draft) return;

    let html = `<div class="pm-editor-header">
      <div class="pm-name-row">
        <label class="pm-label">Name</label>
        <input class="pm-name-input" id="pm-cat-name" value="${esc(draft.name)}" spellcheck="false">
      </div>
    </div>`;

    html += '<div class="pm-cat-colours" id="pm-cat-colours">';
    for (let i = 0; i < draft.colours.length; i++) {
      const c = draft.colours[i];
      html += `<div class="pm-cat-row" draggable="true" data-idx="${i}">
        <span class="pm-drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
        <input type="color" class="pm-colour-input" value="${c}" data-idx="${i}">
        <span class="pm-swatch" style="background:${c}"></span>
        <input type="text" class="pm-hex-input" value="${c}" data-idx="${i}" spellcheck="false" maxlength="7">
        <button class="btn btn-xs btn-outline-danger pm-remove-colour" data-idx="${i}" title="Remove colour"${draft.colours.length <= 2 ? ' disabled' : ''}>
          <i class="bi bi-x-lg"></i>
        </button>
      </div>`;
    }
    html += '</div>';

    html += `<div class="pm-cat-actions">
      <button class="btn btn-xs btn-outline-secondary" id="pm-cat-add"><i class="bi bi-plus me-1"></i>Add Colour</button>
    </div>`;

    html += `<div class="pm-editor-footer">
      <button class="btn btn-sm btn-secondary" id="pm-edit-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="pm-edit-save">Save</button>
    </div>`;

    _editorEl.innerHTML = html;
    _wireCatEditor();
  }

  function _wireCatEditor() {
    const nameInput = _$('pm-cat-name');
    const coloursEl = _$('pm-cat-colours');

    // Name change
    nameInput?.addEventListener('input', () => {
      _editDraft.name = nameInput.value.trim();
      _editDirty = true;
    });

    // Colour inputs
    for (const inp of coloursEl?.querySelectorAll('.pm-colour-input') || []) {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx);
        _editDraft.colours[idx] = inp.value;
        _editDirty = true;
        _renderCatEditor();
      });
    }

    // Hex text inputs
    for (const inp of coloursEl?.querySelectorAll('.pm-hex-input') || []) {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        let val = inp.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-f]{6}$/i.test(val)) {
          _editDraft.colours[idx] = val.toLowerCase();
          _editDirty = true;
          _renderCatEditor();
        } else {
          inp.value = _editDraft.colours[idx];
        }
      });
    }

    // Remove colour buttons
    for (const btn of coloursEl?.querySelectorAll('.pm-remove-colour') || []) {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (_editDraft.colours.length > 2) {
          _editDraft.colours.splice(idx, 1);
          _editDirty = true;
          _renderCatEditor();
        }
      });
    }

    // Add colour
    _$('pm-cat-add')?.addEventListener('click', () => {
      // Default to a neutral mid-grey; user immediately picks via the native picker
      _editDraft.colours.push('#888888');
      _editDirty = true;
      _renderCatEditor();
    });

    // Drag-and-drop reorder
    for (const row of coloursEl?.querySelectorAll('.pm-cat-row') || []) {
      row.addEventListener('dragstart', (e) => {
        _dragIdx = parseInt(row.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('pm-dragging');
      });
      row.addEventListener('dragend', () => {
        _dragIdx = -1;
        row.classList.remove('pm-dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('pm-drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('pm-drag-over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('pm-drag-over');
        const toIdx = parseInt(row.dataset.idx);
        if (_dragIdx >= 0 && _dragIdx !== toIdx) {
          const [moved] = _editDraft.colours.splice(_dragIdx, 1);
          _editDraft.colours.splice(toIdx, 0, moved);
          _editDirty = true;
          _renderCatEditor();
        }
      });
    }

    // Save / Cancel
    _$('pm-edit-cancel')?.addEventListener('click', _cancelEdit);
    _$('pm-edit-save')?.addEventListener('click', _saveCatEdit);
  }

  // ── Continuous Editor ──────────────────────────────────────────────────

  function _renderSeqEditor() {
    const draft = _editDraft;
    if (!draft) return;

    const mode = draft.mode || 'stops';

    let html = `<div class="pm-editor-header">
      <div class="pm-name-row">
        <label class="pm-label">Name</label>
        <input class="pm-name-input" id="pm-seq-name" value="${esc(draft.name)}" spellcheck="false">
      </div>
      <div class="pm-mode-row">
        <label class="pm-label">Mode</label>
        <select class="pm-sel" id="pm-seq-mode">
          ${_CONTINUOUS_MODES.map(m =>
            `<option value="${m.value}"${m.value === mode ? ' selected' : ''}>${esc(m.label)}</option>`
          ).join('')}
        </select>
      </div>
    </div>`;

    // Preview bar
    const previewStops = _computeSeqStops(draft);
    html += _seqPreviewHTML(previewStops);

    if (mode === 'stops') {
      html += _renderStopsEditor(draft);
    } else if (mode === 'hsb-sweep') {
      html += _renderHsbEditor(draft);
    }

    html += `<div class="pm-editor-footer">
      <button class="btn btn-sm btn-secondary" id="pm-edit-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="pm-edit-save">Save</button>
    </div>`;

    _editorEl.innerHTML = html;
    _wireSeqEditor(mode);
  }

  function _renderStopsEditor(draft) {
    const stops = draft.stops || ['#2aa198', '#dc322f'];
    let html = '<div class="pm-seq-stops" id="pm-seq-stops">';
    for (let i = 0; i < stops.length; i++) {
      html += `<div class="pm-cat-row" data-idx="${i}">
        <span class="pm-stop-num">${i + 1}</span>
        <input type="color" class="pm-colour-input" value="${stops[i]}" data-idx="${i}">
        <span class="pm-swatch" style="background:${stops[i]}"></span>
        <input type="text" class="pm-hex-input" value="${stops[i]}" data-idx="${i}" spellcheck="false" maxlength="7">
        <button class="btn btn-xs btn-outline-danger pm-remove-stop" data-idx="${i}" title="Remove stop"${stops.length <= 2 ? ' disabled' : ''}>
          <i class="bi bi-x-lg"></i>
        </button>
      </div>`;
    }
    html += '</div>';

    html += `<div class="pm-cat-actions">
      <button class="btn btn-xs btn-outline-secondary" id="pm-seq-add-stop"><i class="bi bi-plus me-1"></i>Add Stop</button>
      <span class="pm-hint">Add 2+ stops for a gradient</span>
    </div>`;

    // Option: base on a categorical palette
    const catNames = Object.keys({ ...CATEGORICAL_PALETTES, ..._userCat });
    html += `<div class="pm-from-cat-row">
      <label class="pm-label">From categorical</label>
      <select class="pm-sel" id="pm-seq-from-cat">
        <option value="">— choose —</option>
        ${catNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
      </select>
    </div>`;

    return html;
  }

  function _renderHsbEditor(draft) {
    const hsb = draft.hsb || { h1: 0, s1: 0.8, b1: 0.8, h2: 240, s2: 0.8, b2: 0.8, steps: 8 };

    let html = '<div class="pm-hsb-controls">';

    html += `<div class="pm-hsb-row">
      <label class="pm-label pm-hsb-label">Start</label>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">H</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-h1" min="0" max="360" step="1" value="${hsb.h1}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-h1-num" min="0" max="360" value="${hsb.h1}">
      </div>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">S</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-s1" min="0" max="100" step="1" value="${Math.round(hsb.s1 * 100)}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-s1-num" min="0" max="100" value="${Math.round(hsb.s1 * 100)}">
      </div>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">B</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-b1" min="0" max="100" step="1" value="${Math.round(hsb.b1 * 100)}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-b1-num" min="0" max="100" value="${Math.round(hsb.b1 * 100)}">
      </div>
      <span class="pm-swatch" id="pm-hsb-preview1" style="background:${_hsbToHex(hsb.h1, hsb.s1, hsb.b1)}"></span>
    </div>`;

    html += `<div class="pm-hsb-row">
      <label class="pm-label pm-hsb-label">End</label>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">H</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-h2" min="0" max="360" step="1" value="${hsb.h2}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-h2-num" min="0" max="360" value="${hsb.h2}">
      </div>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">S</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-s2" min="0" max="100" step="1" value="${Math.round(hsb.s2 * 100)}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-s2-num" min="0" max="100" value="${Math.round(hsb.s2 * 100)}">
      </div>
      <div class="pm-hsb-group">
        <label class="pm-hsb-sub">B</label>
        <input type="range" class="pm-hsb-range" id="pm-hsb-b2" min="0" max="100" step="1" value="${Math.round(hsb.b2 * 100)}">
        <input type="number" class="pm-hsb-num" id="pm-hsb-b2-num" min="0" max="100" value="${Math.round(hsb.b2 * 100)}">
      </div>
      <span class="pm-swatch" id="pm-hsb-preview2" style="background:${_hsbToHex(hsb.h2, hsb.s2, hsb.b2)}"></span>
    </div>`;

    html += `<div class="pm-hsb-row">
      <label class="pm-label pm-hsb-label">Steps</label>
      <input type="range" class="pm-hsb-range pm-hsb-steps-range" id="pm-hsb-steps" min="2" max="24" step="1" value="${hsb.steps}">
      <input type="number" class="pm-hsb-num" id="pm-hsb-steps-num" min="2" max="24" value="${hsb.steps}">
    </div>`;

    html += '</div>';
    return html;
  }

  function _wireSeqEditor(mode) {
    const nameInput = _$('pm-seq-name');
    nameInput?.addEventListener('input', () => {
      _editDraft.name = nameInput.value.trim();
      _editDirty = true;
    });

    // Mode select
    _$('pm-seq-mode')?.addEventListener('change', (e) => {
      _editDraft.mode = e.target.value;
      _editDirty = true;
      // Initialize HSB defaults if switching to hsb-sweep
      if (e.target.value === 'hsb-sweep' && !_editDraft.hsb) {
        const s0 = _editDraft.stops?.[0] || '#2aa198';
        const sN = _editDraft.stops?.[_editDraft.stops.length - 1] || '#dc322f';
        const start = _hexToHsb(s0);
        const end = _hexToHsb(sN);
        _editDraft.hsb = {
          h1: Math.round(start.h), s1: start.s, b1: start.b,
          h2: Math.round(end.h), s2: end.s, b2: end.b,
          steps: _editDraft.stops?.length || 8,
        };
      }
      _renderSeqEditor();
    });

    if (mode === 'stops') {
      _wireStopsEditor();
    } else if (mode === 'hsb-sweep') {
      _wireHsbEditor();
    }

    _$('pm-edit-cancel')?.addEventListener('click', _cancelEdit);
    _$('pm-edit-save')?.addEventListener('click', _saveSeqEdit);
  }

  function _wireStopsEditor() {
    const stopsEl = _$('pm-seq-stops');

    // Colour inputs
    for (const inp of stopsEl?.querySelectorAll('.pm-colour-input') || []) {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx);
        _editDraft.stops[idx] = inp.value;
        _editDirty = true;
        _renderSeqEditor();
      });
    }

    // Hex text inputs
    for (const inp of stopsEl?.querySelectorAll('.pm-hex-input') || []) {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        let val = inp.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-f]{6}$/i.test(val)) {
          _editDraft.stops[idx] = val.toLowerCase();
          _editDirty = true;
          _renderSeqEditor();
        } else {
          inp.value = _editDraft.stops[idx];
        }
      });
    }

    // Remove stop
    for (const btn of stopsEl?.querySelectorAll('.pm-remove-stop') || []) {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (_editDraft.stops.length > 2) {
          _editDraft.stops.splice(idx, 1);
          _editDirty = true;
          _renderSeqEditor();
        }
      });
    }

    // Add stop
    _$('pm-seq-add-stop')?.addEventListener('click', () => {
      // Interpolate midpoint of the last two stops
      const stops = _editDraft.stops;
      const last = stops[stops.length - 1] || '#888888';
      const prev = stops[stops.length - 2] || '#888888';
      const mid = lerpSequential(0.5, [prev, last]);
      // Convert rgb() to hex
      const m = mid.match(/\d+/g);
      const hex = m ? _rgbToHex(+m[0], +m[1], +m[2]) : '#888888';
      stops.push(hex);
      _editDirty = true;
      _renderSeqEditor();
    });

    // From categorical
    _$('pm-seq-from-cat')?.addEventListener('change', (e) => {
      const catName = e.target.value;
      if (!catName) return;
      const catAll = { ...CATEGORICAL_PALETTES, ..._userCat };
      const colours = catAll[catName];
      if (colours && colours.length >= 2) {
        _editDraft.stops = [...colours];
        _editDirty = true;
        _renderSeqEditor();
      }
    });
  }

  function _wireHsbEditor() {
    const hsb = _editDraft.hsb;
    if (!hsb) return;

    const pairs = [
      ['pm-hsb-h1', 'pm-hsb-h1-num', 'h1', 1],
      ['pm-hsb-s1', 'pm-hsb-s1-num', 's1', 0.01],
      ['pm-hsb-b1', 'pm-hsb-b1-num', 'b1', 0.01],
      ['pm-hsb-h2', 'pm-hsb-h2-num', 'h2', 1],
      ['pm-hsb-s2', 'pm-hsb-s2-num', 's2', 0.01],
      ['pm-hsb-b2', 'pm-hsb-b2-num', 'b2', 0.01],
      ['pm-hsb-steps', 'pm-hsb-steps-num', 'steps', 1],
    ];

    for (const [rangeId, numId, key, scale] of pairs) {
      const range = _$(rangeId);
      const num = _$(numId);
      if (!range || !num) continue;

      const update = (val) => {
        hsb[key] = val * scale;
        _editDirty = true;
        _updateHsbPreview();
      };

      range.addEventListener('input', () => {
        const val = parseFloat(range.value);
        num.value = val;
        update(val);
      });

      num.addEventListener('change', () => {
        let val = parseFloat(num.value);
        val = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), val));
        num.value = val;
        range.value = val;
        update(val);
      });
    }
  }

  function _updateHsbPreview() {
    const hsb = _editDraft?.hsb;
    if (!hsb) return;

    // Update start/end swatch previews
    const p1 = _$('pm-hsb-preview1');
    const p2 = _$('pm-hsb-preview2');
    if (p1) p1.style.background = _hsbToHex(hsb.h1, hsb.s1, hsb.b1);
    if (p2) p2.style.background = _hsbToHex(hsb.h2, hsb.s2, hsb.b2);

    // Update gradient bar
    const stops = _computeSeqStops(_editDraft);
    const gradBar = _editorEl?.querySelector('.pm-gradient-bar');
    if (gradBar && stops.length >= 2) {
      gradBar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    }

    // Update stop labels
    const labelsEl = _editorEl?.querySelector('.pm-stop-labels');
    if (labelsEl) {
      labelsEl.innerHTML = stops.map(s =>
        `<span class="pm-stop-label"><span class="pm-mini-swatch" style="background:${s}"></span> ${s}</span>`
      ).join('');
    }
  }

  // ── Compute final stop colours ─────────────────────────────────────────

  function _computeSeqStops(draft) {
    if (!draft) return [];
    const mode = draft.mode || 'stops';
    if (mode === 'stops') return draft.stops || [];
    if (mode === 'hsb-sweep') {
      const hsb = draft.hsb;
      if (!hsb) return [];
      const n = Math.max(2, hsb.steps || 8);
      const result = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        const h = hsb.h1 + t * (hsb.h2 - hsb.h1);
        const s = hsb.s1 + t * (hsb.s2 - hsb.s1);
        const b = hsb.b1 + t * (hsb.b2 - hsb.b1);
        result.push(_hsbToHex(h, s, b));
      }
      return result;
    }
    return [];
  }

  // ── Edit / Duplicate / Delete ──────────────────────────────────────────

  function _startEdit(name) {
    const isCat = _activeTab === 'categorical';
    const all = isCat ? _allCat() : _allSeq();
    const entry = all[name];
    if (!entry || entry.builtin) return;

    _editingName = name;
    if (isCat) {
      _selectedCat = name;
      _editDraft = { name, colours: [...entry.colours] };
    } else {
      _selectedSeq = name;
      _editDraft = { name, stops: [...entry.colours], mode: 'stops', hsb: null };
    }
    _editDirty = false;
    _renderList();
    _renderEditor();
  }

  function _duplicatePalette(name) {
    const isCat = _activeTab === 'categorical';
    const all = isCat ? _allCat() : _allSeq();
    const entry = all[name];
    if (!entry) return;

    // Generate unique name
    let newName = name + ' Copy';
    let n = 2;
    while (all[newName]) { newName = name + ' Copy ' + n; n++; }

    if (isCat) {
      _userCat[newName] = [...entry.colours];
      _selectedCat = newName;
    } else {
      _userSeq[newName] = [...entry.colours];
      _selectedSeq = newName;
    }
    _notifyChange();

    // Open the duplicate in edit mode immediately
    _editingName = newName;
    if (isCat) {
      _editDraft = { name: newName, colours: [...entry.colours] };
    } else {
      _editDraft = { name: newName, stops: [...entry.colours], mode: 'stops', hsb: null };
    }
    _editDirty = false;
    _renderList();
    _renderEditor();
  }

  async function _deletePalette(name) {
    const isCat = _activeTab === 'categorical';
    const all = isCat ? _allCat() : _allSeq();
    if (!all[name] || all[name].builtin) return;

    const ok = showConfirm
      ? await showConfirm('Delete Palette', `Delete "${name}"?`)
      : confirm(`Delete "${name}"?`);
    if (!ok) return;

    if (isCat) {
      delete _userCat[name];
      if (_selectedCat === name) _selectedCat = null;
    } else {
      delete _userSeq[name];
      if (_selectedSeq === name) _selectedSeq = null;
    }
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _notifyChange();
    _renderList();
    _renderEditor();
  }

  function _cancelEdit() {
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _renderEditor();
  }

  async function _saveCatEdit() {
    if (!_editDraft) return;
    const newName = _editDraft.name;
    if (!newName) return;

    // Check for duplicate name
    const allNames = { ...CATEGORICAL_PALETTES, ..._userCat };
    if (_editingName !== newName && allNames[newName]) {
      const ok = showConfirm
        ? await showConfirm('Overwrite Palette', `A palette named "${newName}" already exists. Overwrite?`)
        : confirm(`A palette named "${newName}" already exists. Overwrite?`);
      if (!ok) return;
    }

    // Remove old name if renamed
    if (_editingName && _editingName !== newName) {
      delete _userCat[_editingName];
    }

    _userCat[newName] = [..._editDraft.colours];
    _selectedCat = newName;
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _notifyChange();
    _renderList();
    _renderEditor();
  }

  async function _saveSeqEdit() {
    if (!_editDraft) return;
    const newName = _editDraft.name;
    if (!newName) return;

    // Check for duplicate name
    const allNames = { ...SEQUENTIAL_PALETTES, ..._userSeq };
    if (_editingName !== newName && allNames[newName]) {
      const ok = showConfirm
        ? await showConfirm('Overwrite Palette', `A palette named "${newName}" already exists. Overwrite?`)
        : confirm(`A palette named "${newName}" already exists. Overwrite?`);
      if (!ok) return;
    }

    // Remove old name if renamed
    if (_editingName && _editingName !== newName) {
      delete _userSeq[_editingName];
    }

    // Save computed stops
    const stops = _computeSeqStops(_editDraft);
    _userSeq[newName] = stops;
    _selectedSeq = newName;
    _editingName = null;
    _editDraft = null;
    _editDirty = false;
    _notifyChange();
    _renderList();
    _renderEditor();
  }

  // ── New palette ────────────────────────────────────────────────────────

  function _newPalette() {
    const isCat = _activeTab === 'categorical';
    const all = isCat ? _allCat() : _allSeq();

    let baseName = isCat ? 'Custom Palette' : 'Custom Gradient';
    let name = baseName;
    let n = 2;
    while (all[name]) { name = baseName + ' ' + n; n++; }

    if (isCat) {
      _userCat[name] = ['#2aa198', '#dc322f', '#268bd2', '#d33682'];
      _selectedCat = name;
      _editingName = name;
      _editDraft = { name, colours: [..._userCat[name]] };
    } else {
      _userSeq[name] = ['#2aa198', '#dc322f'];
      _selectedSeq = name;
      _editingName = name;
      _editDraft = { name, stops: ['#2aa198', '#dc322f'], mode: 'stops', hsb: null };
    }
    _editDirty = false;
    _notifyChange();
    _renderList();
    _renderEditor();
  }

  // ── Wire static DOM ────────────────────────────────────────────────────

  // Deferred wiring — called on first open()
  let _wired = false;
  function _wireOnce() {
    if (_wired) return;
    _wired = true;

    _$('palette-manager-close')?.addEventListener('click', close);
    _$('palette-manager-close-footer')?.addEventListener('click', close);
    _$('pm-tab-categorical')?.addEventListener('click', () => _setTab('categorical'));
    _$('pm-tab-continuous')?.addEventListener('click', () => _setTab('continuous'));
    _$('pm-new-btn')?.addEventListener('click', _newPalette);

    // Close on backdrop click
    _overlay?.addEventListener('click', (e) => {
      if (e.target === _overlay) close();
    });
  }

  // Override open to also do one-time wiring
  const _origOpen = open;
  function openWithWire() {
    _ensureDOM();
    _wireOnce();
    _origOpen();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  // Load persisted user palettes eagerly so getUserCategorical/getUserSequential
  // return the correct values immediately (before the dialog is opened).
  _loadUserPalettes();

  return {
    open:  openWithWire,
    close,
    getUserCategorical: () => ({ ..._userCat }),
    getUserSequential:  () => ({ ..._userSeq }),
    getAllCategorical:   () => {
      const r = {};
      for (const k of Object.keys(CATEGORICAL_PALETTES)) r[k] = CATEGORICAL_PALETTES[k];
      for (const k of Object.keys(_userCat)) r[k] = _userCat[k];
      return r;
    },
    getAllSequential: () => {
      const r = {};
      for (const k of Object.keys(SEQUENTIAL_PALETTES)) r[k] = SEQUENTIAL_PALETTES[k];
      for (const k of Object.keys(_userSeq)) r[k] = _userSeq[k];
      return r;
    },
  };
}

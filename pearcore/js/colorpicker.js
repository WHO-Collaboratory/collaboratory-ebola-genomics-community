// colorpicker.js — reusable swatch + native-colour-picker popup widget.

const RECENT_COLOURS_KEY = 'pt-recent-colours';
const MAX_RECENT = 8;

let _recentColours = (() => {
  try { return JSON.parse(localStorage.getItem(RECENT_COLOURS_KEY) || '[]'); }
  catch { return []; }
})();

function _saveRecent() {
  try { localStorage.setItem(RECENT_COLOURS_KEY, JSON.stringify(_recentColours)); } catch {}
}

export function addRecentColour(hex) {
  hex = hex.toLowerCase();
  _recentColours = [hex, ..._recentColours.filter(c => c !== hex)].slice(0, MAX_RECENT);
  _saveRecent();
}

export function normaliseHex(h) {
  if (!h) return null;
  h = h.trim();
  if (/^#[0-9a-f]{3}$/i.test(h))
    h = '#' + h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
  return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null;
}

function _buildPopup(opts) {
  const { palettes, onPick, onNative, getCurrentHex } = opts;
  const popup = document.createElement('div');
  popup.className = 'pt-cp-popup';
  const nativeRow = document.createElement('div');
  nativeRow.className = 'pt-cp-native-row';
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.title = 'Open colour picker…';
  nativeInput.className = 'pt-cp-native-input';
  const nativeLabel = document.createElement('span');
  nativeLabel.textContent = 'Custom colour…';
  nativeLabel.style.cssText = 'font-size:0.75rem;color:var(--pt-text-status-sep)';
  nativeInput.addEventListener('input', (e) => {
    e.stopPropagation();
    const hex = e.target.value;
    if (onNative) onNative(hex);
    onPick(hex);
  });
  nativeRow.appendChild(nativeInput);
  nativeRow.appendChild(nativeLabel);
  popup.appendChild(nativeRow);
  const recentRow = document.createElement('div');
  recentRow.className = 'pt-cp-row';
  const recentLabel = document.createElement('span');
  recentLabel.className = 'pt-cp-label';
  recentLabel.textContent = 'Recent';
  const recentSwatches = document.createElement('div');
  recentSwatches.className = 'pt-cp-swatches';
  recentRow.appendChild(recentLabel);
  recentRow.appendChild(recentSwatches);
  popup.appendChild(recentRow);
  const hr = document.createElement('hr');
  hr.className = 'pt-cp-divider';
  popup.appendChild(hr);
  const palettesEl = document.createElement('div');
  popup.appendChild(palettesEl);
  function render() {
    const curHex = getCurrentHex?.() ?? '';
    recentSwatches.innerHTML = '';
    if (_recentColours.length === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size:0.65rem;color:rgba(242,241,230,0.3);font-style:italic';
      empty.textContent = '—';
      recentSwatches.appendChild(empty);
    } else {
      for (const hex of _recentColours)
        recentSwatches.appendChild(_makeSwatch(hex, curHex, onPick));
    }
    palettesEl.innerHTML = '';
    for (const [name, colours] of Object.entries(palettes)) {
      const row = document.createElement('div');
      row.className = 'pt-cp-row';
      const label = document.createElement('span');
      label.className = 'pt-cp-label';
      label.textContent = name;
      const swatches = document.createElement('div');
      swatches.className = 'pt-cp-swatches';
      for (const hex of colours)
        swatches.appendChild(_makeSwatch(hex, curHex, onPick));
      row.appendChild(label);
      row.appendChild(swatches);
      palettesEl.appendChild(row);
    }
    if (curHex) nativeInput.value = curHex;
  }
  return { popup, render, nativeInput };
}

function _makeSwatch(hex, curHex, onPick) {
  const s = document.createElement('div');
  s.className = 'pt-cp-swatch';
  s.style.background = hex;
  s.title = hex;
  if (curHex && curHex.toLowerCase() === hex) s.classList.add('selected');
  s.addEventListener('click', (e) => { e.stopPropagation(); onPick(hex); });
  return s;
}

const _openPopups = new Set();
document.addEventListener('click', (e) => {
  for (const { popup, triggerEl, close } of _openPopups) {
    if (!popup.contains(e.target) && e.target !== triggerEl) close();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const { close } of [..._openPopups]) close();
});

export function createToolbarColourPicker({ root, palettes, $ : _$ }) {
  const get = _$ ?? (id => document.getElementById(id));
  const valueInput    = get('btn-node-colour');
  const triggerBtn    = get('btn-colour-trigger');
  const triggerSwatch = get('btn-colour-trigger-swatch');
  const popup         = get('colour-picker-popup');
  const nativeOpenEl  = get('btn-colour-native-open');
  const recentEl      = get('colour-picker-recent');
  const palettesEl    = get('colour-picker-palettes');
  if (!triggerBtn || !popup) return null;
  function getCurrentHex() { return valueInput?.value?.toLowerCase() ?? '#ff8800'; }
  function setValue(hex) {
    if (valueInput) valueInput.value = hex;
    if (nativeOpenEl) nativeOpenEl.value = hex;
    if (triggerSwatch) triggerSwatch.style.background = hex;
  }
  function _renderPopup() {
    const curHex = getCurrentHex();
    if (nativeOpenEl) nativeOpenEl.value = curHex;
    if (recentEl) {
      recentEl.innerHTML = '';
      if (_recentColours.length === 0) {
        const empty = document.createElement('span');
        empty.style.cssText = 'font-size:0.65rem;color:rgba(242,241,230,0.3);font-style:italic';
        empty.textContent = '—';
        recentEl.appendChild(empty);
      } else {
        for (const hex of _recentColours)
          recentEl.appendChild(_makeSwatch(hex, curHex, (h) => { setValue(h); close(); }));
      }
    }
    if (palettesEl) {
      palettesEl.innerHTML = '';
      for (const [name, colours] of Object.entries(palettes)) {
        const row = document.createElement('div');
        row.className = 'pt-cp-row';
        const label = document.createElement('span');
        label.className = 'pt-cp-label';
        label.textContent = name;
        const swatches = document.createElement('div');
        swatches.className = 'pt-cp-swatches';
        for (const hex of colours)
          swatches.appendChild(_makeSwatch(hex, curHex, (h) => { setValue(h); close(); }));
        row.appendChild(label);
        row.appendChild(swatches);
        palettesEl.appendChild(row);
      }
    }
  }
  function open() { _renderPopup(); popup.classList.add('open'); _openPopups.add(entry); }
  function close() { popup.classList.remove('open'); _openPopups.delete(entry); }
  const entry = { popup, triggerEl: triggerBtn, close };
  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.contains('open') ? close() : open();
  });
  if (nativeOpenEl) {
    nativeOpenEl.addEventListener('input', (e) => { e.stopPropagation(); setValue(e.target.value); });
  }
  return { getValue: getCurrentHex, setValue, addRecent: addRecentColour, normaliseHex, open, close };
}

export function createPaletteColourPicker(inputEl, { palettes }) {
  if (!inputEl) return null;
  inputEl.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
  const _nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(inputEl, 'value', {
    get() { return _nativeValueDesc.get.call(this); },
    set(v) { _nativeValueDesc.set.call(this, v); if (swatch) swatch.style.background = v || '#888888'; },
    configurable: true,
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pt-pcp-trigger';
  btn.title = inputEl.closest('[title]')?.title ?? 'Choose colour';
  const swatch = document.createElement('span');
  swatch.className = 'pt-pcp-swatch';
  swatch.style.background = inputEl.value || '#888888';
  btn.appendChild(swatch);
  inputEl.insertAdjacentElement('afterend', btn);
  const { popup, render } = _buildPopup({
    palettes,
    getCurrentHex: () => inputEl.value.toLowerCase(),
    onPick: (hex) => {
      setValue(hex);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      addRecentColour(hex);
      close();
    },
  });
  popup.className += ' pt-pcp-popup';
  document.body.appendChild(popup);
  function getValue() { return inputEl.value; }
  function setValue(hex) { inputEl.value = hex; swatch.style.background = hex; }
  function open() {
    render();
    const rect = btn.getBoundingClientRect();
    const estH = 280;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceAbove >= estH || spaceAbove > spaceBelow) {
      popup.style.top = 'auto';
      popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
      popup.style.bottom = 'auto';
    }
    const pad = 8, gap = 6;
    const popupW = popup.offsetWidth || 220;
    let left = rect.left;
    if (rect.left > (window.innerWidth * 0.5)) left = rect.left - popupW - gap;
    if (left < pad) left = pad;
    if (left + popupW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - popupW - pad);
    popup.style.left = left + 'px';
    popup.classList.add('open');
    _openPopups.add(entry);
  }
  function close() { popup.classList.remove('open'); _openPopups.delete(entry); }
  const entry = { popup, triggerEl: btn, close };
  btn.addEventListener('click', (e) => { e.stopPropagation(); popup.classList.contains('open') ? close() : open(); });
  const row = inputEl.closest('.pt-palette-row');
  if (row?.title) btn.title = row.title;
  return { getValue, setValue, open, close };
}

export function upgradeAllPaletteColourPickers(containerEl, opts) {
  const map = new Map();
  for (const el of containerEl.querySelectorAll('input.pt-palette-color[type="color"]')) {
    map.set(el, createPaletteColourPicker(el, opts));
  }
  return map;
}

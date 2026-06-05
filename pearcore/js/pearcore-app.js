/**
 * pearcore-app.js — Application lifecycle utilities for pearcore-based apps.
 *
 * Provides reusable factories for theme management, embed config resolution,
 * section accordion behaviour, and dynamic asset loading.
 */

// ── Theme Manager ─────────────────────────────────────────────────────────

/**
 * Create a theme manager that handles the theme registry, CRUD operations
 * (store, remove, export, import), inherit-chain resolution, and select UI.
 *
 * The caller provides app-specific callbacks for building theme snapshots,
 * applying theme values to the DOM, and persisting settings.
 *
 * @param {object} opts
 * @param {object}  opts.builtInThemes       - Built-in theme definitions (name → object)
 * @param {object}  opts.defaultThemeData    - DEFAULT_THEME base object (all keys)
 * @param {string[]} [opts.requiredThemeKeys] - Keys that must be present in defaultThemeData
 * @param {string}  opts.userThemesKey       - localStorage key for user-saved themes
 * @param {HTMLSelectElement} [opts.themeSelectEl]  - <select> for theme dropdown
 * @param {object}  [opts.buttons]           - { store, default, remove, export, import }
 * @param {Function} opts.buildThemeSnapshot - () → theme-only settings snapshot
 * @param {Function} opts.applyTheme         - (name) → void — push theme to DOM
 * @param {Function} opts.saveSettings       - () → void — persist full settings
 * @param {Function} opts.showAlertDialog    - (title, msg) → Promise
 * @param {Function} opts.showConfirmDialog  - (title, msg, opts) → Promise<bool>
 * @param {Function} opts.showPromptDialog   - (title, msg, default) → Promise<string|null>
 * @param {Function} opts.downloadBlob       - (content, mime, filename) → void
 * @param {string}  [opts.appName]           - App name for export filenames (default 'app')
 * @returns {object} Theme manager API
 */
export function createThemeManager({
  builtInThemes,
  defaultThemeData,
  requiredThemeKeys,
  userThemesKey,
  themeSelectEl,
  buttons = {},
  buildThemeSnapshot,
  applyTheme,
  saveSettings,
  showAlertDialog,
  showConfirmDialog,
  showPromptDialog,
  downloadBlob,
  appName = 'app',
}) {
  const registry = new Map(Object.entries(builtInThemes));
  let _defaultTheme = Object.keys(builtInThemes)[0];
  let _themeSaveHandler = null;

  // ── Internal helpers ──

  function _saveUserThemes() {
    const userObj = {};
    for (const [name, theme] of registry) {
      if (!builtInThemes[name]) userObj[name] = theme;
    }
    try { localStorage.setItem(userThemesKey, JSON.stringify(userObj)); } catch {}
  }

  function _loadUserThemes() {
    try {
      const stored = JSON.parse(localStorage.getItem(userThemesKey) || '{}');
      for (const [name, theme] of Object.entries(stored)) {
        registry.set(name, theme);
      }
    } catch { /* ignore */ }
  }

  function _populateSelect() {
    if (!themeSelectEl) return;
    const current = themeSelectEl.value;
    themeSelectEl.innerHTML = '';
    for (const name of registry.keys()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + (name === _defaultTheme ? ' \u2605' : '');
      themeSelectEl.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom';
    customOpt.style.fontStyle = 'italic';
    themeSelectEl.appendChild(customOpt);
    themeSelectEl.value = (themeSelectEl.querySelector(`option[value="${CSS.escape(current)}"]`) ? current : registry.keys().next().value);
  }

  function _syncButtons() {
    if (!buttons.store) return;
    const sel       = themeSelectEl?.value;
    const isCustom  = sel === 'custom';
    const isBuiltIn = !!builtInThemes[sel];
    const isDefault = sel === _defaultTheme;
    if (buttons.store)      buttons.store.disabled      = !isCustom;
    if (buttons.setDefault) buttons.setDefault.disabled = isCustom || isDefault;
    if (buttons.remove)     buttons.remove.disabled     = isCustom || isBuiltIn;
    if (buttons.export)  buttons.export.disabled  = false;
    if (buttons.import)  buttons.import.disabled  = false;
  }

  /**
   * Resolve a theme by name, walking the inherit chain from DEFAULT_THEME.
   * Returns a fully-specified theme object.
   */
  function resolveTheme(name) {
    const chain = [];
    let current = name;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const t = registry.get(current);
      if (!t) break;
      chain.unshift(t);
      const parent = t.inherit;
      if (!parent) break;
      current = parent;
    }
    return Object.assign({}, defaultThemeData, ...chain);
  }

  // ── Public CRUD ──

  async function storeTheme() {
    const name = await showPromptDialog('Save Theme', 'Enter a name for this theme:');
    if (!name) return;
    if (name.toLowerCase() === 'custom') {
      await showAlertDialog('Reserved name', '\u201cCustom\u201d is a reserved name \u2014 please choose a different name.');
      return;
    }
    if (builtInThemes[name]) {
      await showAlertDialog('Built-in theme', `\u201c${name}\u201d is a built-in theme and cannot be overwritten.`);
      return;
    }
    registry.set(name, buildThemeSnapshot());
    _saveUserThemes();
    _populateSelect();
    if (themeSelectEl) themeSelectEl.value = name;
    _syncButtons();
    saveSettings();
  }

  function setDefaultTheme(name) {
    if (name === undefined) name = themeSelectEl?.value;
    if (name === 'custom' || !registry.has(name)) return;
    _defaultTheme = name;
    saveSettings();
    _populateSelect();
    if (themeSelectEl) themeSelectEl.value = name;
    _syncButtons();
  }

  async function removeTheme() {
    const name = themeSelectEl?.value;
    if (name === 'custom' || builtInThemes[name]) return;
    if (!await showConfirmDialog('Remove theme', `Remove the theme \u201c${name}\u201d?`, { okLabel: 'Remove', cancelLabel: 'Cancel' })) return;
    if (_defaultTheme === name) {
      _defaultTheme = Object.keys(builtInThemes)[0];
    }
    registry.delete(name);
    _saveUserThemes();
    _populateSelect();
    const fallback = themeSelectEl?.value;
    if (registry.has(fallback)) applyTheme(fallback);
    _syncButtons();
  }

  async function exportTheme() {
    const sel = themeSelectEl?.value;
    const isCustom = sel === 'custom';
    const defaultName = isCustom ? '' : sel;
    const name = await showPromptDialog('Export Theme', 'Enter a name for the exported theme:', defaultName);
    if (!name) return;
    if (name.toLowerCase() === 'custom') {
      await showAlertDialog('Reserved name', '\u201cCustom\u201d is a reserved name \u2014 please choose a different name.');
      return;
    }
    const themeData = isCustom ? buildThemeSnapshot() : (registry.get(sel) ?? buildThemeSnapshot());
    const json = JSON.stringify({ name, theme: themeData }, null, 2);
    const filename = `${name}.${appName.toLowerCase()}-theme.json`;
    if (_themeSaveHandler) {
      await _themeSaveHandler({ content: json, filename, filterName: `${appName} Theme`, extensions: ['json'] });
    } else {
      downloadBlob(json, 'application/json', filename);
    }
  }

  function importTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;
      let data, themeObj;
      try {
        const text = await file.text();
        data = JSON.parse(text);
        themeObj = (data.theme && typeof data.theme === 'object') ? data.theme : data;
        if (typeof themeObj !== 'object' || (!themeObj.canvasBgColor && !(themeObj.inherit && builtInThemes[themeObj.inherit]))) {
          await showAlertDialog('Invalid file', `This does not appear to be a valid ${appName} theme file.`);
          return;
        }
      } catch {
        await showAlertDialog('Parse error', 'Failed to parse the theme file \u2014 please check it is valid JSON.');
        return;
      }
      const fileNameSuggestion = (typeof data.name === 'string' && data.name.trim()) ? data.name.trim() : '';
      if (themeObj.inherit && !builtInThemes[themeObj.inherit]) {
        if (!await showConfirmDialog('Unknown inherit theme',
            `The file specifies inherit "${themeObj.inherit}" which is not a known theme. The default theme will be used as the base instead. Continue?`,
            { okLabel: 'Continue', cancelLabel: 'Cancel' })) return;
      }
      let name = await showPromptDialog('Import Theme', 'Name for the imported theme:', fileNameSuggestion);
      if (!name) return;
      if (name.toLowerCase() === 'custom') {
        await showAlertDialog('Reserved name', '\u201cCustom\u201d is a reserved name \u2014 please choose a different name.');
        return;
      }
      while (builtInThemes[name]) {
        const next = await showPromptDialog('Built-in theme', `\u201c${name}\u201d is a built-in theme and cannot be overwritten.\nPlease enter a different name:`, '');
        if (!next) return;
        name = next;
        if (name.toLowerCase() === 'custom') {
          await showAlertDialog('Reserved name', '\u201cCustom\u201d is a reserved name \u2014 please choose a different name.');
          return;
        }
      }
      if (registry.has(name)) {
        if (!await showConfirmDialog('Overwrite theme', `A user theme named \u201c${name}\u201d already exists. Overwrite it?`, { okLabel: 'Overwrite', cancelLabel: 'Cancel' })) return;
      }
      registry.set(name, themeObj);
      _saveUserThemes();
      _populateSelect();
      if (themeSelectEl) themeSelectEl.value = name;
      applyTheme(name);
      _syncButtons();
    });
    input.click();
  }

  function markCustom() {
    if (themeSelectEl && themeSelectEl.value !== 'custom') {
      themeSelectEl.value = 'custom';
      saveSettings();
    }
    _syncButtons();
  }

  // ── Initialise ──
  _loadUserThemes();
  // Guard: if the stored default is no longer in the registry, fall back gracefully.
  if (!registry.has(_defaultTheme)) _defaultTheme = Object.keys(builtInThemes)[0];
  // Validate that defaultThemeData is fully specified.
  if (requiredThemeKeys?.length) {
    const _missing = requiredThemeKeys.filter(k => !(k in defaultThemeData));
    if (_missing.length) console.warn(`${appName}: DEFAULT_THEME is missing required keys:`, _missing);
  }
  _populateSelect();
  _syncButtons();

  const mgr = {
    /** The live theme registry (Map<string, object>). */
    registry,
    /** Resolve a theme to a fully-specified object (walking inherit chain). */
    resolveTheme,
    /** Rebuild the theme <select> options. */
    populateSelect: _populateSelect,
    /** Sync enabled/disabled state of theme action buttons. */
    syncButtons: _syncButtons,
    /** Persist user-defined themes to localStorage. */
    saveUserThemes: _saveUserThemes,
    /** Prompt the user and save the current visual state as a named theme. */
    storeTheme,
    /** Set the default startup theme (from the currently selected theme). */
    setDefaultTheme,
    /** Remove a user-saved theme (with confirmation). */
    removeTheme,
    /** Export a theme as a JSON file. */
    exportTheme,
    /** Import a theme from a JSON file. */
    importTheme,
    /** Mark the theme selector as "Custom" (user manually edited a control). */
    markCustom,
    /** Set a platform-specific save handler for theme export (e.g. Tauri native dialog). */
    setThemeSaveHandler(fn) { _themeSaveHandler = fn; },
  };

  /** The user-set default theme name. Assignable (validates against the registry). */
  Object.defineProperty(mgr, 'defaultTheme', {
    get() { return _defaultTheme; },
    set(name) {
      if (registry.has(name)) _defaultTheme = name;
      else _defaultTheme = Object.keys(builtInThemes)[0];
    },
    enumerable: true,
  });

  return mgr;
}


// ── Embed Configuration Resolver ──────────────────────────────────────────

/**
 * Resolve embed configuration from a global config object and URL parameters.
 *
 * For each flag defined in `flagDefs`, resolves values with the priority:
 *   window[configKey].ui.<uiKey>  >  URL param  >  default (true)
 *
 * @param {object} opts
 * @param {string}  opts.configKey        - Window property name (e.g. 'peartreeConfig')
 * @param {string}  opts.settingsKeyDefault - Default storage key when not overridden
 * @param {Array}   opts.flagDefs         - Array of { name, uiKey, param, [extended] }
 * @param {Function} [opts.extras]        - (config, params) → extra props to merge
 * @returns {object} Resolved configuration object
 */
export function resolveEmbedConfig({ configKey, settingsKeyDefault, flagDefs, extras }) {
  const _p  = new URLSearchParams(window.location.search);
  const _wc = window[configKey] || {};
  const _ui = _wc.ui || {};

  const _coerceUiFlag = (val, extended = false) => {
    if (val === undefined) return undefined;
    if (extended && val === 'fixed') return 'fixed';
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      if (extended && s === 'fixed') return 'fixed';
      if (s === '0' || s === 'false') return false;
      if (s === '1' || s === 'true') return true;
    }
    return Boolean(val);
  };

  const _resolveUiValue = (def) => {
    if (Array.isArray(def.uiKeys) && def.uiKeys.length) {
      for (const key of def.uiKeys) {
        if (_ui[key] !== undefined) return _ui[key];
      }
      return undefined;
    }
    return _ui[def.uiKey];
  };

  const _resolveFromParam = (param, extended = false) => {
    const raw = _p.get(param);
    if (extended && raw === 'fixed') return 'fixed';
    return raw !== '0';
  };

  const _sk = _wc.storageKey !== undefined
    ? _wc.storageKey
    : _p.get('storageKey') ?? (_p.get('nostore') === '1' ? null : settingsKeyDefault);

  const cfg = {
    enableKeyboard: _ui.keyboard !== undefined ? Boolean(_ui.keyboard) : _p.get('keyboard') !== '0',
    storageKey: _sk,
    initSettings: (() => {
      try { const v = _p.get('settings'); return v ? JSON.parse(atob(v)) : {}; } catch { return {}; }
    })(),
  };

  for (const def of flagDefs) {
    const uiVal = _resolveUiValue(def);
    const coerced = _coerceUiFlag(uiVal, !!def.extended);
    cfg[def.name] = (coerced !== undefined)
      ? coerced
      : _resolveFromParam(def.param, !!def.extended);
  }

  if (extras) Object.assign(cfg, extras(_wc, _p));

  return cfg;
}


// ── Side Panel Controller ───────────────────────────────────────────────

/**
 * Create a slide-out side panel controller with open / close / pin state.
 *
 * This is a small reusable shell controller for apps that need a panel drawer
 * with a pin button and an optional persistent pinned state.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {HTMLElement} [opts.toggleButton]
 * @param {HTMLElement} [opts.closeButton]
 * @param {HTMLElement} [opts.pinButton]
 * @param {HTMLElement} [opts.bodyEl=document.body]
 * @param {Window} [opts.windowRef=window]
 * @param {string} [opts.storageKey]
 * @param {string} [opts.pinnedBodyClass]
 * @param {boolean} [opts.initialPinned]
 * @param {boolean} [opts.initialOpen]
 * @param {boolean} [opts.enabled=true]
 * @param {boolean} [opts.advancedToggle=false]
 * @param {Function} [opts.onStateChange]
 * @returns {{ open: Function, close: Function, pin: Function, unpin: Function, toggle: Function, isOpen: Function, isPinned: Function, bindUI: Function, onChange: Function }}
 */
export function createSidePanelController({
  panel,
  toggleButton,
  closeButton,
  pinButton,
  bodyEl = document.body,
  windowRef = window,
  storageKey = null,
  pinnedBodyClass = '',
  initialPinned,
  initialOpen,
  enabled = true,
  advancedToggle = false,
  onStateChange,
} = {}) {
  let pinned = false;
  let _onChange = null;

  if (panel) panel.inert = true;

  function _syncPinButton() {
    if (!pinButton) return;
    pinButton.classList.toggle('active', pinned);
    pinButton.title = pinned ? 'Unpin' : 'Pin open';
    pinButton.innerHTML = pinned
      ? '<i class="bi bi-pin-angle-fill"></i>'
      : '<i class="bi bi-pin-angle"></i>';
  }

  function _setBodyPinned(on) {
    if (!bodyEl || !pinnedBodyClass) return;
    bodyEl.classList.toggle(pinnedBodyClass, !!on);
  }

  function isOpen() {
    return panel?.classList.contains('open') ?? false;
  }

  function _notify() {
    _onChange?.(isOpen(), pinned);
    onStateChange?.();
  }

  function _resize() {
    windowRef?.dispatchEvent?.(new Event('resize'));
  }

  function open(advanced) {
    if (!panel) return;
    panel.classList.add('open');
    panel.classList.remove('pinned');
    panel.inert = false;
    if (advancedToggle) panel.classList.toggle('advanced', !!advanced);
    if (pinned) {
      panel.classList.add('pinned');
      _setBodyPinned(true);
    }
    toggleButton?.classList.add('active');
    _syncPinButton();
    _resize();
    _notify();
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('open', 'advanced', 'pinned');
    panel.inert = true;
    pinned = false;
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    _setBodyPinned(false);
    toggleButton?.classList.remove('active');
    _syncPinButton();
    _resize();
    _notify();
  }

  function pin() {
    if (!panel) return;
    pinned = true;
    if (storageKey) {
      try { localStorage.setItem(storageKey, '1'); } catch {}
    }
    panel.classList.add('open', 'pinned');
    panel.inert = false;
    _setBodyPinned(true);
    toggleButton?.classList.add('active');
    _syncPinButton();
    _resize();
    _notify();
  }

  function unpin() {
    if (!panel) return;
    pinned = false;
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    panel.classList.remove('pinned');
    _setBodyPinned(false);
    _syncPinButton();
    _resize();
    _notify();
  }

  function toggle(advanced) {
    if (!panel) return;
    if (panel.classList.contains('open')) close();
    else open(advanced);
  }

  function bindUI({ toggleButton: btnToggle, closeButton: btnClose, pinButton: btnPin } = {}) {
    btnToggle?.addEventListener('click', e => {
      e.stopPropagation();
      toggle(e.altKey);
    });
    btnClose?.addEventListener('click', close);
    btnPin?.addEventListener('click', () => (pinned ? unpin() : pin()));
  }

  if (panel && enabled !== false) {
    const wasPinned = initialPinned ?? (storageKey ? (() => {
      try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
    })() : false);
    const wasOpen = initialOpen ?? false;
    if (wasPinned) pin();
    else if (wasOpen) open();
    else _syncPinButton();
  }

  return {
    open,
    close,
    pin,
    unpin,
    toggle,
    isOpen,
    isPinned: () => pinned,
    bindUI,
    onChange: (fn) => { _onChange = fn; },
  };
}

/**
 * Sync a panel pin button's icon, title, and active state.
 *
 * @param {HTMLElement|null} button
 * @param {boolean} pinned
 * @param {object} [opts]
 * @param {string} [opts.activeClass='active']
 * @param {string} [opts.iconSelector='i']
 * @param {string} [opts.iconPinned='bi bi-pin-angle-fill']
 * @param {string} [opts.iconUnpinned='bi bi-pin-angle']
 * @param {string} [opts.titlePinned='Unpin panel']
 * @param {string} [opts.titleUnpinned='Pin panel open']
 */
export function syncPanelPinButtonState(button, pinned, {
  activeClass = 'active',
  iconSelector = 'i',
  iconPinned = 'bi bi-pin-angle-fill',
  iconUnpinned = 'bi bi-pin-angle',
  titlePinned = 'Unpin panel',
  titleUnpinned = 'Pin panel open',
} = {}) {
  if (!button) return;
  button.classList.toggle(activeClass, !!pinned);
  button.title = pinned ? titlePinned : titleUnpinned;
  const icon = button.querySelector(iconSelector);
  if (icon) icon.className = pinned ? iconPinned : iconUnpinned;
}

/**
 * Create a generic drag-resize controller for side panels.
 *
 * The caller decides whether resize is currently enabled (for example, only
 * while pinned). Width is applied to the panel directly and can optionally be
 * mirrored to a CSS variable.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {HTMLElement} opts.handle
 * @param {'left'|'right'} [opts.side='right']
 * @param {number} [opts.minWidth=120]
 * @param {number} [opts.maxWidth=1200]
 * @param {string} [opts.ghostId='pt-panel-resize-ghost']
 * @param {string|null} [opts.cssVarName=null]
 * @param {HTMLElement} [opts.cssVarTarget=document.documentElement]
 * @param {HTMLElement} [opts.cursorTarget=document.body]
 * @param {boolean} [opts.disableTransitionOnCommit=true]
 * @param {Function} [opts.isEnabled]         - () => boolean
 * @param {Function} [opts.onCommit]          - (newWidthPx:number, widthCss:string) => void
 * @returns {{ destroy: Function, isDragging: Function }}
 */
export function createPanelResizeController({
  panel,
  handle,
  side = 'right',
  minWidth = 120,
  maxWidth = 1200,
  ghostId = 'pt-panel-resize-ghost',
  cssVarName = null,
  cssVarTarget = document.documentElement,
  cursorTarget = document.body,
  disableTransitionOnCommit = true,
  isEnabled = () => true,
  onCommit,
} = {}) {
  if (!panel || !handle) {
    return { destroy() {}, isDragging: () => false };
  }

  const _ghost = (() => {
    let el = document.getElementById(ghostId);
    if (el) return el;
    el = document.createElement('div');
    el.id = ghostId;
    document.body.appendChild(el);
    return el;
  })();

  let _dragging = false;
  let _x0 = 0;
  let _w0 = 0;

  function _clampWidth(w) {
    return Math.max(minWidth, Math.min(maxWidth, w));
  }

  function _widthFromPointer(clientX) {
    const delta = side === 'left' ? (clientX - _x0) : (_x0 - clientX);
    return _clampWidth(_w0 + delta);
  }

  function _positionGhost(newW) {
    const rect = panel.getBoundingClientRect();
    const x = side === 'left' ? (rect.left + newW) : (rect.right - newW);
    _ghost.style.left = `${x}px`;
  }

  function _onMouseDown(e) {
    if (!isEnabled?.()) return;
    _dragging = true;
    _x0 = e.clientX;
    _w0 = panel.offsetWidth;
    _positionGhost(_w0);
    _ghost.style.display = 'block';
    if (cursorTarget) cursorTarget.style.cursor = 'ew-resize';
    e.preventDefault();
  }

  function _onMouseMove(e) {
    if (!_dragging) return;
    _positionGhost(_widthFromPointer(e.clientX));
  }

  function _onMouseUp(e) {
    if (!_dragging) return;
    _dragging = false;
    _ghost.style.display = 'none';
    if (cursorTarget) cursorTarget.style.cursor = '';

    const newW = _widthFromPointer(e.clientX);
    const cssW = `${newW}px`;
    const prevTransition = panel.style.transition;

    if (disableTransitionOnCommit) panel.style.transition = 'none';
    panel.style.width = cssW;
    if (cssVarName && cssVarTarget) cssVarTarget.style.setProperty(cssVarName, cssW);
    void panel.offsetWidth;
    if (disableTransitionOnCommit) {
      requestAnimationFrame(() => { panel.style.transition = prevTransition; });
    }

    onCommit?.(newW, cssW);
  }

  handle.addEventListener('mousedown', _onMouseDown);
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mouseup', _onMouseUp);

  return {
    destroy() {
      handle.removeEventListener('mousedown', _onMouseDown);
      window.removeEventListener('mousemove', _onMouseMove);
      window.removeEventListener('mouseup', _onMouseUp);
    },
    isDragging: () => _dragging,
  };
}

function _parseSizeToPx(value, panel) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const s = value.trim();
  if (!s) return 0;
  if (s.endsWith('px')) {
    const px = parseFloat(s);
    return Number.isFinite(px) ? px : 0;
  }
  if (s.endsWith('%')) {
    const pct = parseFloat(s);
    if (!Number.isFinite(pct)) return 0;
    const parentW = panel?.parentElement?.clientWidth ?? 0;
    return parentW > 0 ? (parentW * pct / 100) : 0;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Track stacked pinned side panels and expose reserved width per side.
 *
 * This manager does not impose layout by itself. It computes aggregate widths
 * and writes CSS custom properties that host apps can consume.
 *
 * @param {object} [opts]
 * @param {HTMLElement} [opts.targetEl=document.documentElement]
 * @param {string} [opts.leftVar='--pt-side-left-w']
 * @param {string} [opts.rightVar='--pt-side-right-w']
 * @param {'accumulate'|'single-per-side'} [opts.policy='accumulate']
 * @param {Function} [opts.onChange] - ({left:number,right:number}) => void
 * @returns {{ setPanelState: Function, removePanel: Function, getReserved: Function, recompute: Function }}
 */
export function createSidePanelStackManager({
  targetEl = document.documentElement,
  leftVar = '--pt-side-left-w',
  rightVar = '--pt-side-right-w',
  policy = 'accumulate',
  onChange,
} = {}) {
  const _state = new Map();
  let _pinSeqCounter = 1;

  function _effectiveWidth(panelState) {
    if (!panelState) return 0;
    if (!(panelState.open && panelState.pinned)) return 0;
    if (Number.isFinite(panelState.widthPx)) return panelState.widthPx;
    if (panelState.widthValue != null) {
      return _parseSizeToPx(panelState.widthValue, panelState.panel);
    }
    if (panelState.panel) {
      return panelState.panel.getBoundingClientRect().width || panelState.panel.offsetWidth || 0;
    }
    return 0;
  }

  function _sumSide(side) {
    const items = [];
    for (const st of _state.values()) {
      if ((st.side || 'right') !== side) continue;
      const w = _effectiveWidth(st);
      if (w > 0) items.push({ order: st.order || 0, width: w });
    }
    if (items.length === 0) return 0;
    if (policy === 'single-per-side') {
      items.sort((a, b) => b.order - a.order);
      return items[0].width;
    }
    return items.reduce((sum, it) => sum + it.width, 0);
  }

  function _applyPanelOffsets() {
    for (const side of ['left', 'right']) {
      const active = [];
      for (const st of _state.values()) {
        const panel = st.panel;
        if (!panel || (st.side || 'right') !== side) continue;
        const w = _effectiveWidth(st);
        if (w <= 0) {
          if (side === 'right') panel.style.right = '';
          else panel.style.left = '';
          continue;
        }
        active.push({
          panel,
          width: w,
          pinSeq: Number.isFinite(st.pinSeq) ? st.pinSeq : Number.MAX_SAFE_INTEGER,
          order: Number.isFinite(st.order) ? st.order : 0,
        });
      }

      // Panel order controls stack placement: lower order hugs the side edge,
      // higher order stacks inward (leftward on the right side, rightward on the left).
      active.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.pinSeq - b.pinSeq;
      });

      let offset = 0;
      for (const it of active) {
        if (side === 'right') it.panel.style.right = `${offset}px`;
        else it.panel.style.left = `${offset}px`;
        offset += it.width;
      }
    }
  }

  function recompute() {
    const left = _sumSide('left');
    const right = _sumSide('right');
    _applyPanelOffsets();
    if (targetEl) {
      targetEl.style.setProperty(leftVar, `${left}px`);
      targetEl.style.setProperty(rightVar, `${right}px`);
    }
    onChange?.({ left, right });
    return { left, right };
  }

  return {
    setPanelState(id, next = {}) {
      if (!id) return recompute();
      const prev = _state.get(id) || {};
      const nextOpen = next.open ?? prev.open ?? false;
      const nextPinned = next.pinned ?? prev.pinned ?? false;
      const wasActivePinned = !!(prev.open && prev.pinned);
      const nowActivePinned = !!(nextOpen && nextPinned);
      let nextPinSeq = prev.pinSeq;
      if (nowActivePinned && !wasActivePinned) nextPinSeq = _pinSeqCounter++;
      if (!nowActivePinned) nextPinSeq = undefined;

      _state.set(id, {
        side: next.side ?? prev.side ?? 'right',
        panel: next.panel ?? prev.panel ?? null,
        open: nextOpen,
        pinned: nextPinned,
        widthPx: Number.isFinite(next.widthPx) ? next.widthPx : prev.widthPx,
        widthValue: next.widthValue ?? prev.widthValue,
        order: Number.isFinite(next.order) ? next.order : (prev.order ?? Date.now()),
        pinSeq: nextPinSeq,
      });
      return recompute();
    },
    removePanel(id) {
      _state.delete(id);
      return recompute();
    },
    getReserved: () => recompute(),
    recompute,
  };
}

/**
 * Create a lightweight runtime controller for options controls.
 *
 * Provides delegated change/input/click wiring, get/set helpers, and basic
 * visibility/enabled state helpers so apps can avoid repetitive direct DOM
 * event binding for each control.
 *
 * @param {object} opts
 * @param {Element|Document} opts.root
 * @param {string} [opts.scopeSelector='#palette-panel']
 * @param {Record<string, object>} [opts.controls] - controlId -> descriptor
 * @returns {{ register: Function, on: Function, off: Function, getValue: Function, setValue: Function, setVisible: Function, setEnabled: Function, getEl: Function, destroy: Function }}
 */
export function createOptionsController({
  root,
  scopeSelector = '#palette-panel',
  controls = {},
} = {}) {
  const _root = root || document;
  const _handlers = new Map();
  const _controls = new Map(Object.entries(controls || {}));

  function _scopeEl() {
    return scopeSelector ? _root.querySelector(scopeSelector) : _root;
  }

  function getEl(id) {
    if (!id) return null;
    return _scopeEl()?.querySelector(`#${CSS.escape(id)}`) || null;
  }

  function _valueFromEl(el) {
    if (!el) return undefined;
    if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked;
    return el.value;
  }

  function _emit(id, type, value, event, el) {
    const list = _handlers.get(id);
    if (!list || !list.length) return;
    for (const fn of list) {
      try { fn({ id, type, value, event, element: el, control: _controls.get(id) || null }); }
      catch { /* ignore handler errors */ }
    }
  }

  function _findControlElFromEvent(target) {
    if (!target || !_scopeEl()) return null;
    return target.closest('input, select, textarea, button');
  }

  function _handleInputLike(eventType, event) {
    const el = _findControlElFromEvent(event.target);
    if (!el || !el.id) return;
    _emit(el.id, eventType, _valueFromEl(el), event, el);
  }

  function _onInput(e) { _handleInputLike('input', e); }
  function _onChange(e) { _handleInputLike('change', e); }
  function _onClick(e) {
    const el = _findControlElFromEvent(e.target);
    if (!el || !el.id) return;
    if (el.tagName !== 'BUTTON' && el.type !== 'button') return;
    _emit(el.id, 'click', _valueFromEl(el), e, el);
  }

  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onChange);
  _root.addEventListener('click', _onClick);

  return {
    register(map = {}) {
      for (const [id, def] of Object.entries(map)) _controls.set(id, def || {});
    },
    on(id, fn) {
      if (!id || typeof fn !== 'function') return;
      const list = _handlers.get(id) || [];
      list.push(fn);
      _handlers.set(id, list);
    },
    off(id, fn) {
      const list = _handlers.get(id);
      if (!list || !list.length) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
      if (!list.length) _handlers.delete(id);
    },
    getEl,
    getValue(id) {
      return _valueFromEl(getEl(id));
    },
    setValue(id, value) {
      const el = getEl(id);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!value;
      } else {
        el.value = value == null ? '' : String(value);
      }
    },
    setVisible(id, visible, { rowOnly = false } = {}) {
      const el = getEl(id);
      if (!el) return;
      const target = rowOnly ? (el.closest('.pt-palette-row') || el) : (el.closest('.pt-palette-row, .pt-detail, .pt-sub-controls') || el);
      target.style.display = visible ? '' : 'none';
    },
    setEnabled(id, enabled) {
      const el = getEl(id);
      if (!el) return;
      el.disabled = !enabled;
    },
    destroy() {
      _root.removeEventListener('input', _onInput);
      _root.removeEventListener('change', _onChange);
      _root.removeEventListener('click', _onClick);
      _handlers.clear();
      _controls.clear();
    },
  };
}

// Backward-compatible alias; prefer createOptionsController.
export const createPaletteController = createOptionsController;


// ── Declarative Options Behaviour ─────────────────────────────────────────

/**
 * Create a declarative behaviour layer for an options panel.
 *
 * This wraps createOptionsController() and adds two high-level capabilities:
 *
 * 1) Visibility rules
 *    - Show/hide targets (rows, details, sections, or any element) from control values.
 *
 * 2) Cascading control chains
 *    - Progressive chains where downstream controls are gated by upstream controls
 *      (for example: shape2 only active when shape1 is not "off").
 *
 * @param {object} opts
 * @param {Element|Document} opts.root
 * @param {string} [opts.scopeSelector='#palette-panel']
 * @param {Array<object>} [opts.rules=[]]
 * @param {Array<object>} [opts.cascades=[]]
 * @returns {{
 *   options: ReturnType<typeof createOptionsController>,
 *   palette: ReturnType<typeof createOptionsController>,
 *   evaluate: Function,
 *   setRules: Function,
 *   setCascades: Function,
 *   destroy: Function,
 * }}
 */
export function createDeclarativeOptionsController({
  root,
  scopeSelector = '#palette-panel',
  rules = [],
  cascades = [],
} = {}) {
  const options = createOptionsController({ root, scopeSelector });
  const _handlers = [];
  const _memory = new Map(); // chainKey -> Array<string|null>
  let _rules = Array.isArray(rules) ? rules.slice() : [];
  let _cascades = Array.isArray(cascades) ? cascades.slice() : [];

  function _toElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    if (typeof target === 'string') {
      if (target.startsWith('#') || target.startsWith('.') || target.includes(' ') || target.includes('[')) {
        return root.querySelector(target);
      }
      return options.getEl(target);
    }
    return null;
  }

  function _targetFromControl(controlId, target) {
    if (target) return _toElement(target);
    const control = options.getEl(controlId);
    if (!control) return null;
    return control.closest('.pt-palette-row, .pt-detail, .pt-palette-section, .pt-sub-controls') || control;
  }

  function _setVisible(targetEl, visible, mode = 'auto') {
    if (!targetEl) return;
    const useDetailClass = mode === 'detail'
      || (mode === 'auto' && targetEl.classList?.contains('pt-detail'));
    if (useDetailClass) {
      targetEl.classList.toggle('pt-detail-open', !!visible);
      return;
    }
    targetEl.style.display = visible ? '' : 'none';
  }

  function _matchesCondition(value, rule) {
    if (typeof rule.when === 'function') return !!rule.when(value, options);
    if (rule.equals !== undefined) return value === rule.equals;
    if (rule.notEquals !== undefined) return value !== rule.notEquals;
    if (Array.isArray(rule.in)) return rule.in.includes(value);
    if (Array.isArray(rule.notIn)) return !rule.notIn.includes(value);
    if (rule.truthy) return !!value;
    if (rule.falsy) return !value;
    return !!value;
  }

  function _evaluateRules() {
    for (const rule of _rules) {
      const controlId = rule.control || rule.id;
      if (!controlId) continue;
      const value = options.getValue(controlId);
      const visible = _matchesCondition(value, rule);
      const targetEl = _targetFromControl(controlId, rule.target);
      _setVisible(targetEl, visible, rule.mode || 'auto');
    }
  }

  function _applyCascade(cascade) {
    const controls = Array.isArray(cascade.controls) ? cascade.controls : [];
    if (controls.length < 2) return;

    const chainKey = cascade.id || controls.join('>');
    const offValue = cascade.offValue ?? 'off';
    const restore = cascade.restore !== false;
    const memory = _memory.get(chainKey) || new Array(controls.length).fill(null);

    for (let i = 1; i < controls.length; i++) {
      const upstreamId = controls[i - 1];
      const currentId = controls[i];
      const upstreamValue = options.getValue(upstreamId);
      const currentValue = options.getValue(currentId);
      const gatedOff = upstreamValue === offValue || upstreamValue == null || upstreamValue === '';

      if (gatedOff) {
        if (currentValue != null && currentValue !== offValue && currentValue !== '') {
          memory[i] = String(currentValue);
        }
        options.setValue(currentId, offValue);
      } else if (restore && (currentValue == null || currentValue === '' || currentValue === offValue) && memory[i] != null) {
        options.setValue(currentId, memory[i]);
      }
    }

    _memory.set(chainKey, memory);
  }

  function _evaluateCascades() {
    for (const cascade of _cascades) _applyCascade(cascade);
  }

  function evaluate() {
    _evaluateCascades();
    _evaluateRules();
  }

  function _registerHandlers() {
    for (const rule of _rules) {
      const id = rule.control || rule.id;
      if (!id) continue;
      const fn = () => evaluate();
      options.on(id, fn);
      _handlers.push({ id, fn });
    }
    for (const cascade of _cascades) {
      const controls = Array.isArray(cascade.controls) ? cascade.controls : [];
      for (const id of controls) {
        const fn = () => evaluate();
        options.on(id, fn);
        _handlers.push({ id, fn });
      }
    }
  }

  function _clearHandlers() {
    for (const { id, fn } of _handlers) options.off(id, fn);
    _handlers.length = 0;
  }

  function setRules(nextRules = []) {
    _rules = Array.isArray(nextRules) ? nextRules.slice() : [];
    _clearHandlers();
    _registerHandlers();
    evaluate();
  }

  function setCascades(nextCascades = []) {
    _cascades = Array.isArray(nextCascades) ? nextCascades.slice() : [];
    _clearHandlers();
    _registerHandlers();
    evaluate();
  }

  _registerHandlers();
  evaluate();

  return {
    options,
    // Backward-compatible alias; prefer .options
    palette: options,
    evaluate,
    setRules,
    setCascades,
    destroy() {
      _clearHandlers();
      options.destroy();
    },
  };
}

// Backward-compatible alias; prefer createDeclarativeOptionsController.
export const createDeclarativePaletteController = createDeclarativeOptionsController;


// ── Accordion Sections ─────────────────────────────────────────────────

/**
 * Create a simple one-open-at-a-time accordion for custom section stacks.
 *
 * The controller is intentionally generic so apps can use their own section
 * classes and panel chrome without inheriting the pearcore palette layout.
 *
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} [opts.sectionSelector='.sx-settings-section']
 * @param {string} [opts.headerSelector=':scope > h3']
 * @param {string} [opts.storageKey]
 * @param {string} [opts.defaultOpenSectionId]
 * @param {Record<string, {
 *   forceOpen?: boolean,
 *   lockOpen?: boolean,
 *   forcePinned?: boolean,
 *   hideChevronControl?: boolean,
 * }>} [opts.sectionPolicy] - per-section policy keyed by element id or accordion id
 * @returns {{ refresh: Function, openSection: Function, closeAll: Function }}
 */
export function initAccordionSections(root, {
  sectionSelector = '.sx-settings-section',
  headerSelector = ':scope > h3',
  storageKey = null,
  defaultOpenSectionId = null,
  sectionPolicy = {},
} = {}) {
  if (!root) return { refresh() {}, openSection() {}, closeAll() {} };

  const sectionMap = new Map();

  function _sectionPolicy(section) {
    if (!section) return {};
    return sectionPolicy[section.id] || sectionPolicy[section.dataset.accordionId] || {};
  }

  function _isForcedOpen(section) {
    const policy = _sectionPolicy(section);
    return !!(policy.forceOpen || policy.forcePinned);
  }

  function _applySectionChromePolicy(section) {
    const policy = _sectionPolicy(section);
    const toggle = section?.querySelector(':scope > h3 .sx-accordion-toggle');
    if (!toggle) return;
    const hideToggle = !!(policy.hideChevronControl || policy.lockOpen || policy.forceOpen || policy.forcePinned);
    toggle.style.display = hideToggle ? 'none' : '';
    toggle.setAttribute('aria-hidden', hideToggle ? 'true' : 'false');
  }

  function _loadState() {
    if (!storageKey) return null;
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  }

  function _saveState(sectionId) {
    if (!storageKey) return;
    try {
      if (sectionId) localStorage.setItem(storageKey, sectionId);
      else localStorage.removeItem(storageKey);
    } catch {}
  }

  function _ensureSection(section) {
    if (!section || sectionMap.has(section)) return sectionMap.get(section) || null;

    const header = section.querySelector(headerSelector);
    if (!header) return null;

    if (!section.dataset.accordionId) {
      section.dataset.accordionId = section.id || header.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    let body = section.querySelector(':scope > .sx-accordion-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'sx-accordion-body';
      const inner = document.createElement('div');
      inner.className = 'sx-accordion-body-inner';
      while (header.nextSibling) inner.appendChild(header.nextSibling);
      body.appendChild(inner);
      section.appendChild(body);
    }

    if (!header.querySelector('.sx-accordion-toggle')) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'sx-accordion-toggle';
      toggle.title = 'Toggle section';
      toggle.innerHTML = '<i class="bi bi-chevron-right"></i>';
      header.appendChild(toggle);
    }

    _applySectionChromePolicy(section);

    const api = { section, header, body };
    sectionMap.set(section, api);

    header.addEventListener('click', e => {
      if (e.target.closest('.sx-accordion-toggle')) return;
      toggleSection(section);
    });
    header.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.sx-accordion-toggle')) {
        e.preventDefault();
        toggleSection(section);
      }
    });
    const btn = header.querySelector('.sx-accordion-toggle');
    btn?.addEventListener('click', e => {
      e.stopPropagation();
      toggleSection(section);
    });

    return api;
  }

  function _sections() {
    return Array.from(root.querySelectorAll(sectionSelector)).map(_ensureSection).filter(Boolean);
  }

  function _isVisible(section) {
    return section?.style?.display !== 'none' && section?.hidden !== true;
  }

  function _setOpen(section, open) {
    if (!section) return;
    const api = _ensureSection(section);
    if (!api) return;
    const forcedOpen = _isForcedOpen(section);
    const toggle = api.header.querySelector('.sx-accordion-toggle i');
    const nextOpen = forcedOpen ? true : !!open;
    section.classList.toggle('is-open', nextOpen);
    api.body.style.display = nextOpen ? '' : 'none';
    if (toggle) toggle.className = nextOpen ? 'bi bi-chevron-down' : 'bi bi-chevron-right';
  }

  function closeAll() {
    for (const { section } of _sections()) _setOpen(section, false);
    const forcedVisible = _sections().find(({ section }) => _isVisible(section) && _isForcedOpen(section));
    _saveState(forcedVisible?.section?.dataset.accordionId || forcedVisible?.section?.id || '');
  }

  function openSection(sectionId) {
    const api = _sections().find(({ section }) => section.dataset.accordionId === sectionId || section.id === sectionId);
    if (!api) return;
    for (const { section } of _sections()) {
      if (section !== api.section && !_isForcedOpen(section)) _setOpen(section, false);
    }
    _setOpen(api.section, true);
    _saveState(api.section.dataset.accordionId || api.section.id || '');
  }

  function refresh({ defaultOpenSectionId: overrideDefaultOpenSectionId } = {}) {
    const visibleSections = _sections().filter(({ section }) => _isVisible(section));
    if (!visibleSections.length) {
      closeAll();
      return;
    }

    const desiredOpenId = _loadState() || overrideDefaultOpenSectionId || defaultOpenSectionId || visibleSections[0].section.dataset.accordionId;
    const desired = visibleSections.find(({ section }) => section.dataset.accordionId === desiredOpenId || section.id === desiredOpenId);
    const nextOpen = desired?.section || visibleSections[0].section;

    for (const { section } of visibleSections) {
      _setOpen(section, _isForcedOpen(section) || section === nextOpen);
    }

    const saveSection = visibleSections.find(({ section }) => !_isForcedOpen(section) && section === nextOpen)?.section
      || visibleSections.find(({ section }) => _isForcedOpen(section))?.section
      || nextOpen;
    _saveState(saveSection.dataset.accordionId || saveSection.id || '');
  }

  function toggleSection(section) {
    const api = _ensureSection(section);
    if (!api || !_isVisible(api.section)) return;
    if (_sectionPolicy(api.section).lockOpen || _isForcedOpen(api.section)) return;
    const isOpen = api.section.classList.contains('is-open');
    if (isOpen) {
      _setOpen(api.section, false);
      const forcedVisible = _sections().find(({ section }) => _isVisible(section) && _isForcedOpen(section));
      _saveState(forcedVisible?.section?.dataset.accordionId || forcedVisible?.section?.id || '');
      return;
    }
    for (const { section: other } of _sections()) {
      if (other !== api.section && _isVisible(other) && !_isForcedOpen(other)) _setOpen(other, false);
    }
    _setOpen(api.section, true);
    _saveState(api.section.dataset.accordionId || api.section.id || '');
  }

  return { refresh, openSection, closeAll };
}


// ── Section Accordion ─────────────────────────────────────────────────────

/**
 * Initialise section-accordion behaviour on `.pt-palette-section` elements
 * inside the given root.  Sections can be toggled and optionally pinned open.
 *
 * @param {Element} root          - Scope element (document or embed wrapper)
 * @param {string}  storageKey    - localStorage key for persisting section state
 * @param {string}  [defaultSectionId] - section data-sec-id to open by default
 * @param {Record<string, {
 *   forcePinned?: boolean,
 *   forceOpen?: boolean,
 *   lockPinned?: boolean,
 *   lockOpen?: boolean,
 *   hidePinControl?: boolean,
 *   hideChevronControl?: boolean,
 * }>} [sectionPolicy] - per-section policy keyed by element id or section data-sec-id
 * @returns {{ unlock: Function }} Call unlock() when the first data load completes
 */
export function initSectionAccordion(root, { storageKey, defaultSectionId = 'tree', sectionPolicy = {} } = {}) {
  let _sectionsUnlocked = false;

  function _loadSt() {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
  }
  function _saveSt(st) {
    try { localStorage.setItem(storageKey, JSON.stringify(st)); } catch {}
  }
  function _allSec() {
    return Array.from(root.querySelectorAll('.pt-palette-section[data-sec-id]'));
  }

  function _secPolicy(sec) {
    if (!sec) return {};
    return sectionPolicy[sec.id] || sectionPolicy[sec.dataset.secId] || {};
  }

  function _applySectionChromePolicy(sec) {
    if (!sec) return;
    const policy = _secPolicy(sec);
    const pinBtn = sec.querySelector(':scope > h3 .pt-sec-pin');
    const chevron = sec.querySelector(':scope > h3 .pt-sec-chevron');
    if (pinBtn) {
      const hidePin = policy.hidePinControl || policy.forcePinned;
      pinBtn.style.display = hidePin ? 'none' : '';
      pinBtn.setAttribute('aria-hidden', hidePin ? 'true' : 'false');
    }
    if (chevron) {
      const hideChevron = policy.hideChevronControl || policy.lockOpen || policy.forceOpen;
      chevron.style.display = hideChevron ? 'none' : '';
      chevron.setAttribute('aria-hidden', hideChevron ? 'true' : 'false');
    }
  }

  function _openSec(sec) {
    sec.classList.add('pt-palette-section--open');
    const st = _loadSt();
    st[sec.dataset.secId] = { ...(st[sec.dataset.secId] || {}), open: true };
    _saveSt(st);
  }
  function _closeSec(sec) {
    const policy = _secPolicy(sec);
    if (policy.lockOpen || policy.forceOpen) {
      _openSec(sec);
      return;
    }
    sec.classList.remove('pt-palette-section--open');
    const st = _loadSt();
    st[sec.dataset.secId] = { ...(st[sec.dataset.secId] || {}), open: false };
    _saveSt(st);
  }

  function _toggleSec(sec) {
    if (!_sectionsUnlocked) return;
    const policy = _secPolicy(sec);
    if (policy.lockOpen || policy.forceOpen) return;
    if (sec.classList.contains('pt-palette-section--pinned')) return;
    if (sec.classList.contains('pt-palette-section--open')) {
      _closeSec(sec);
    } else {
      _allSec().forEach(s => {
        if (s !== sec && s.classList.contains('pt-palette-section--open') && !s.classList.contains('pt-palette-section--pinned'))
          _closeSec(s);
      });
      _openSec(sec);
    }
  }

  function _togglePin(sec) {
    if (!_sectionsUnlocked) return;
    const policy = _secPolicy(sec);
    if (policy.lockPinned || policy.forcePinned) return;
    const isPinned = sec.classList.contains('pt-palette-section--pinned');
    const pinIcon  = sec.querySelector(':scope > h3 .pt-sec-pin i');
    const st       = _loadSt();
    if (isPinned) {
      sec.classList.remove('pt-palette-section--pinned');
      if (pinIcon) pinIcon.className = 'bi bi-pin';
      const pinBtn = sec.querySelector(':scope > h3 .pt-sec-pin');
      if (pinBtn) pinBtn.title = 'Pin open';
      _allSec().forEach(s => {
        if (s !== sec && s.classList.contains('pt-palette-section--open') && !s.classList.contains('pt-palette-section--pinned'))
          _closeSec(s);
      });
      sec.classList.add('pt-palette-section--open');
      st[sec.dataset.secId] = { open: true, pinned: false };
    } else {
      sec.classList.add('pt-palette-section--open', 'pt-palette-section--pinned');
      if (pinIcon) pinIcon.className = 'bi bi-pin-fill';
      const pinBtn = sec.querySelector(':scope > h3 .pt-sec-pin');
      if (pinBtn) pinBtn.title = 'Unpin';
      st[sec.dataset.secId] = { open: true, pinned: true };
    }
    _saveSt(st);
  }

  const savedState = _loadSt();
  const palBody = root.querySelector('#palette-panel-body');

  root.querySelectorAll('.pt-palette-section').forEach(sec => {
    const h3 = sec.querySelector(':scope > h3');
    if (!h3) return;

    const secId = h3.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');
    sec.dataset.secId = secId;

    h3.insertAdjacentHTML('beforeend',
      '<span class="pt-sec-actions">' +
        '<button class="pt-sec-pin" title="Pin open"><i class="bi bi-pin"></i></button>' +
        '<i class="bi bi-chevron-right pt-sec-chevron"></i>' +
      '</span>');

    const inner = document.createElement('div');
    inner.className = 'pt-section-body-inner';
    while (h3.nextSibling) inner.appendChild(h3.nextSibling);
    const body = document.createElement('div');
    body.className = 'pt-section-body';
    body.appendChild(inner);
    sec.appendChild(body);

    h3.addEventListener('click', e => { if (!e.target.closest('.pt-sec-pin')) _toggleSec(sec); });
    h3.tabIndex = 0;
    h3.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.pt-sec-pin')) {
        e.preventDefault(); _toggleSec(sec);
      }
    });

    h3.querySelector('.pt-sec-pin').addEventListener('click', e => {
      e.stopPropagation(); _togglePin(sec);
    });

    _applySectionChromePolicy(sec);
  });

  if (palBody) palBody.classList.add('pt-sections-locked');

  function unlock() {
    if (_sectionsUnlocked) return;
    _sectionsUnlocked = true;
    if (palBody) palBody.classList.remove('pt-sections-locked');

    const noTrans = [];
    let anyPinned = false;
    _allSec().forEach(sec => {
      const policy = _secPolicy(sec);
      const saved = savedState[sec.dataset.secId] || {};
      const shouldPin = policy.forcePinned || saved.pinned;
      const shouldOpen = policy.forceOpen || shouldPin || saved.open;

      _applySectionChromePolicy(sec);

      if (shouldPin) {
        anyPinned = true;
        const body = sec.querySelector(':scope > .pt-section-body');
        if (body) { body.style.transition = 'none'; noTrans.push(body); }
        sec.classList.add('pt-palette-section--open', 'pt-palette-section--pinned');
        const pi = sec.querySelector(':scope > h3 .pt-sec-pin i');
        if (pi) pi.className = 'bi bi-pin-fill';
        const pb = sec.querySelector(':scope > h3 .pt-sec-pin');
        if (pb) pb.title = policy.lockPinned || policy.forcePinned ? 'Pinned' : 'Unpin';
      } else if (shouldOpen) {
        const body = sec.querySelector(':scope > .pt-section-body');
        if (body) { body.style.transition = 'none'; noTrans.push(body); }
        sec.classList.add('pt-palette-section--open');
      }
    });

    if (!anyPinned) {
      const defSec = root.querySelector(`.pt-palette-section[data-sec-id="${defaultSectionId}"]`);
      if (defSec) {
        const body = defSec.querySelector(':scope > .pt-section-body');
        if (body) { body.style.transition = 'none'; noTrans.push(body); }
        defSec.classList.add('pt-palette-section--open');
      }
    }

    if (noTrans.length) {
      requestAnimationFrame(() => requestAnimationFrame(() => noTrans.forEach(b => { b.style.transition = ''; })));
    }
  }

  return { unlock };
}


// ── Dynamic Asset Loaders ─────────────────────────────────────────────────

/**
 * Idempotent stylesheet injection.  Skips if a matching href is already loaded.
 */
export function ensureStylesheet(href) {
  const a = document.createElement('a');
  a.href = href;
  const abs = a.href;
  const existing = document.querySelectorAll('link[rel="stylesheet"]');
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].href === abs) return;
  }
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = abs;
  document.head.appendChild(link);
}

/**
 * Dynamically load a script, returning a Promise that resolves on load.
 * Skips if a <script> with the same src already exists.
 */
export function loadScript(src, isModule) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    if (isModule) el.type = 'module';
    el.src = src;
    el.onload  = resolve;
    el.onerror = () => reject(new Error('Failed to load script: ' + src));
    document.head.appendChild(el);
  });
}

/**
 * Auto-detect the asset base directory from import.meta.url.
 * Convention: the calling file lives at <appRoot>/js/<file>.js,
 * so the app root is one directory up from the directory containing the file.
 *
 * @param {string} metaUrl - import.meta.url of the calling module
 * @returns {{ appBase: string, coreBase: string }}
 */
export function resolveAssetBases(metaUrl) {
  let appBase = '';
  try {
    const u = new URL(metaUrl);
    const dir = u.href.substring(0, u.href.lastIndexOf('/') + 1); // …/js/
    appBase = dir + '../';
  } catch (_) {}
  const coreBase = appBase ? appBase + '../pearcore/' : '../pearcore/';
  return { appBase, coreBase };
}


// ── Settings Persistence ──────────────────────────────────────────────────

/**
 * Load settings from localStorage.
 * @param {string|null} storageKey - null disables persistence
 * @returns {object}
 */
export function loadSettings(storageKey) {
  if (storageKey === null) return {};
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
  catch { return {}; }
}

/**
 * Save settings to localStorage.
 * @param {string|null} storageKey - null disables persistence
 * @param {object} snapshot - settings object to save
 */
export function saveSettings(storageKey, snapshot) {
  if (storageKey === null) return;
  try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch {}
}

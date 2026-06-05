/**
 * commands.js — Per-instance command registry factory.
 */

export function createCommands(root, defs = []) {
  const _commands  = new Map();
  const _listeners = [];

  for (const def of defs) {
    _commands.set(def.id, {
      id:       def.id,
      label:    def.label,
      shortcut: def.shortcut  ?? null,
      group:    def.group     ?? 'misc',
      enabled:  def.enabled   ?? true,
      buttonId: def.buttonId  ?? null,
      exec:     null,
    });
  }

  function setEnabled(id, enabled) {
    const cmd = _commands.get(id);
    if (!cmd || cmd.enabled === enabled) return;
    cmd.enabled = enabled;
    if (cmd.buttonId) {
      const el = root.querySelector('#' + cmd.buttonId);
      if (el) el.disabled = !enabled;
    }
    for (const fn of _listeners) fn(id, enabled);
  }

  function setLabel(id, label) {
    const cmd = _commands.get(id);
    if (!cmd || cmd.label === label) return;
    cmd.label = label;
    for (const fn of _listeners) fn(id, cmd.enabled, label);
  }

  function onStateChange(fn, { callNow = false } = {}) {
    _listeners.push(fn);
    if (callNow) {
      for (const cmd of _commands.values()) fn(cmd.id, cmd.enabled);
    }
  }

  function execute(id) {
    const cmd = _commands.get(id);
    if (!cmd || !cmd.exec || !cmd.enabled) return false;
    cmd.exec();
    return true;
  }

  function get(id)  { return _commands.get(id); }
  function getAll() { return _commands; }

  return { setEnabled, setLabel, onStateChange, execute, get, getAll, matchesShortcut };
}

export function matchesShortcut(e, shortcut) {
  if (!shortcut) return false;
  const parts  = shortcut.split('+');
  const rawKey = parts[parts.length - 1];

  const needsCmdCtrl = parts.some(p => p === 'CmdOrCtrl' || p === 'Cmd' || p === 'Ctrl');
  const needsShift   = parts.includes('Shift');
  const needsAlt     = parts.includes('Alt');

  if (needsCmdCtrl !== (e.metaKey || e.ctrlKey)) return false;
  if (needsShift   !== e.shiftKey)               return false;
  if (needsAlt     !== e.altKey)                 return false;

  if (e.key === rawKey || e.key.toLowerCase() === rawKey.toLowerCase()) return true;
  if (/^[0-9]$/.test(rawKey) && e.code === 'Digit' + rawKey) return true;
  return false;
}

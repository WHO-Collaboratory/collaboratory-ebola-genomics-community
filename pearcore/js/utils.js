// utils.js — Shared micro-utilities for PearTree.

export function htmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadBlob(contentOrBlob, mimeType, filename) {
  const blob = contentOrBlob instanceof Blob
    ? contentOrBlob
    : new Blob([contentOrBlob], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function overlapsZones(x1, x2, zones) {
  for (const [zl, zr] of zones) {
    if (x1 < zr && x2 > zl) return true;
  }
  return false;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function formatNumericAnnotationValue(
  value,
  def,
  decimalPlaces,
  { autoFormatter = 'fmtValue', fallback = 'string', fallbackDp = 6 } = {},
) {
  if (decimalPlaces != null) {
    const dp = Math.max(0, Math.min(10, Number(decimalPlaces)));
    return Number(value).toFixed(dp);
  }

  const autoFn = autoFormatter === 'fmt' ? def?.fmt : def?.fmtValue;
  if (typeof autoFn === 'function') return autoFn(value);

  return fallback === 'fixed'
    ? Number(value).toFixed(fallbackDp)
    : String(value);
}

export function formatDateLabelISO(value) {
  const s = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return s;
}

export function wireDropZone(el, onDrop, { checkContains = false } = {}) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', e => {
    if (checkContains && el.contains(e.relatedTarget)) return;
    el.classList.remove('drag-over');
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    onDrop(e.dataTransfer.files[0] ?? null);
  });
}

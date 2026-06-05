// typefaces.js — typeface registry and font-building utilities

export const TYPEFACES = {
  'Monospace': {
    family: 'monospace',
    styles: {
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
  'Sans-serif': {
    family: 'sans-serif',
    styles: {
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
  'Serif': {
    family: 'serif',
    styles: {
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
  'Helvetica Neue': {
    family: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    styles: {
      'Thin':        { weight: 100, fontStyle: 'normal' },
      'Thin Italic': { weight: 100, fontStyle: 'italic' },
      'Light':       { weight: 300, fontStyle: 'normal' },
      'Light Italic':{ weight: 300, fontStyle: 'italic' },
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
  'Georgia': {
    family: 'Georgia, serif',
    styles: {
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
  'System UI': {
    family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    styles: {
      'Regular':     { weight: 400, fontStyle: 'normal' },
      'Bold':        { weight: 700, fontStyle: 'normal' },
      'Italic':      { weight: 400, fontStyle: 'italic' },
      'Bold Italic': { weight: 700, fontStyle: 'italic' },
    },
    defaultStyle: 'Regular',
  },
};

export function buildFont(typefaceKey, styleName, sizePx) {
  const face = TYPEFACES[typefaceKey];
  if (!face) return `${sizePx}px ${typefaceKey}`;
  const style = face.styles[styleName] ?? face.styles[face.defaultStyle];
  const parts = [];
  if (style.fontStyle && style.fontStyle !== 'normal') parts.push(style.fontStyle);
  if (style.weight    && style.weight    !== 400)      parts.push(style.weight);
  parts.push(`${sizePx}px`);
  parts.push(face.family);
  return parts.join(' ');
}

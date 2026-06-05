/**
 * tree-io.js — Combined tree I/O helpers for Newick/NEXUS and map-oriented annotation analysis.
 */

import { extractNewick, parseNewickTree, walkTree, valuePreview } from './tree-graph.js';
export { parseDelimited } from './annotation-utils.js';

export function parseNewick(newickString, tipNameMap = null) {
  const tokens = newickString.split(/\s*('[^']*'|"[^"]*"|;|\(|\)|,|:|=|\[&|\]|\{|\})\s*/);
  let level = 0;
  let currentNode = null;
  let nodeStack = [];
  let labelNext = false;
  let lengthNext = false;
  let inAnnotation = false;
  let annotationKeyNext = true;
  let annotationKey = null;
  let isAnnotationARange = false;
  let idCounter = 0;
  function newId() { return `n${idCounter++}`; }

  for (const token of tokens.filter(t => t.length > 0)) {
    if (inAnnotation) {
      if (token === "=")          { annotationKeyNext = false; }
      else if (token === ",")     { if (!isAnnotationARange) annotationKeyNext = true; }
      else if (token === "{")     { isAnnotationARange = true; currentNode.annotations[annotationKey] = []; }
      else if (token === "}")     { isAnnotationARange = false; }
      else if (token === "]")     { inAnnotation = false; annotationKeyNext = true; }
      else {
        let t = token;
        if (t.startsWith('"') || t.startsWith("'")) t = t.slice(1);
        if (t.endsWith('"')   || t.endsWith("'"))   t = t.slice(0, -1);
        if (annotationKeyNext) {
          annotationKey = t.replace('.', '_');
        } else {
          if (isAnnotationARange) {
            if (t === '?' || t === '') { currentNode.annotations[annotationKey].push(null); }
            else { const arrNum = Number(t); currentNode.annotations[annotationKey].push(!isNaN(arrNum) ? arrNum : t); }
          } else {
            if (t === '?' || t === '') { currentNode.annotations[annotationKey] = null; }
            else { const num = Number(t); currentNode.annotations[annotationKey] = !isNaN(num) ? num : t; }
          }
        }
      }
    } else if (token === "(") {
      const node = { id: newId(), level, parent: currentNode, children: [], annotations: {} };
      level++;
      if (currentNode) nodeStack.push(currentNode);
      currentNode = node;
    } else if (token === ",") {
      labelNext = false;
      const parent = nodeStack.pop();
      parent.children.push(currentNode);
      currentNode = parent;
    } else if (token === ")") {
      labelNext = false;
      const parent = nodeStack.pop();
      parent.children.push(currentNode);
      level--;
      currentNode = parent;
      labelNext = true;
    } else if (token === ":") {
      labelNext = false;
      lengthNext = true;
    } else if (token === ";") {
      if (level > 0) throw new Error("Unbalanced brackets in Newick string");
      break;
    } else if (token === "[&") {
      inAnnotation = true;
    } else {
      if (lengthNext) {
        currentNode.length = parseFloat(token);
        lengthNext = false;
      } else if (labelNext) {
        currentNode.label = token;
        if (!token.startsWith("#")) {
          currentNode.annotations["_node_label"] = token;
        } else {
          currentNode.id = token.slice(1);
        }
        labelNext = false;
      } else {
        if (!currentNode.children) currentNode.children = [];
        let name = tipNameMap ? (tipNameMap.get(token) || token) : token;
        name = name.replace(/^['"]|['"]$/g, '').trim().replace(/'/g, '');
        const externalNode = { id: newId(), name, parent: currentNode, annotations: {} };
        if (currentNode) nodeStack.push(currentNode);
        currentNode = externalNode;
      }
    }
  }

  if (level > 0) throw new Error("Unbalanced brackets in Newick string");

  const DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
  const CURRENT_YEAR = new Date().getFullYear();
  function annotateDates(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const isTip = !node.children || node.children.length === 0;
      if (isTip && node.name && node.name.includes('|')) {
        const parts = node.name.split('|');
        const last  = parts[parts.length - 1].trim();
        if (!("date" in node.annotations)) {
          if (DATE_RE.test(last)) {
            node.annotations['date'] = last;
          } else {
            const asInt = Number(last);
            if (Number.isInteger(asInt) && asInt > 0 && asInt <= CURRENT_YEAR) {
              node.annotations['date'] = String(asInt);
            }
          }
        }
      }
      if (node.children) {
        for (let j = node.children.length - 1; j >= 0; j--) stack.push(node.children[j]);
      }
    }
  }
  if (currentNode) annotateDates(currentNode);
  return currentNode;
}

function _parseTaxonLabel(raw) {
  const annotStart = raw.indexOf('[&');
  let name = annotStart === -1 ? raw : raw.slice(0, annotStart);
  name = name.trim().replace(/^['"]|['"]$/g, '');
  const annotations = {};
  if (annotStart !== -1) {
    const annotEnd = raw.indexOf(']', annotStart);
    const inner = annotEnd === -1 ? raw.slice(annotStart + 2) : raw.slice(annotStart + 2, annotEnd);
    const tokens = inner.split(/\s*(',?"[^"]*"|'[^']*'|[=,{}])\s*/);
    let keyNext = true; let key = null; let inRange = false;
    for (const tok of tokens) {
      const t = tok.trim();
      if (!t) continue;
      if (t === '=')  { keyNext = false; continue; }
      if (t === ',')  { if (!inRange) keyNext = true; continue; }
      if (t === '{')  { inRange = true; annotations[key] = []; continue; }
      if (t === '}')  { inRange = false; continue; }
      let val = t.replace(/^['"]|['"]$/g, '');
      if (keyNext) { key = val.replace('.', '_'); }
      else {
        const num = Number(val);
        const parsed = (val === '?' || val === '') ? null : (!isNaN(num) ? num : val);
        if (inRange) { annotations[key].push(parsed); } else { annotations[key] = parsed; }
      }
    }
  }
  return { name, annotations };
}

export function parseNexus(nexus, { appName = 'settings' } = {}) {
  const trees = [];
  const _appNameRe = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = nexus.split('\n');
  let inTreesBlock = false; let inTaxaBlock = false; let inTaxLabels = false;
  const tipNameMap = new Map(); const taxonAnnotMap = new Map();
  let inTranslate = false; let appSettings = null; let inAppBlock = false; let appBuffer = '';

  for (const rawLine of lines) {
    const line = rawLine.trim(); const lower = line.toLowerCase();
    if (!inTreesBlock && (lower === 'begin taxa;' || lower.startsWith('begin taxa;'))) { inTaxaBlock = true; continue; }
    if (inTaxaBlock) {
      if (lower === 'end;' || lower === 'end') { inTaxaBlock = false; inTaxLabels = false; continue; }
      if (lower === 'taxlabels' || lower === 'taxlabels;') { inTaxLabels = true; continue; }
      if (lower.startsWith('dimensions')) continue;
      if (inTaxLabels) {
        if (line === ';') { inTaxLabels = false; continue; }
        const entry = line.replace(/;$/, '').trim();
        if (entry) { const { name, annotations } = _parseTaxonLabel(entry); if (name && Object.keys(annotations).length > 0) taxonAnnotMap.set(name, annotations); }
      }
      continue;
    }
    if (lower === 'begin trees;' || lower.startsWith('begin trees;')) { inTreesBlock = true; inTranslate = false; continue; }
    if (inTreesBlock) {
      if (lower === 'end;' || lower === 'end') { inTreesBlock = false; continue; }
      if (inAppBlock) {
        if (line.endsWith('}]')) { appBuffer += '\n' + line.slice(0, -1); inAppBlock = false; try { appSettings = JSON.parse(appBuffer); } catch {} appBuffer = ''; }
        else { appBuffer += '\n' + line; }
        continue;
      }
      if (new RegExp('^\\[' + _appNameRe + '=\\{', 'i').test(line)) {
        const singleLine = line.match(new RegExp('^\\[' + _appNameRe + '=([\\s\\S]*?)\\]$', 'i'));
        if (singleLine) { try { appSettings = JSON.parse(singleLine[1]); } catch {} }
        else { inAppBlock = true; appBuffer = line.replace(new RegExp('^\\[' + _appNameRe + '=', 'i'), ''); }
        continue;
      }
      if (lower === 'translate') { inTranslate = true; continue; }
      if (inTranslate) {
        if (line === ';') { inTranslate = false; continue; }
        const clean = line.replace(/,$/, '').replace(/;$/, '');
        const parts = clean.split(/\s+/);
        if (parts.length >= 2) tipNameMap.set(parts[0], parts.slice(1).join(' '));
        if (line.endsWith(';')) inTranslate = false;
      } else {
        const idx = line.indexOf('(');
        if (idx !== -1) {
          const root = parseNewick(line.slice(idx), tipNameMap.size > 0 ? tipNameMap : null);
          trees.push({ root, tipNameMap, appSettings });
        }
      }
    }
  }

  if (appSettings) { for (const t of trees) { if (!t.appSettings) t.appSettings = appSettings; } }
  if (taxonAnnotMap.size > 0) {
    for (const treeEntry of trees) {
      const mismatched = [];
      const stack = [treeEntry.root];
      while (stack.length) {
        const node = stack.pop();
        const isTip = !node.children || node.children.length === 0;
        if (isTip && node.name) {
          const annots = taxonAnnotMap.get(node.name);
          if (annots) { for (const [k, v] of Object.entries(annots)) { if (!(k in node.annotations)) node.annotations[k] = v; } }
          else { mismatched.push(node.name); }
        }
        if (node.children) for (const c of node.children) stack.push(c);
      }
      if (mismatched.length > 0) {
        const MAX = 5;
        console.warn(`[PearTree] ${mismatched.length} tip(s) have no matching taxa block entry: ${mismatched.slice(0,MAX).map(n=>`"${n}"`).join(', ')}${mismatched.length>MAX?` … and ${mismatched.length-MAX} more`:''}`);
        treeEntry.taxonAnnotWarnings = mismatched;
      }
    }
  }
  return trees;
}

function newickEsc(name) {
  if (!name) return '';
  if (/[(),;:\[\]\s]/.test(name)) return `'${name.replace(/'/g, "''")}'`;
  return name;
}
function fmtLen(n) {
  if (n == null || isNaN(n)) return null;
  if (n === 0) return '0';
  return parseFloat(n.toPrecision(12)).toString();
}
function fmtAnnot(annotations, annotKeys) {
  if (!annotations || annotKeys.length === 0) return '';
  const parts = [];
  for (const key of annotKeys) {
    const val = annotations[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) { parts.push(`${key}={${val.map(v => typeof v === 'string' ? `"${v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"` : v).join(',')}}`); }
    else if (typeof val === 'string') { parts.push(`${key}="${val.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`); }
    else { parts.push(`${key}=${val}`); }
  }
  return parts.length > 0 ? `[&${parts.join(',')}]` : '';
}
function branchLen(ci, pi, g) {
  if (pi < 0) return null;
  const { nodeA, nodeB, lenA, lenB } = g.root;
  if (ci === nodeA && pi === nodeB) return lenA;
  if (ci === nodeB && pi === nodeA) return lenB;
  return g.nodes[ci].lengths[0];
}
function newickNode(nodeIdx, parentIdx, g, annotKeys, nodeLabelKey, tipNameFn = null) {
  const node = g.nodes[nodeIdx];
  const annotStr = fmtAnnot(node.annotations, annotKeys);
  const childIdxs = node.adjacents.filter(i => i !== parentIdx);
  if (childIdxs.length === 0) {
    const safeName = newickEsc((tipNameFn ? tipNameFn(node) : (node.name || node.label || '')) || '');
    return `${safeName}${annotStr}`;
  }
  const parts = childIdxs.map(ci => {
    const cStr = newickNode(ci, nodeIdx, g, annotKeys, nodeLabelKey, tipNameFn);
    const len = branchLen(ci, nodeIdx, g);
    return `${cStr}${len != null ? `:${fmtLen(len)}` : ''}`;
  });
  let nodeLabel = node.name ? newickEsc(node.name) : '';
  if (nodeLabelKey) { const val = node.annotations?.[nodeLabelKey]; if (val != null && val !== '') nodeLabel = String(parseFloat(Number(val).toPrecision(6))); }
  return `(${parts.join(',')})${nodeLabel}${annotStr}`;
}

export function graphToNewick(g, subtreeRootId, annotKeys, nodeLabelKey = null, tipNameFn = null) {
  const { nodeA, nodeB, lenA } = g.root;
  let body;
  if (subtreeRootId) {
    const idx = g.origIdToIdx.get(subtreeRootId);
    if (idx === undefined) return null;
    const node = g.nodes[idx];
    const parentIdx = node.adjacents.length > 0 ? node.adjacents[0] : -1;
    body = newickNode(idx, parentIdx, g, annotKeys, nodeLabelKey, tipNameFn);
  } else if (lenA === 0) {
    body = newickNode(nodeA, -1, g, annotKeys, nodeLabelKey, tipNameFn);
  } else {
    const aStr = newickNode(nodeA, nodeB, g, annotKeys, nodeLabelKey, tipNameFn);
    const bStr = newickNode(nodeB, nodeA, g, annotKeys, nodeLabelKey, tipNameFn);
    body = `(${aStr}${lenA != null ? `:${fmtLen(lenA)}` : ''},${bStr}${g.root.lenB != null ? `:${fmtLen(g.root.lenB)}` : ''})`;
  }
  return body + ';';
}

export function buildNexus(newick, { rooted = false, appName = null, settings = null } = {}) {
  const rootedTag = rooted ? '[&R] ' : '';
  const settingsLine = (appName && settings) ? `\t[${appName}=${JSON.stringify(settings, null, 2)}]\n` : '';
  return `#NEXUS\nBEGIN TREES;\n\ttree TREE1 = ${rootedTag}${newick}\n${settingsLine}END;\n`;
}

export function analyzeTreeAnnotations(text) {
  const newick = extractNewick(text);
  const root = parseNewickTree(newick);
  const samplesByKey = {}; const keyOrder = [];
  walkTree(root, node => {
    for (const [k, v] of Object.entries(node.annotations || {})) {
      if (!samplesByKey[k]) { samplesByKey[k] = []; keyOrder.push(k); }
      if (samplesByKey[k].length < 3) samplesByKey[k].push(valuePreview(v));
    }
  });
  const annotationKeys = keyOrder;
  const suggested = {
    longitudeKey: bestKey(annotationKeys, [/\blon\b/i, /\blng\b/i, /long/i, /longitude/i, /coord.?x/i]),
    latitudeKey:  bestKey(annotationKeys, [/\blat\b/i, /latitude/i, /coord.?y/i]),
    hpdKey:       bestKey(annotationKeys, [/95.?%.*hpd/i, /hpd/i, /polygon/i, /shape/i, /region/i]),
    locationKey:  bestKey(annotationKeys, [/location/i, /state/i, /trait/i, /deme/i, /region/i]),
    posteriorKey: bestKey(annotationKeys, [/posterior/i, /prob/i, /density/i, /vector/i, /set.*prob/i]),
  };
  return { hasBeastAnnotations: annotationKeys.length > 0, annotationKeys, samplesByKey, suggested, likelyContinuous: !!(suggested.longitudeKey && suggested.latitudeKey), likelyDiscrete: !!(suggested.locationKey || suggested.posteriorKey) };
}

export function parseTreeData(text, mapping = {}) {
  const newick = extractNewick(text); const root = parseNewickTree(newick);
  const nodes = []; const branches = []; const hpdRegions = []; let nodeSeq = 0;
  function visit(node) {
    nodeSeq += 1; const nodeId = `n${nodeSeq}`;
    const lon = coerceNumber(node.annotations?.[mapping.longitudeKey]);
    const lat = coerceNumber(node.annotations?.[mapping.latitudeKey]);
    const hasCoord = Number.isFinite(lon) && Number.isFinite(lat);
    if (hasCoord) nodes.push({ id: nodeId, longitude: lon, latitude: lat, label: node.name || '', location: mapping.locationKey ? node.annotations?.[mapping.locationKey] ?? null : null, posterior: mapping.posteriorKey ? node.annotations?.[mapping.posteriorKey] ?? null : null });
    if (mapping.hpdKey) { const polygon = extractPolygon(node.annotations?.[mapping.hpdKey]); if (polygon) hpdRegions.push({ nodeId, coordinates: polygon, sourceKey: mapping.hpdKey }); }
    for (const child of node.children || []) {
      const childInfo = visit(child);
      if (hasCoord && childInfo.hasCoord) branches.push({ startLon: lon, startLat: lat, endLon: childInfo.lon, endLat: childInfo.lat, sourceNode: nodeId, targetNode: childInfo.nodeId });
    }
    return { nodeId, lon, lat, hasCoord };
  }
  visit(root);
  return { nodes, branches, hpdRegions, metadata: { mapping, nodeCount: nodes.length, branchCount: branches.length, hasDiscreteStates: !!mapping.locationKey, hasPosteriorDensity: !!mapping.posteriorKey, hasHPD: !!mapping.hpdKey } };
}

function bestKey(keys, patterns) { for (const p of patterns) { const hit = keys.find(k => p.test(k)); if (hit) return hit; } return ''; }
function coerceNumber(v) { if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) return n; } if (Array.isArray(v) && v.length === 1) return coerceNumber(v[0]); return null; }
function extractPolygon(v) { const pairs = []; function walk(x) { if (Array.isArray(x)) { if (x.length === 2) { const a = coerceNumber(x[0]); const b = coerceNumber(x[1]); if (Number.isFinite(a) && Number.isFinite(b)) { pairs.push([a, b]); return; } } for (const y of x) walk(y); } } walk(v); return pairs.length >= 3 ? pairs : null; }

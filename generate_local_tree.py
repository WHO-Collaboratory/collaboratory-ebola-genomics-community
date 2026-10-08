#!/usr/bin/env python3
"""Generate local_tree.nwk - with Pathoplexus metadata including epiweek."""
import sys, glob, re, json, os
from datetime import datetime

sys.path.insert(0, '.')

# Tree selection. Accepts an explicit path so the dashboard tree can be the
# same tree the convergence analysis was run on (asr_run.treefile), keeping
# carrier highlighting consistent with the homoplasy panel.
#
# NB: the previous glob was '*_20260*.masked.fasta.treefile', which cannot
# match dates from October 2026 onward (20261008) and silently fell back to
# a September tree. Selection is now by modification time over all trees.
if len(sys.argv) > 1:
    latest_tree = sys.argv[1]
else:
    tree_files = [f for f in glob.glob('*.treefile') if os.path.exists(f)]
    if not tree_files:
        sys.exit("No .treefile found")
    latest_tree = max(tree_files, key=os.path.getmtime)
print(f"Using tree: {latest_tree}")

with open(latest_tree) as f:
    newick = f.read().strip()

# Strip IQ-TREE internal node labels (NodeN), present when --ancestral was
# used. Left in place they would be treated as tips by the annotation step.
newick = re.sub(r'\)Node\d+', ')', newick)

# Load metadata from file
metadata = {}
try:
    if os.path.exists('pathoplexus_metadata.json'):
        print("Loading metadata from file...")
        with open('pathoplexus_metadata.json') as f:
            data = json.load(f)
        seqs = data.get('data', data.get('results', []))
        for seq in seqs:
            if seq.get('accession'):
                metadata[seq['accession']] = seq
        print(f"✓ Loaded metadata for {len(metadata)} sequences")
    else:
        print("Note: pathoplexus_metadata.json not found")
except Exception as e:
    print(f"Warning: could not load metadata ({e})")

# ---------------------------------------------------------------------------
# Prune the rooting outgroups from the displayed tree.
#
# The tree is rooted on the reference and on the 2007 BDBV strain, both of
# which are ~19 years divergent from the 2026 outbreak. Left in, their stem
# dominates the x-axis and compresses the entire outbreak into a sliver.
# The panel footnote already says the 2026 subtree is shown "rooted using
# 2007 BDBV strain (not shown)", so drop them from the display.
#
# Deleting the label by regex (as this did previously) leaves the outgroup's
# branch behind as a redundant single-child node, so parse properly, drop the
# tips, then collapse any node left with one child, carrying its length onto
# the child so distances to every remaining tip are preserved.
# ---------------------------------------------------------------------------

class _N:
    __slots__ = ('name', 'length', 'children')

    def __init__(self):
        self.name = None
        self.length = None
        self.children = []


def _parse(text):
    text = text.strip().rstrip(';')
    pos = 0

    def node():
        nonlocal pos
        n = _N()
        if pos < len(text) and text[pos] == '(':
            pos += 1
            while True:
                n.children.append(node())
                if text[pos] == ',':
                    pos += 1
                    continue
                if text[pos] == ')':
                    pos += 1
                    break
                raise ValueError(f'bad newick at {pos}: {text[pos]!r}')
        m = re.match(r"[^,:;()]+", text[pos:])
        if m:
            n.name = m.group(0).strip()
            pos += m.end()
        if pos < len(text) and text[pos] == ':':
            m = re.match(r':(-?[0-9.]+(?:[eE][-+]?\d+)?)', text[pos:])
            n.length = float(m.group(1))
            pos += m.end()
        return n

    return node()


def _prune(n, drop):
    """Drop named tips; return None if nothing survives in this subtree."""
    if not n.children:
        return None if (n.name and n.name in drop) else n
    kept = [c for c in (_prune(c, drop) for c in n.children) if c is not None]
    if not kept:
        return None
    n.children = kept
    # collapse a node left with a single child, preserving total distance
    if len(kept) == 1:
        child = kept[0]
        child.length = (child.length or 0.0) + (n.length or 0.0)
        return child
    return n


def _write(n):
    if n.children:
        inner = ','.join(_write(c) for c in n.children)
        s = f'({inner})'
    else:
        s = n.name or ''
    if n.length is not None:
        s += f':{n.length:.10f}'
    return s


# Outgroups: the reference, plus any tip whose metadata predates the outbreak.
_tip_names = re.findall(r'[(,]([^,:()]+):', newick)
outgroups = {'NC_014373.1'}
for _t in _tip_names:
    _meta = metadata.get(re.sub(r'\.\d+$', '', _t), {})
    _date = str(_meta.get('sampleCollectionDate', '') or '')
    if _date and not _date.startswith('2026'):
        outgroups.add(_t)

_root = _prune(_parse(newick), outgroups)
if _root is None:
    sys.exit('Pruning removed every tip - check the outgroup list')
_root.length = None  # root has no incoming branch
newick = _write(_root) + ';'
print(f"Pruned {len(outgroups)} outgroup tip(s) from display: "
      f"{', '.join(sorted(outgroups))}")
while '()' in newick:
    newick = newick.replace('()', '')

# Helper to calculate ISO week number
def iso_epi_week(date_str):
    if not date_str or len(date_str) < 10:
        return ''
    try:
        d = datetime.strptime(date_str[:10], '%Y-%m-%d')
        return str(d.isocalendar()[1])
    except:
        return ''

# Add metadata attributes
def add_metadata(match):
    name_full = match.group(1)
    name = re.sub(r'\.\d+$', '', name_full)
    m = metadata.get(name, {})

    # Map Pathoplexus fields
    country = m.get('geoLocCountry', '')
    admin1 = m.get('geoLocAdmin1', '')
    admin2 = m.get('geoLocAdmin2', '')
    date = m.get('sampleCollectionDate', '')

    loc = admin2 or admin1 or country
    epiweek = iso_epi_week(date)

    # Format date
    short_date = ''
    if date and len(date) >= 10:
        sd = date[5:10]
        short_date = date[:4] if sd == '01-01' else sd
    elif date:
        short_date = date[:4]

    # Label
    label_parts = [name, loc, short_date]
    label = ' · '.join(p for p in label_parts if p).replace("'", "''")

    # Attributes with epiweek (as numeric for gradient coloring)
    ew_attr = f',epiweek={epiweek}' if epiweek else ''
    prov_attr = f',province="{admin1}"' if admin1 else ''
    attrs = f'[&accession="{name}",date="{date}",country="{country}",division="{admin1}",location="{loc}"{prov_attr}{ew_attr}]'
    return f"'{label}'{attrs}"

newick = re.sub(r'([A-Za-z0-9_\.]+)(?=:[0-9e\.\-])', add_metadata, newick)

with open('local_tree.nwk', 'w') as f:
    f.write(newick)

print(f"✓ Generated local_tree.nwk")
print(f"  Branch lengths: preserved")
print(f"  Metadata: {len(metadata)} sequences with epiweek, location, country, date")

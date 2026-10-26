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


# Phylogenetic outliers the dashboard already states are excluded from the
# tree. Keep in step with TREE_EXCLUSIONS in dashboard.html, which applies
# these to the Nextstrain tree; without them here the panel's "Excluded from
# tree" footnote is untrue for the local tree, and PP_00764QW's artefactual
# branch is the longest in it.
QC_EXCLUSIONS = {'PP_00764QW', 'PP_0075Z66'}

# Outgroups: the reference, plus any tip whose metadata predates the outbreak.
_tip_names = re.findall(r'[(,]([^,:()]+):', newick)
outgroups = {'NC_014373.1'}
excluded = set()
for _t in _tip_names:
    _bare = re.sub(r'\.\d+$', '', _t)
    if _bare in QC_EXCLUSIONS:
        excluded.add(_t)
        continue
    _meta = metadata.get(_bare, {})
    _date = str(_meta.get('sampleCollectionDate', '') or '')
    if _date and not _date.startswith('2026'):
        outgroups.add(_t)

# Dropping the outgroups leaves the root with a single child, which collapses
# to make the MRCA of the 2026 outbreak the displayed root.
_root = _prune(_parse(newick), outgroups | excluded)
if _root is None:
    sys.exit('Pruning removed every tip - check the outgroup list')
_root.length = None  # root has no incoming branch
newick = _write(_root) + ';'
print(f"Pruned {len(outgroups)} outgroup tip(s): {', '.join(sorted(outgroups))}")
if excluded:
    print(f"Excluded {len(excluded)} QC outlier(s): {', '.join(sorted(excluded))}")
while '()' in newick:
    newick = newick.replace('()', '')

# Helper to calculate ISO week number
def is_precise_date(date_str):
    """True only for a full YYYY-MM-DD.

    Pathoplexus also carries partial dates ("2026-05") and ranges
    ("2026-01-01/2026-08-28", a span of eight months). Taking the first ten
    characters of a range turns an unknown date into a precise one: one such
    record was rendered as epi week 1 against a real range of 18-43, which
    stretched the colour scale so that almost every genome fell in the top
    half of it and the tree looked uniformly coloured.
    """
    return bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', (date_str or '').strip()))


def iso_epi_week(date_str):
    if not is_precise_date(date_str):
        return ''
    try:
        d = datetime.strptime(date_str.strip(), '%Y-%m-%d')
        return str(d.isocalendar()[1])
    except ValueError:
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
    date = m.get('sampleCollectionDate', '') or ''
    # Only a day-precise date is published as the tip's date. PearTree reads
    # this for the root-to-tip regression and the time axis, so a range or a
    # partial date must not be passed off as a point in time.
    if not is_precise_date(date):
        date = ''

    # Outside DRC the sub-national fields are not reliably a place: Uganda
    # repeats the country in admin1, the Kenyan genomes carry the sequencing
    # laboratory (NGMSL) and the Nigerian one a city. Prefixing the country
    # makes a tip like "Abuja" or "NGMSL" readable as "Nigeria - Abuja" or
    # "Kenya - NGMSL" without discarding what was submitted.
    DRC = "Democratic Republic of the Congo"
    sub = admin2 or admin1
    # "unknown" / "Not provided" are non-answers, not places
    if sub and sub.strip().lower() in {"unknown", "not provided", "not stated",
                                       "n/a", "na", "none"}:
        sub = ""
    if country and country != DRC:
        loc = f"{country} - {sub}" if sub and sub != country else country
    else:
        loc = sub or country
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

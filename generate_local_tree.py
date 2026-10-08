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

# Remove reference
newick = re.sub(r'NC_014373\.1:[0-9e\.\-]+', '', newick)
newick = re.sub(r'\(\s*,', '(', newick)
newick = re.sub(r',\s*,', ',', newick)
newick = re.sub(r',\s*\)', ')', newick)
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

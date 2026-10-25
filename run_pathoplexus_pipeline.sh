#!/bin/bash

##############################################################################
# Pathoplexus 2026 Ebola Analysis Pipeline
# Pulls sequences, combines with reference, QC, aligns, masks, and builds tree
##############################################################################

set -e  # Exit on error

# Configuration
WORK_DIR="$(pwd)"
REF_GENOME="${WORK_DIR}/NC_014373.1.fasta"
# Overridable so CI can point at a Linux build on PATH.
IQTREE_BIN="${IQTREE_BIN:-$HOME/Downloads/iqtree-3.0.1-macOS/bin/iqtree3}"
MAX_N_FRACTION="0.15"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Output files
RAW_SEQUENCES="${WORK_DIR}/sequences_raw_${TIMESTAMP}.fasta"
COMBINED_FASTA="${WORK_DIR}/sequences_combined_${TIMESTAMP}.fasta"
RACCOON_ALN_DIR="${WORK_DIR}/raccoon_aln_${TIMESTAMP}"
QC_REPORT="${WORK_DIR}/seq-qc_report.html"
FILTERED_SEQUENCES="${WORK_DIR}/sequences_filtered_${TIMESTAMP}.fasta"
ALIGNED_FASTA="${WORK_DIR}/aln_ref_${TIMESTAMP}.fasta"
MASKED_FASTA="${WORK_DIR}/aln_ref_${TIMESTAMP}.masked.fasta"
TREE_FILE="${WORK_DIR}/aln_ref_${TIMESTAMP}.masked.fasta.treefile"

echo "=========================================="
echo "Pathoplexus 2026 Pipeline"
echo "=========================================="
echo "Working directory: ${WORK_DIR}"
echo "Timestamp: ${TIMESTAMP}"
echo ""

# Step 1: Check prerequisites
echo "[1/8] Checking prerequisites..."
if [ ! -f "$REF_GENOME" ]; then
    echo "ERROR: Reference genome not found: $REF_GENOME"
    exit 1
fi

# Accept either a path to the binary or a command on PATH, so the same script
# runs against a local download and a CI-installed build.
if [ ! -x "$IQTREE_BIN" ] && ! command -v "$IQTREE_BIN" >/dev/null 2>&1; then
    echo "ERROR: iqtree3 not found: $IQTREE_BIN"
    echo "Set IQTREE_BIN to the binary's path, or put it on PATH."
    exit 1
fi

if ! command -v mafft &> /dev/null; then
    echo "ERROR: mafft not found in PATH"
    exit 1
fi

if ! command -v raccoon &> /dev/null; then
    echo "ERROR: raccoon not found in PATH"
    exit 1
fi

echo "✓ All prerequisites found"
echo ""

# Step 2: Download sequences from Pathoplexus LAPIS
echo "[2/8] Downloading 2026 sequences from Pathoplexus..."

PATHOPLEXUS_URL="https://lapis.pathoplexus.org/ebola-bdbv/sample/unalignedNucleotideSequences?outbreak=Bdbv-2026&versionStatus=LATEST_VERSION"

echo "Downloading from Pathoplexus LAPIS..."
echo "URL: $PATHOPLEXUS_URL"
echo ""

# Download sequences from Pathoplexus
curl -s "$PATHOPLEXUS_URL" \
    -o "$RAW_SEQUENCES"

if [ ! -f "$RAW_SEQUENCES" ] || [ ! -s "$RAW_SEQUENCES" ]; then
    echo "ERROR: Failed to download sequences from Pathoplexus"
    echo "URL: $PATHOPLEXUS_URL"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check your internet connection"
    echo "2. Verify the Pathoplexus LAPIS server is accessible"
    echo "3. Try the command manually:"
    echo "   curl \"$PATHOPLEXUS_URL\" -o test.fasta"
    echo "4. If manual download works, check file permissions"
    exit 1
fi

SEQ_COUNT=$(grep -c "^>" "$RAW_SEQUENCES" || echo 0)
echo "✓ Downloaded $SEQ_COUNT sequences"

# Cross-check the download against the number Pathoplexus reports holding.
# These URLs previously carried limit=1000, which silently truncated the
# download once the outbreak passed a thousand genomes: the pipeline ran
# normally and simply analysed less data than was available. Ask LAPIS how
# many there should be and refuse to continue on a short download.
AGG_URL="https://lapis.pathoplexus.org/ebola-bdbv/sample/aggregated?outbreak=Bdbv-2026&versionStatus=LATEST_VERSION"
EXPECTED=$(curl -s --max-time 60 "$AGG_URL" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['count'])" 2>/dev/null || echo "")

if [ -z "$EXPECTED" ]; then
    echo "  (could not reach the aggregated endpoint to verify the count)"
elif [ "$SEQ_COUNT" -lt "$EXPECTED" ]; then
    echo ""
    echo "ERROR: short download - got $SEQ_COUNT of $EXPECTED available sequences."
    echo "Pathoplexus holds more genomes than were downloaded. Check the request"
    echo "URL for a limit parameter, or for server-side paging."
    exit 1
else
    echo "  verified against Pathoplexus: $EXPECTED available"
fi
echo ""

# Step 2a: Download contextual sequence (PP_006X68B)
echo "[2a/8] Downloading contextual sequence from Pathoplexus..."
CONTEXT_SEQUENCES="${WORK_DIR}/context_sequences.fasta"
CONTEXT_URL="https://lapis.pathoplexus.org/ebola-bdbv/sample/unalignedNucleotideSequences?accession=PP_006X68B&versionStatus=LATEST_VERSION"

echo "Downloading PP_006X68B as contextual sequence..."
curl -s "$CONTEXT_URL" -o "$CONTEXT_SEQUENCES"

if [ -f "$CONTEXT_SEQUENCES" ] && [ -s "$CONTEXT_SEQUENCES" ]; then
    CONTEXT_COUNT=$(grep -c "^>" "$CONTEXT_SEQUENCES" || echo 0)
    echo "✓ Downloaded $CONTEXT_COUNT contextual sequence(s)"
    # Add context sequences to outbreak sequences
    cat "$CONTEXT_SEQUENCES" >> "$RAW_SEQUENCES"
    SEQ_COUNT=$((SEQ_COUNT + CONTEXT_COUNT))
    echo "✓ Total sequences: $SEQ_COUNT (including context)"
else
    echo "WARNING: Could not download PP_006X68B (will proceed without it)"
fi
echo ""

# Step 2b: Download metadata from Pathoplexus (includes contextual sequences)
echo "[2b/8] Downloading ALL BDBV metadata from Pathoplexus..."
METADATA_URL="https://lapis.pathoplexus.org/ebola-bdbv/sample/details?versionStatus=LATEST_VERSION"
METADATA_FILE="${WORK_DIR}/pathoplexus_metadata.json"

echo "Downloading metadata (includes contextual sequences like PP_006X68B)..."
curl -s "$METADATA_URL" -o "$METADATA_FILE"

if [ ! -f "$METADATA_FILE" ] || [ ! -s "$METADATA_FILE" ]; then
    echo "WARNING: Failed to download metadata from Pathoplexus"
    echo "Trees will work but without country/location coloring"
else
    META_COUNT=$(grep -o '"accession"' "$METADATA_FILE" | wc -l)
    BDBV_2026=$(grep -o '"outbreak":"Bdbv-2026"' "$METADATA_FILE" | wc -l)
    echo "✓ Downloaded metadata for $META_COUNT BDBV sequences"
    echo "  - $BDBV_2026 from 2026 outbreak"
    echo "  - Plus contextual sequences for rooting/context"
fi
echo ""

# Step 3: Combine with reference
echo "[3/8] Combining sequences with reference genome..."
cat "$REF_GENOME" "$RAW_SEQUENCES" > "$COMBINED_FASTA"
COMBINED_COUNT=$(grep -c "^>" "$COMBINED_FASTA" || echo 0)
echo "✓ Combined file contains $COMBINED_COUNT sequences"
echo ""

# Step 4: Run raccoon sequence alignment QC
echo "[4/8] Running raccoon sequence QC (raccoon seq-aln)..."
mkdir -p "$RACCOON_ALN_DIR"
raccoon seq-qc \
    -f "$COMBINED_FASTA"
echo "✓ raccoon seq-aln complete"
echo "   Report: $QC_REPORT"
echo ""

# Step 5: Filter sequences based on N content
echo "[5/8] Filtering sequences (N > ${MAX_N_FRACTION})..."

if [ ! -f "$QC_REPORT" ]; then
    echo "ERROR: QC report not found: $QC_REPORT"
    exit 1
fi

# Parse HTML report to extract sequences with N fraction > threshold
# This is a simple approach - may need adjustment based on actual HTML format
python3 << EOF
import re
import sys

html_file = "$QC_REPORT"
max_n = $MAX_N_FRACTION
combined_fasta = "$COMBINED_FASTA"
filtered_fasta = "$FILTERED_SEQUENCES"

# Read HTML report and extract pass/fail
passed_seqs = set()
try:
    with open(html_file, 'r') as f:
        content = f.read()
        # Look for table entries or similar - adjust regex based on actual HTML format
        # This is a placeholder pattern
        for match in re.finditer(r'<tr.*?</tr>', content, re.DOTALL):
            if 'PASS' in match.group(0):
                # Extract sequence name - adjust based on actual HTML structure
                seq_match = re.search(r'>([^<]+)</.*?PASS', match.group(0))
                if seq_match:
                    passed_seqs.add(seq_match.group(1))
except Exception as e:
    print(f"Warning: Could not parse HTML report: {e}")
    print("Will include all sequences.")
    passed_seqs = None

# Filter FASTA
current_seq = None
current_header = None
write_seq = False

with open(combined_fasta, 'r') as f_in:
    with open(filtered_fasta, 'w') as f_out:
        for line in f_in:
            if line.startswith('>'):
                current_header = line.strip()
                current_seq = ''
                # Check if sequence passed QC
                if passed_seqs is None:
                    write_seq = True
                else:
                    seq_id = current_header.lstrip('>')
                    write_seq = any(seq_id in s or s.startswith(seq_id) for s in passed_seqs)
            else:
                current_seq += line.strip()
                if write_seq:
                    # Only write if not yet written
                    if not hasattr(filter, 'written_headers'):
                        filter.written_headers = set()
                    if current_header not in filter.written_headers:
                        # Will write on next header
                        pass

# Re-do this more carefully
seq_dict = {}
current_header = None
with open(combined_fasta, 'r') as f:
    for line in f:
        if line.startswith('>'):
            current_header = line.strip().lstrip('>')
            seq_dict[current_header] = ''
        else:
            seq_dict[current_header] += line.strip()

# Filter and write
filtered_count = 0
with open(filtered_fasta, 'w') as f:
    for header, seq in seq_dict.items():
        n_count = seq.upper().count('N')
        n_fraction = n_count / len(seq) if seq else 0

        if n_fraction <= max_n:
            f.write(f'>{header}\n')
            # Write sequence in 80-char lines
            for i in range(0, len(seq), 80):
                f.write(seq[i:i+80] + '\n')
            filtered_count += 1

print(f"Filtered: {filtered_count} sequences passed (N ≤ {max_n})")
print(f"Removed: {len(seq_dict) - filtered_count} sequences")
EOF

FILTERED_COUNT=$(grep -c "^>" "$FILTERED_SEQUENCES" || echo 0)
echo "✓ Filtered to $FILTERED_COUNT sequences"
echo ""

# Step 6: Run MAFFT alignment, anchored on the reference
#
# Each sequence is aligned to the reference independently (--add) rather than
# all against each other. A progressive alignment has nothing holding a
# sequence to the reference, so a genome with a ragged, N-heavy end can have
# its terminal sequence placed in the wrong columns: three Nanopore genomes
# with heavy 3' dropout had their trailer put ~224 positions early, which
# registered as ~57 differences each, put them on a long branch together, and
# fed spurious sites into the convergence analysis.
#
# --keeplength holds the output to the reference's coordinates, so an
# alignment column is a genomic position. That also makes the result stable
# as genomes accumulate: adding sequences cannot re-shuffle the ones already
# aligned, which a progressive alignment is free to do on every rerun.
echo "[6/8] Running MAFFT alignment (reference-anchored)..."
REF_ONLY="${WORK_DIR}/_mafft_ref_${TIMESTAMP}.fasta"
TO_ADD="${WORK_DIR}/_mafft_add_${TIMESTAMP}.fasta"

python3 - "$FILTERED_SEQUENCES" "$REF_ONLY" "$TO_ADD" <<'PYSPLIT'
import sys
src, ref_out, add_out = sys.argv[1], sys.argv[2], sys.argv[3]
recs, name, buf = [], None, []
for line in open(src):
    line = line.rstrip()
    if line.startswith(">"):
        if name is not None:
            recs.append((name, "".join(buf)))
        name, buf = line[1:], []
    elif line:
        buf.append(line)
if name is not None:
    recs.append((name, "".join(buf)))

ref = [r for r in recs if r[0].split()[0].startswith("NC_014373")]
rest = [r for r in recs if not r[0].split()[0].startswith("NC_014373")]
if not ref:
    sys.exit("Reference NC_014373.1 not found in the filtered sequences")
with open(ref_out, "w") as fh:
    for n, q in ref:
        fh.write(f">{n}\n{q}\n")
with open(add_out, "w") as fh:
    for n, q in rest:
        fh.write(f">{n}\n{q}\n")
print(f"  reference: {len(ref)}, to align: {len(rest)}")
PYSPLIT

# Align each sequence to the reference on its own. Adding the whole batch in
# one --add call is not enough: MAFFT aligns the added sequences as a group,
# so genomes that fail the same way slide together and stay misplaced. Three
# Nanopore genomes with heavy 3' dropout did exactly that. Aligned singly they
# land correctly, and at ~0.2s each this costs a few minutes.
SPLIT_DIR="${WORK_DIR}/_mafft_split_${TIMESTAMP}"
mkdir -p "$SPLIT_DIR"

python3 - "$TO_ADD" "$SPLIT_DIR" <<'PYSPLIT2'
import os, sys
src, outdir = sys.argv[1], sys.argv[2]
name, buf, n = None, [], 0
def flush(name, buf):
    if name is None:
        return 0
    with open(os.path.join(outdir, f"{abs(hash(name)) % (10**12)}_{len(buf)}.fa"), "w") as fh:
        fh.write(f">{name}\n{''.join(buf)}\n")
    return 1
for line in open(src):
    line = line.rstrip()
    if line.startswith(">"):
        n += flush(name, buf)
        name, buf = line[1:], []
    elif line:
        buf.append(line)
n += flush(name, buf)
print(f"  split into {n} single-sequence files")
PYSPLIT2

ALIGN_PARTS="${WORK_DIR}/_mafft_parts_${TIMESTAMP}"
mkdir -p "$ALIGN_PARTS"
find "$SPLIT_DIR" -name '*.fa' -print0 \
  | xargs -0 -P "${ALIGN_JOBS:-8}" -I{} sh -c \
      'mafft --quiet --auto --keeplength --add "$1" "$2" 2>/dev/null \
         | awk "/^>/{n++} n==2" > "$3/$(basename "$1").aln"' \
      _ {} "$REF_ONLY" "$ALIGN_PARTS"

# Reference first, then every aligned sequence.
cat "$REF_ONLY" > "$ALIGNED_FASTA"
cat "$ALIGN_PARTS"/*.aln >> "$ALIGNED_FASTA"

ALIGNED_N=$(grep -c "^>" "$ALIGNED_FASTA" || echo 0)
EXPECTED_N=$(( $(grep -c "^>" "$TO_ADD") + 1 ))
if [ "$ALIGNED_N" -ne "$EXPECTED_N" ]; then
    echo "ERROR: aligned $ALIGNED_N sequences, expected $EXPECTED_N"
    exit 1
fi
rm -rf "$SPLIT_DIR" "$ALIGN_PARTS"
rm -f "$REF_ONLY" "$TO_ADD"

ALN_LEN=$(python3 -c "
import sys
n=0
for line in open('$ALIGNED_FASTA'):
    if line.startswith('>'):
        if n: break
        continue
    n+=len(line.strip())
print(n)")
echo "✓ MAFFT alignment complete (length ${ALN_LEN}, reference coordinates)"
echo ""

# Step 7: Run raccoon alignment QC and masking
echo "[7/8] Running raccoon alignment QC and masking..."
RACCOON_MASK_DIR="${WORK_DIR}/raccoon_mask_${TIMESTAMP}"
mkdir -p "$RACCOON_MASK_DIR"

raccoon aln-qc \
    "$ALIGNED_FASTA"
echo "✓ raccoon aln-qc complete"

raccoon mask --mask-file mask_sites.csv\
    "$ALIGNED_FASTA" \
    --outfile "$MASKED_FASTA"
echo "✓ raccoon mask --mask-file mask_sites.csv complete"
echo "   Masked alignment: $MASKED_FASTA"
echo ""

# Step 8: Run IQTree3
echo "[8/8] Building phylogenetic tree (IQTree3)..."
# -seed and a fixed thread count, not -nt AUTO: without them the same
# alignment gives a different tree on each run. Within this outbreak most
# internal branches carry one or two substitutions, so the search has little
# to separate competing topologies and lands somewhere different each time -
# two runs on identical input differed at 71 of ~280 internal splits, which
# moved the downstream count of independent origins from 16 to 20. The thread
# count matters as well as the seed, because IQ-TREE's parallel reductions are
# not order-independent.
"$IQTREE_BIN" \
    -s "$MASKED_FASTA" \
    -m TEST \
    --polytomy \
    -seed "${IQTREE_SEED:-20260101}" \
    -T "${IQTREE_THREADS:-4}"
echo "✓ IQTree3 complete"
echo "   Tree file: ${MASKED_FASTA}.treefile"
echo ""

# Summary
echo "=========================================="
echo "Complete Pipeline Finished!"
echo "=========================================="
echo ""
echo "Output files:"
echo "  Masked alignment:    $MASKED_FASTA"
echo "  Tree file:          ${MASKED_FASTA}.treefile"
echo ""
echo "Next: ./run_asr_analysis.sh $MASKED_FASTA"
echo "  Convergent-mutation analysis is a separate step and builds the"
echo "  dashboard data from this alignment and tree."
echo ""

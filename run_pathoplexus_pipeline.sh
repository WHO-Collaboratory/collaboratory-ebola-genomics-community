#!/bin/bash

##############################################################################
# Pathoplexus 2026 Ebola Analysis Pipeline
# Pulls sequences, combines with reference, QC, aligns, masks, and builds tree
##############################################################################

set -e  # Exit on error

# Configuration
WORK_DIR="$(pwd)"
REF_GENOME="${WORK_DIR}/NC_014373.1.fasta"
IQTREE_BIN="${HOME}/Downloads/iqtree-3.0.1-macOS/bin/iqtree3"
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

if [ ! -f "$IQTREE_BIN" ]; then
    echo "ERROR: iqtree3 not found: $IQTREE_BIN"
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

# Step 6: Run MAFFT alignment
echo "[6/8] Running MAFFT alignment (mafft --auto)..."
mafft --auto "$FILTERED_SEQUENCES" > "$ALIGNED_FASTA"
echo "✓ MAFFT alignment complete"
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
"$IQTREE_BIN" \
    -s "$MASKED_FASTA" \
    -m TEST \
    --polytomy \
    -nt AUTO
echo "✓ IQTree3 complete"
echo "   Tree file: ${MASKED_FASTA}.treefile"
echo ""

# Step 9: Run homoplasy analysis
echo "[9/9] Running phylogenetic homoplasy analysis..."
HOMOPLASY_REPORT="${WORK_DIR}/homoplasy_with_proteins_${TIMESTAMP}.txt"

python3 "${WORK_DIR}/phylogenetic_homoplasy_with_proteins.py" \
    "${WORK_DIR}/NC_014373.1.gb" \
    "$MASKED_FASTA" \
    "${MASKED_FASTA}.treefile" \
    "$HOMOPLASY_REPORT"

if [ -f "$HOMOPLASY_REPORT" ]; then
    echo "✓ Homoplasy analysis complete"
    echo "   Report: $HOMOPLASY_REPORT"
else
    echo "WARNING: Homoplasy analysis may have failed"
fi
echo ""

# Summary
echo "=========================================="
echo "Complete Pipeline Finished!"
echo "=========================================="
echo ""
echo "Output files:"
echo "  Masked alignment:    $MASKED_FASTA"
echo "  Tree file:          ${MASKED_FASTA}.treefile"
echo "  Homoplasy report:   $HOMOPLASY_REPORT"
echo ""

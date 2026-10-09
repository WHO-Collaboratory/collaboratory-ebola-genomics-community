#!/bin/bash
################################################################################
# Convergent-mutation analysis via IQ-TREE ancestral state reconstruction.
#
# Replaces the monophyly-heuristic pipeline (run_homoplasy_analysis.sh), which
# was rooting-dependent and treated ambiguity codes and missing data as alleles.
#
# Usage: ./run_asr_analysis.sh <alignment.fasta> [outgroup] [prefix]
################################################################################

set -euo pipefail

ALIGN="${1:?usage: $0 <alignment.fasta> [outgroup] [prefix]}"
OUTGROUP="${2:-NC_014373.1}"
PREFIX="${3:-asr_run}"
GENBANK="${GENBANK:-NC_014373.1.gb}"
IQTREE="${IQTREE:-$HOME/Downloads/iqtree-3.0.1-macOS/bin/iqtree3}"
MODEL="${MODEL:-GTR+F+I+G4}"

# Quality thresholds. Sites and sequences above these are dropped; raising
# them weakens every downstream claim, so change them deliberately.
MAX_SEQ_MISSING="${MAX_SEQ_MISSING:-0.10}"
MAX_SITE_MISSING="${MAX_SITE_MISSING:-0.10}"
MIN_STATE_PROB="${MIN_STATE_PROB:-0.9}"

# Site masked by the Nextstrain BDBV build as "a polymorphic site in a variable
# region in GP that conflicts with outgroup rooting".
MASK_SITES="${MASK_SITES:-7461}"
# Sequences with ADAR editing signatures, excluded upstream by Nextstrain.
EXCLUDE_FILE="${EXCLUDE_FILE:-defaults/exclude_bdbv_adar.txt}"

[ -x "$IQTREE" ] || { echo "IQ-TREE not found at $IQTREE (set IQTREE=)"; exit 1; }
[ -f "$ALIGN" ]   || { echo "Alignment not found: $ALIGN"; exit 1; }
[ -f "$GENBANK" ] || { echo "GenBank not found: $GENBANK (set GENBANK=)"; exit 1; }

echo "== 1/3 filtering alignment =="
python3 asr_prep.py "$ALIGN" "$OUTGROUP" \
    --out "${PREFIX}_input" \
    --max-seq-missing "$MAX_SEQ_MISSING" \
    --max-site-missing "$MAX_SITE_MISSING" \
    --mask-sites "$MASK_SITES" \
    ${EXCLUDE_FILE:+--exclude "$EXCLUDE_FILE"}

echo
echo "== 2/3 IQ-TREE ancestral state reconstruction =="
# -o roots the written tree on the outgroup; --ancestral is the -asr switch.
"$IQTREE" -s "${PREFIX}_input.fasta" \
    -m "$MODEL" \
    -o "$OUTGROUP" \
    --ancestral \
    --polytomy \
    -nt AUTO \
    --prefix "$PREFIX" \
    -redo

echo
echo "== 3/3 counting substitutions per branch =="
python3 asr_homoplasy.py \
    --prefix "$PREFIX" \
    --posmap "${PREFIX}_input.posmap.json" \
    --alignment "${PREFIX}_input.fasta" \
    --genbank "$GENBANK" \
    --min-state-prob "$MIN_STATE_PROB" \
    --out "${PREFIX}_homoplasy_report.txt" \
    --json-out "${PREFIX}_homoplasy.json"

echo
echo "== 4/5 building dashboard data =="
python3 asr_dashboard_json.py \
    --in "${PREFIX}_homoplasy.json" \
    --out homoplasy_data.json

echo
echo "== 5/5 rebuilding dashboard tree =="
# Same tree the convergence analysis ran on, so carrier highlighting in the
# homoplasy panel matches the tips actually analysed.
python3 generate_local_tree.py "${PREFIX}.treefile"

echo
echo "Done."
echo "  report    : ${PREFIX}_homoplasy_report.txt"
echo "  full JSON : ${PREFIX}_homoplasy.json"
echo "  dashboard : homoplasy_data.json + local_tree.nwk"
echo
echo "homoplasy_data.json and local_tree.nwk are fetched at runtime by"
echo "dashboard.html, so both must be committed for the published site."

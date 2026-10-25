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
# Genome termini carry sequencing artefacts and are where ragged ends get
# misplaced. Masked by the Nextstrain BDBV build and by published phylodynamic
# analyses of this outbreak.
MASK_START="${MASK_START:-0}"
MASK_END="${MASK_END:-40}"
# Rate outliers and QC failures, per the Nextstrain BDBV exclusion list. ADAR-
# edited genomes are deliberately NOT excluded - their edits are masked instead.
EXCLUDE_FILE="${EXCLUDE_FILE:-defaults/exclude_bdbv.txt}"

[ -x "$IQTREE" ] || { echo "IQ-TREE not found at $IQTREE (set IQTREE=)"; exit 1; }
[ -f "$ALIGN" ]   || { echo "Alignment not found: $ALIGN"; exit 1; }
[ -f "$GENBANK" ] || { echo "GenBank not found: $GENBANK (set GENBANK=)"; exit 1; }

echo "== 1/6 filtering alignment =="
python3 asr_prep.py "$ALIGN" "$OUTGROUP" \
    --out "${PREFIX}_input" \
    --max-seq-missing "$MAX_SEQ_MISSING" \
    --max-site-missing "$MAX_SITE_MISSING" \
    --mask-sites "$MASK_SITES" \
    --mask-start "$MASK_START" \
    --mask-end "$MASK_END" \
    ${EXCLUDE_FILE:+--exclude "$EXCLUDE_FILE"}

echo
echo "== 2/6 IQ-TREE ancestral state reconstruction =="
# -o roots the written tree on the outgroup; --ancestral is the -asr switch.
"$IQTREE" -s "${PREFIX}_input.fasta" \
    -m "$MODEL" \
    -o "$OUTGROUP" \
    --ancestral \
    --polytomy \
    -nt AUTO \
    --prefix "$PREFIX" \
    -redo

# Which alignment and state files the counting step reads. Reset below if
# ADAR masking runs.
ACTIVE_ALIGNMENT="${PREFIX}_input.fasta"
ACTIVE_PREFIX="$PREFIX"

echo
if [ "${ADAR_MASK:-1}" = "0" ]; then
    echo "== 3/6 masking ADAR edits == (skipped: ADAR_MASK=0)"
else
    echo "== 3/6 detecting and masking ADAR editing clusters =="
    # ADAR is processive: one encounter with duplex RNA leaves a run of T>C
    # edits. Counted per-site they look like many independent mutations and
    # mint spurious homoplasies. Keep the first edit of each run, mask the
    # rest. Needs the tree and ancestral states, so it runs after the first
    # reconstruction and before the counting.
    python3 adar_mask.py \
        --prefix "$PREFIX" \
        --alignment "${PREFIX}_input.fasta" \
        --out-alignment "${PREFIX}_input.adar.fasta" \
        --max-gap "${ADAR_MAX_GAP:-200}" \
        --min-count "${ADAR_MIN_COUNT:-3}" \
        --report "${PREFIX}_adar_report.txt"

    echo
    echo "== 4/6 re-running ancestral reconstruction on the masked alignment =="
    # The alignment changed, so the ancestral states must be recomputed. The
    # tree is fixed to the one already inferred (-te): masking removes edits
    # that should never have been independent evidence, not signal that
    # should re-shape the topology, and holding the tree keeps the two passes
    # comparable.
    # Fixed thread count, not -nt AUTO: IQ-TREE 3.0.1 segfaults in its
    # multi-threading probe when the tree is fixed with -te. The probe times
    # trial likelihood evaluations, which is pointless here anyway since the
    # topology is not being searched.
    "$IQTREE" -s "${PREFIX}_input.adar.fasta" \
        -m "$MODEL" \
        -te "${PREFIX}.treefile" \
        -o "$OUTGROUP" \
        --ancestral \
        -T "${ADAR_THREADS:-4}" \
        --prefix "${PREFIX}_adar" \
        -redo

    # Point the remaining steps at the masked alignment and its states,
    # keeping the unmasked originals so the two passes can be compared and a
    # rerun starts from the same place.
    ACTIVE_ALIGNMENT="${PREFIX}_input.adar.fasta"
    ACTIVE_PREFIX="${PREFIX}_adar"
    # Do NOT copy the first-pass tree over it. The -te run keeps the topology
    # but re-estimates branch lengths on the masked alignment, and those are
    # the lengths that should be shown and analysed: an unmasked branch is
    # inflated by edits that are one event, not many.
fi

echo
echo "== 5/6 counting substitutions per branch =="
python3 asr_homoplasy.py \
    --prefix "$ACTIVE_PREFIX" \
    --posmap "${PREFIX}_input.posmap.json" \
    --alignment "$ACTIVE_ALIGNMENT" \
    --genbank "$GENBANK" \
    --min-state-prob "$MIN_STATE_PROB" \
    --out "${PREFIX}_homoplasy_report.txt" \
    --json-out "${PREFIX}_homoplasy.json"

echo
echo "== 6/6 building dashboard data =="
python3 asr_dashboard_json.py \
    --in "${PREFIX}_homoplasy.json" \
    --out homoplasy_data.json

echo
echo "== rebuilding dashboard tree =="
# Same tree the convergence analysis ran on, so carrier highlighting in the
# homoplasy panel matches the tips actually analysed.
python3 generate_local_tree.py "${ACTIVE_PREFIX}.treefile"

echo
echo "Done."
echo "  report    : ${PREFIX}_homoplasy_report.txt"
echo "  full JSON : ${PREFIX}_homoplasy.json"
echo "  dashboard : homoplasy_data.json + local_tree.nwk"
echo
echo "homoplasy_data.json and local_tree.nwk are fetched at runtime by"
echo "dashboard.html, so both must be committed for the published site."

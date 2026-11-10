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
# 0.15, not 0.10: this is the threshold the published analysis and the CI
# workflow both use, and a default that disagrees with every real invocation
# means a hand-run silently produces a stricter, different analysis (0.10
# drops 138 sequences where 0.15 drops 35).
MAX_SEQ_MISSING="${MAX_SEQ_MISSING:-0.15}"
IQTREE_SEED="${IQTREE_SEED:-20260101}"
IQTREE_THREADS="${IQTREE_THREADS:-4}"
MAX_SITE_MISSING="${MAX_SITE_MISSING:-0.10}"
MIN_STATE_PROB="${MIN_STATE_PROB:-0.9}"

# Site masked by the Nextstrain BDBV build as "a polymorphic site in a variable
# region in GP that conflicts with outgroup rooting".
MASK_SITES="${MASK_SITES:-7461}"
# Genome termini carry sequencing artefacts and are where ragged ends get
# misplaced. Masked by the Nextstrain BDBV build and by published phylodynamic
# analyses of this outbreak.
MASK_START="${MASK_START:-40}"
COLLAPSE_SNPS="${COLLAPSE_SNPS:-0.5}"
MASK_END="${MASK_END:-40}"
# Rate outliers and QC failures, per the Nextstrain BDBV exclusion list. ADAR-
# edited genomes are deliberately NOT excluded - their edits are masked instead.
EXCLUDE_FILE="${EXCLUDE_FILE:-defaults/exclude_bdbv.txt}"

# Accept either a path or a command on PATH (see run_pathoplexus_pipeline.sh).
if [ ! -x "$IQTREE" ] && ! command -v "$IQTREE" >/dev/null 2>&1; then
    echo "IQ-TREE not found: $IQTREE (set IQTREE= to a path, or put it on PATH)"
    exit 1
fi
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
# Seeded and single thread count for the same reason as the pipeline's tree
# search: this pass infers a topology, and an unseeded search makes the
# published figures irreproducible from unchanged input.
"$IQTREE" -s "${PREFIX}_input.fasta" \
    -m "$MODEL" \
    -o "$OUTGROUP" \
    --ancestral \
    --polytomy \
    -seed "$IQTREE_SEED" \
    -T "$IQTREE_THREADS" \
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
    #
    # The tree walk is followed by a sweep of each genome against the
    # consensus, which finds a tract the topology had split across branches.
    # ADAR_NO_GENOME_PASS=1 runs the tree walk alone.
    python3 adar_mask.py \
        --prefix "$PREFIX" \
        --alignment "${PREFIX}_input.fasta" \
        --out-alignment "${PREFIX}_input.adar.fasta" \
        --max-gap "${ADAR_MAX_GAP:-200}" \
        --min-count "${ADAR_MIN_COUNT:-3}" \
        --outgroup "$OUTGROUP" \
        ${ADAR_NO_GENOME_PASS:+--no-genome-pass} \
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
        -seed "$IQTREE_SEED" \
        -T "${ADAR_THREADS:-$IQTREE_THREADS}" \
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
# ---------------------------------------------------------------------------
# Rooting. ROOTING = outgroup (default) | residual | both
#
#   both      (default) both, with residual minimisation as the PRIMARY pair
#             - local_tree.nwk and homoplasy_data.json - and the outgroup
#             rooting beside it as local_tree.outgroup.nwk and
#             homoplasy_data.outgroup.json
#   residual  residual minimisation alone, as the primary pair
#   outgroup  outgroup rooting alone, as the primary pair
#
# Residual minimisation is the default because outgroup rooting is not stable
# here and the primary artefacts are what every other consumer reads. Each
# dashboard JSON records which rooting produced it, so the tree is captioned
# from the file actually loaded rather than from whichever option is selected.
#
# Outgroup rooting is not stable for this outbreak. NC_014373.1 is a median of
# 206 substitutions from the 2026 genomes while within-outbreak pairwise
# distances are a median of 11, so the placement turns on a handful of sites.
# Adding 205 genomes in November 2026 moved the root from a 33-tip basal clade
# into the middle of a 76-way polytomy.
#
# The alternative re-roots where the root-to-tip regression on collection date
# has the smallest residual. Measured on asr_new_adar.collapsed.tree (1,075
# tips, 1,049 dated): the mean squared residual falls 37%, the fitted clock is
# 7.91e-4 subs/site/year against the 7.9e-4 root-to-tip slope recorded in
# landscape.md, and the x-intercept moves from 2012.6 to 2026.08 - inside the
# published 95% HPD for the tMRCA, where outgroup rooting puts it fourteen
# years before the outbreak because every ingroup tip then carries the deep
# outgroup stem.
#
# IQ-TREE is NOT re-run for the second rooting. Tested on a 12-taxon alignment:
# -te reads a rooted tree, logs it as rooted, then discards the root, so a root
# cannot be imposed that way. Re-running is also unnecessary - across a genuine
# root move only 1 of 155,340 ancestral state calls changed, as a reversible
# model requires. The root determines the direction of each substitution and
# the parent-to-child walk in asr_homoplasy.py, not the reconstruction feeding
# it. So "both" repeats only the counting and the tree build, never the ASR.
#
# Each rooting produces its OWN tree and its OWN convergence data, and the
# dashboard swaps the pair together. The counts that depend on the root -
# recurrence_internal, and the direction of every substitution - would
# otherwise be read against a tree they were not computed on. Under the two
# rootings they differ: 116 vs 128 recurrent sites, 25 vs 33 on internal
# branches.
# ---------------------------------------------------------------------------
ROOT_METADATA="${ROOT_METADATA:-pathoplexus_metadata.json}"
ROOTING="${ROOTING:-both}"

# analyse <tree> <label> <homoplasy-json> <dashboard-json> <display-tree> <rooting>
#
# Everything downstream of the rooting, run once per rooting. The collapse is
# inside, not before: "too short to carry a substitution" is judged against
# the root in use, and the two rootings do not collapse the same branches.
analyse () {
    local tree="$1" label="$2" homjson="$3" dashjson="$4" displaytree="$5"
    local rooting="${6:-outgroup}"
    local collapsed="${tree%.treefile}.collapsed.tree"

    echo
    echo "== [$label] collapsing branches too short to carry a substitution =="
    # IQ-TREE's --polytomy only removes branches that are effectively zero, so
    # bifurcations of a fraction of a substitution survive and are then counted
    # as internal evidence, which they cannot support. Collapse them first.
    python3 collapse_short_branches.py "$tree" \
        --out "$collapsed" \
        --min-substitutions "${COLLAPSE_SNPS:-0.5}"

    echo
    echo "== [$label] counting substitutions per branch =="
    python3 asr_homoplasy.py \
        --prefix "$ACTIVE_PREFIX" \
        --tree "$collapsed" \
        --posmap "${PREFIX}_input.posmap.json" \
        --alignment "$ACTIVE_ALIGNMENT" \
        --genbank "$GENBANK" \
        --min-state-prob "$MIN_STATE_PROB" \
        --out "${PREFIX}_homoplasy_report${label:+_$label}.txt" \
        --json-out "$homjson"

    echo
    echo "== [$label] building dashboard data =="
    python3 asr_dashboard_json.py --in "$homjson" --out "$dashjson" \
        --rooting "$rooting" ${DASHBOARD_FLAGS:-}

    echo
    echo "== [$label] rebuilding dashboard tree =="
    # The same tree the convergence analysis ran on, so carrier highlighting
    # in the homoplasy panel matches the tips actually analysed, and so the
    # direction of each substitution matches the tree it is drawn beside.
    python3 generate_local_tree.py "$collapsed" --out "$displaytree"
}

# Returns non-zero rather than exiting, so the caller can decide whether a
# failure is fatal. `exit` here would end the shell even from inside an `if`.
residual_tree () {
    if [ ! -f "$ROOT_METADATA" ]; then
        echo "Metadata not found: $ROOT_METADATA (set ROOT_METADATA=)"
        return 1
    fi
    echo
    echo "== re-rooting by residual minimisation =="
    python3 root_by_residual_minimisation.py "${ACTIVE_PREFIX}.treefile" \
        --metadata "$ROOT_METADATA" \
        --out "${ACTIVE_PREFIX}.residual.treefile" \
        --report "${PREFIX}_root_fit.json" \
        --min-year "${ROOT_MIN_YEAR:-2026}" \
        --max-z "${ROOT_MAX_Z:-3.0}" \
        --verify
}

case "$ROOTING" in
    outgroup)
        echo "== rooting: outgroup ($OUTGROUP) only =="
        analyse "${ACTIVE_PREFIX}.treefile" "" \
                "${PREFIX}_homoplasy.json" homoplasy_data.json local_tree.nwk \
                outgroup
        ;;
    residual)
        echo "== rooting: residual minimisation only =="
        residual_tree
        analyse "${ACTIVE_PREFIX}.residual.treefile" "" \
                "${PREFIX}_homoplasy.json" homoplasy_data.json local_tree.nwk \
                residual
        echo
        echo "   NOTE: dashboard.html describes the tree as rooted on the 2007"
        echo "   strain (the tree panel caption, and the outgroup line in the"
        echo "   methods note). Both are untrue under this rooting."
        ;;
    both)
        echo "== rooting: publishing BOTH, residual minimisation primary =="
        # The rooting runs BEFORE any analysis, and this script is `set -e`.
        # Left unguarded, a rooting that cannot be done honestly - no branch
        # implying a positive clock rate, a --verify disagreement, missing
        # metadata - would abort a three-hour rebuild and publish nothing at
        # all, which is worse than the outgroup rooting this replaces.
        #
        # So in `both` the failure is caught: the outgroup rooting is
        # published on its own, exactly as before this change, and the
        # dashboard selector is withheld because there is no second pair to
        # switch to. The run still succeeds, and the warning plus the
        # `rooting` field in homoplasy_data.json say what happened. A run
        # asking for `residual` alone is NOT caught - there the rooting is
        # the point, and quietly substituting the other one would be a lie.
        if residual_tree; then
            # Residual minimisation writes the PRIMARY artefacts, because
            # those are what prune_revoked.py, the CI comparison and every
            # other consumer read by default. Outgroup is the alternative.
            DASHBOARD_FLAGS="--alternative-rooting"
            analyse "${ACTIVE_PREFIX}.residual.treefile" "" \
                    "${PREFIX}_homoplasy.json" homoplasy_data.json \
                    local_tree.nwk residual
            analyse "${ACTIVE_PREFIX}.treefile" "outgroup" \
                    "${PREFIX}_homoplasy_outgroup.json" \
                    homoplasy_data.outgroup.json local_tree.outgroup.nwk \
                    outgroup
        else
            ROOTING_FELL_BACK=1
            echo
            echo "WARNING: residual minimisation failed."
            echo "   Publishing the outgroup rooting alone, as before this"
            echo "   change, so the rebuild still produces artefacts. The"
            echo "   rooting selector is withheld: there is no second pair."
            echo "   Read the error above before merging - this is the"
            echo "   rooting the dashboard no longer treats as reliable."
            DASHBOARD_FLAGS=""
            analyse "${ACTIVE_PREFIX}.treefile" "" \
                    "${PREFIX}_homoplasy.json" homoplasy_data.json \
                    local_tree.nwk outgroup
            # Leave nothing stale behind: artefacts from an earlier successful
            # run would otherwise sit beside data they do not match.
            rm -f homoplasy_data.outgroup.json local_tree.outgroup.nwk
        fi
        echo
        if [ "${ROOTING_FELL_BACK:-0}" = "1" ]; then
        echo "   ONE pair written: residual minimisation FAILED, outgroup"
        echo "   rooting published in its place."
        else
        echo "   Both pairs written. Primary = residual minimisation."
        fi
        ;;
    *)
        echo "ROOTING must be both, residual or outgroup (got: $ROOTING)"
        exit 1
        ;;
esac

echo
echo "Done."
echo "  report    : ${PREFIX}_homoplasy_report.txt"
echo "  full JSON : ${PREFIX}_homoplasy.json"
echo "  dashboard : homoplasy_data.json + local_tree.nwk"
if [ "$ROOTING" = "both" ]; then
echo "  outgroup  : ${PREFIX}_homoplasy_report_outgroup.txt"
echo "              homoplasy_data.outgroup.json + local_tree.outgroup.nwk"
echo "  root fit  : ${PREFIX}_root_fit.json"
fi
echo
echo "homoplasy_data.json and local_tree.nwk are fetched at runtime by"
echo "dashboard.html, so both must be committed for the published site."
if [ "$ROOTING" = "both" ]; then
echo "The .outgroup. pair must be committed too, or the rooting selector"
echo "will not appear. They are fetched the same way."
fi
